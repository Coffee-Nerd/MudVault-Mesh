import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, ChannelType } from 'discord.js';
import { EventEmitter } from 'events';
import { MudVaultClient } from '../clients/nodejs';
import { MudVaultMessage } from '../types';
import winston from 'winston';

interface DiscordConfig {
  enabled: boolean;
  token: string;
  guildId: string;
  bridgeChannelId: string;
  channelMappings: { [mudChannel: string]: string }; // MUD channel -> Discord channel ID
  mudName: string;
  channels: string[];
  requireVerification: boolean;
  rateLimitMessages: number;
  rateLimitCommands: number;
}

interface UserMapping {
  discordId: string;
  mudName: string;
  mudUsername: string;
  verified: boolean;
  verifiedAt?: Date;
}

export class DiscordService extends EventEmitter {
  private config: DiscordConfig;
  private logger: winston.Logger;
  private discordClient: Client;
  private imcClient: MudVaultClient;
  private userMappings: Map<string, UserMapping> = new Map();
  private verificationCodes: Map<string, { discordId: string; mudName: string; mudUsername: string; expires: Date }> = new Map();

  constructor(config: DiscordConfig, logger: winston.Logger, private mudvaultUrl: string) {
    super();
    this.config = config;
    this.logger = logger;

    // Initialize Discord client
    this.discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    // Initialize IMC client  
    this.imcClient = new MudVaultClient({
      mudName: config.mudName,
      autoReconnect: true,
      heartbeatInterval: 30000
    });

    this.setupDiscordEvents();
    this.setupIMCEvents();
    this.setupSlashCommands();
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Discord integration disabled');
      return;
    }

    this.logger.info('Starting Discord service...');
    
    // Start Discord bot
    await this.discordClient.login(this.config.token);
    
    // Connect to MudVault as a client
    await this.imcClient.connect(this.mudvaultUrl);
    
    // Join configured channels
    for (const channel of this.config.channels) {
      await this.imcClient.joinChannel(channel);
    }

    this.logger.info('Discord service started successfully');
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Discord service...');
    await this.imcClient.disconnect();
    await this.discordClient.destroy();
    this.logger.info('Discord service stopped');
  }

  private setupDiscordEvents(): void {
    this.discordClient.on('ready', () => {
      this.logger.info(`Discord bot logged in as ${this.discordClient.user?.tag}`);
      this.logger.debug(`DEBUG: Discord bot ready, monitoring ${Object.keys(this.config.channelMappings).length} channel mappings`);
      this.logger.debug(`DEBUG: Channel mappings:`, this.config.channelMappings);
    });

    this.discordClient.on('messageCreate', async (message) => {
      this.logger.debug(`DEBUG: Discord message received`, {
        channelId: message.channel.id,
        channelName: message.channel.type === ChannelType.GuildText ? message.channel.name : 'DM',
        author: message.author.username,
        content: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
        isBot: message.author.bot,
        isBridge: message.channel.id === this.config.bridgeChannelId,
        isMapped: this.getMudChannelFromDiscordId(message.channel.id) !== null
      });
      
      await this.handleDiscordMessage(message);
    });

    this.discordClient.on('interactionCreate', async (interaction) => {
      this.logger.debug(`DEBUG: Discord interaction received`, {
        type: interaction.type,
        user: interaction.user.username,
        isCommand: interaction.isChatInputCommand()
      });
      
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      }
    });
  }

  private setupIMCEvents(): void {
    this.imcClient.on('connected', () => {
      this.logger.info('Discord service connected to MudVault');
      this.logger.debug('DEBUG: IMC client connected, Discord can now receive MUD messages');
    });

    this.imcClient.on('channel', (message: MudVaultMessage) => {
      this.logger.debug('DEBUG: IMC channel message received', {
        from: `${message.from.user}@${message.from.mud}`,
        channel: message.to.channel,
        content: (message.payload as any).message?.substring(0, 100) + ((message.payload as any).message?.length > 100 ? '...' : ''),
        timestamp: message.timestamp
      });
      this.handleIMCChannelMessage(message);
    });

    this.imcClient.on('tell', (message: MudVaultMessage) => {
      this.logger.debug('DEBUG: IMC tell message received', {
        from: `${message.from.user}@${message.from.mud}`,
        to: `${message.to.user}@${message.to.mud}`,
        content: (message.payload as any).message?.substring(0, 100) + ((message.payload as any).message?.length > 100 ? '...' : ''),
      });
      this.handleIMCTellMessage(message);
    });

    this.imcClient.on('who', (message: MudVaultMessage) => {
      this.logger.debug('DEBUG: IMC who response received', {
        from: message.from.mud,
        userCount: (message.payload as any).users?.length || 0
      });
      this.handleIMCWhoResponse(message);
    });

    // Handle verification from MUD side  
    this.imcClient.on('message', (message: MudVaultMessage) => {
      this.logger.debug('DEBUG: Raw IMC message received', {
        type: message.type,
        from: `${message.from.user}@${message.from.mud}`,
        to: message.to
      });
      
      // Handle verification via tell messages with special format
      if (message.type === 'tell' && (message.payload as any).message?.startsWith('DISCORD_VERIFY:')) {
        const parts = (message.payload as any).message.split(':');
        if (parts.length >= 2) {
          const code = parts[1].toUpperCase(); // Make case-insensitive
          this.logger.debug('DEBUG: Processing Discord verification', {
            originalCode: parts[1],
            normalizedCode: code,
            mudName: message.from.mud,
            username: message.from.user
          });
          this.handleMudVerification(code, message.from.mud!, message.from.user!);
        }
      }
    });

    this.imcClient.on('error', (error) => {
      this.logger.error('DEBUG: IMC client error:', error);
    });

    this.imcClient.on('disconnect', () => {
      this.logger.warn('DEBUG: IMC client disconnected');
    });
  }

  private async setupSlashCommands(): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link your Discord account to a MUD character')
        .addStringOption(option =>
          option.setName('mud')
            .setDescription('The MUD you play on')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('character')
            .setDescription('Your character name')
            .setRequired(true)),

      new SlashCommandBuilder()
        .setName('who')
        .setDescription('See who is online across connected MUDs'),

      new SlashCommandBuilder()
        .setName('channels')
        .setDescription('List available MudVault channels')
    ];

    this.discordClient.on('ready', async () => {
      const guild = this.discordClient.guilds.cache.get(this.config.guildId);
      if (guild) {
        await guild.commands.set(commands);
      }
    });
  }

  private async handleDiscordMessage(message: any): Promise<void> {
    // Check if message is from any of our configured channels
    const channelId = message.channel.id;
    const isBridgeChannel = channelId === this.config.bridgeChannelId;
    const mudChannel = this.getMudChannelFromDiscordId(channelId);
    
    this.logger.debug('DEBUG: Processing Discord message', {
      channelId,
      isBridgeChannel,
      mudChannel,
      author: message.author.username,
      isBot: message.author.bot
    });
    
    // Only process messages from bridge channel or mapped channels
    if (!isBridgeChannel && !mudChannel) {
      this.logger.debug('DEBUG: Ignoring message - not from monitored channel');
      return;
    }
    if (message.author.bot) {
      this.logger.debug('DEBUG: Ignoring message - from bot');
      return;
    }

    // Check if user is verified
    const mapping = this.userMappings.get(message.author.id);
    if (!mapping || !mapping.verified) {
      this.logger.debug('DEBUG: User not verified', {
        userId: message.author.id,
        username: message.author.username,
        hasMapping: !!mapping,
        isVerified: mapping?.verified || false
      });
      
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('Verification Required')
        .setDescription('Use `/verify <mud> <character>` to link your account first.');
      
      await message.reply({ embeds: [embed], ephemeral: true });
      await message.delete();
      return;
    }

    this.logger.debug('DEBUG: User verified, processing message', {
      discordUser: message.author.username,
      mudUser: mapping.mudUsername,
      mudName: mapping.mudName
    });

    // Delete original message and create formatted embed
    await message.delete();
    
    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL()
      })
      .setDescription(message.content)
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({
        text: `→ ${mapping.mudName} as ${mapping.mudUsername}`
      });

    await message.channel.send({ embeds: [embed] });

    // Determine which MUD channel to send to
    const targetChannel = mudChannel || this.config.channels[0]; // Default to first channel if from bridge
    
    this.logger.debug('DEBUG: Sending Discord message to MUD network', {
      targetChannel,
      content: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
      mudUsername: mapping.mudUsername,
      mudName: mapping.mudName
    });
    
    // Send to MudVault network
    try {
      this.imcClient.sendChannelMessage(
        targetChannel,
        message.content,
        mapping.mudUsername
      );
      this.logger.debug('DEBUG: Successfully sent message to MUD network');
    } catch (error) {
      this.logger.error('DEBUG: Failed to send message to MUD network:', error);
    }
  }

  private async handleIMCChannelMessage(message: MudVaultMessage): Promise<void> {
    // Don't echo our own messages
    if (message.from.mud === this.config.mudName) {
      this.logger.debug('DEBUG: Ignoring own message echo from', message.from.mud);
      return;
    }

    const rawChannelName = (message.payload as any).channel || 'chat';
    const mudChannelName = this.normalizeChannelName(rawChannelName);
    
    // Get specific Discord channel for this MUD channel
    const specificChannelId = this.config.channelMappings[mudChannelName];
    const bridgeChannelId = this.config.bridgeChannelId;
    
    this.logger.debug('DEBUG: Processing MUD message for Discord', {
      mudChannelName,
      specificChannelId,
      bridgeChannelId,
      from: `${message.from.user}@${message.from.mud}`,
      hasSpecificMapping: !!specificChannelId
    });
    
    // Convert ANSI colors and create embed
    const formattedContent = this.convertAnsiToDiscord((message.payload as any).message);
    
    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.from.mud,
        iconURL: 'https://cdn.discordapp.com/emojis/🌍.png' // Earth emoji for MUD icon
      })
      .setTitle(message.from.user || 'Unknown')
      .setDescription(`\`\`\`ansi\n${formattedContent}\n\`\`\``)
      .setTimestamp(new Date(message.timestamp))
      .setFooter({
        text: `#${mudChannelName}`
      })
      .setColor(this.getChannelColor(mudChannelName));

    // Send to specific channel if mapped
    if (specificChannelId) {
      const specificChannel = this.discordClient.channels.cache.get(specificChannelId);
      if (specificChannel && specificChannel.type === ChannelType.GuildText) {
        this.logger.debug('DEBUG: Sending to specific Discord channel', {
          channelId: specificChannelId,
          channelName: specificChannel.name
        });
        await specificChannel.send({ embeds: [embed] });
      } else {
        this.logger.warn('DEBUG: Specific channel not found or not text channel', {
          channelId: specificChannelId,
          found: !!specificChannel,
          type: specificChannel?.type
        });
      }
    } else {
      this.logger.debug('DEBUG: No specific channel mapping found for', mudChannelName);
    }
    
    // Always send to bridge channel as well (admin overview)
    const bridgeChannel = this.discordClient.channels.cache.get(bridgeChannelId);
    if (bridgeChannel && bridgeChannel.type === ChannelType.GuildText) {
      this.logger.debug('DEBUG: Sending to bridge channel', {
        channelId: bridgeChannelId,
        channelName: bridgeChannel.name
      });
      
      // Add channel prefix for bridge channel to show which channel it's from
      const bridgeEmbed = new EmbedBuilder()
        .setAuthor({
          name: message.from.mud,
          iconURL: 'https://cdn.discordapp.com/emojis/🌍.png'
        })
        .setTitle(`[#${mudChannelName}] ${message.from.user || 'Unknown'}`)
        .setDescription(`\`\`\`ansi\n${formattedContent}\n\`\`\``)
        .setTimestamp(new Date(message.timestamp))
        .setFooter({
          text: `from #${mudChannelName}`
        })
        .setColor(this.getChannelColor(mudChannelName));
        
      await bridgeChannel.send({ embeds: [bridgeEmbed] });
      this.logger.debug('DEBUG: Successfully sent to bridge channel');
    } else {
      this.logger.warn('DEBUG: Bridge channel not found or not text channel', {
        channelId: bridgeChannelId,
        found: !!bridgeChannel,
        type: bridgeChannel?.type
      });
    }
  }

  private async handleIMCTellMessage(message: MudVaultMessage): Promise<void> {
    // Handle tells by sending DMs to mapped Discord users
    const targetMapping = Array.from(this.userMappings.values())
      .find(m => m.mudName === message.to.mud && m.mudUsername === message.to.user);

    if (targetMapping) {
      try {
        const discordUser = await this.discordClient.users.fetch(targetMapping.discordId);
        const formattedContent = this.convertAnsiToDiscord((message.payload as any).message);
        
        const embed = new EmbedBuilder()
          .setTitle(`Tell from ${message.from.user}@${message.from.mud}`)
          .setDescription(`\`\`\`ansi\n${formattedContent}\n\`\`\``)
          .setColor(0x00ff00)
          .setTimestamp();

        await discordUser.send({ embeds: [embed] });
      } catch (error) {
        this.logger.warn('Could not send DM to Discord user', error);
      }
    }
  }

  private async handleSlashCommand(interaction: any): Promise<void> {
    try {
      switch (interaction.commandName) {
        case 'verify':
          await this.handleVerifyCommand(interaction);
          break;
        case 'who':
          await this.handleWhoCommand(interaction);
          break;
        case 'channels':
          await this.handleChannelsCommand(interaction);
          break;
      }
    } catch (error) {
      this.logger.error('Slash command error', error);
      await interaction.reply({ content: 'An error occurred', ephemeral: true });
    }
  }

  private async handleVerifyCommand(interaction: any): Promise<void> {
    const mud = interaction.options.getString('mud');
    const character = interaction.options.getString('character');
    
    // Generate verification code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    
    this.verificationCodes.set(code, {
      discordId: interaction.user.id,
      mudName: mud,
      mudUsername: character,
      expires
    });

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Verification Started')
      .addFields(
        { name: 'MUD', value: mud, inline: true },
        { name: 'Character', value: character, inline: true },
        { name: 'Code', value: `**${code}**`, inline: false },
        { name: 'Instructions', value: `In ${mud}, type: \`mudvault verify ${code}\`` }
      )
      .setFooter({ text: 'Code expires in 5 minutes' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleMudVerification(code: string, mudName: string, username: string): Promise<void> {
    this.logger.debug('DEBUG: Attempting verification', {
      code,
      mudName,
      username,
      availableCodes: Array.from(this.verificationCodes.keys())
    });

    const verification = this.verificationCodes.get(code);
    if (!verification) {
      this.logger.debug('DEBUG: Verification code not found', { code });
      // Send error message to MUD
      try {
        this.imcClient.sendTell({ mud: mudName, user: username }, 'Verification code not found or expired. Please try /verify again in Discord.');
      } catch (error) {
        this.logger.error('Failed to send verification error to MUD:', error);
      }
      return;
    }

    if (verification.expires < new Date()) {
      this.logger.debug('DEBUG: Verification code expired', { code, expires: verification.expires });
      this.verificationCodes.delete(code);
      try {
        this.imcClient.sendTell({ mud: mudName, user: username }, 'Verification code expired. Please try /verify again in Discord.');
      } catch (error) {
        this.logger.error('Failed to send verification expiry message to MUD:', error);
      }
      return;
    }

    if (verification.mudName !== mudName || verification.mudUsername !== username) {
      this.logger.debug('DEBUG: Verification details mismatch', {
        expected: { mudName: verification.mudName, username: verification.mudUsername },
        received: { mudName, username }
      });
      try {
        this.imcClient.sendTell({ mud: mudName, user: username }, `Verification failed: Expected MUD "${verification.mudName}" and character "${verification.mudUsername}"`);
      } catch (error) {
        this.logger.error('Failed to send verification mismatch message to MUD:', error);
      }
      return;
    }

    // Create mapping
    const mapping: UserMapping = {
      discordId: verification.discordId,
      mudName,
      mudUsername: username,
      verified: true,
      verifiedAt: new Date()
    };

    this.userMappings.set(verification.discordId, mapping);
    this.verificationCodes.delete(code);

    this.logger.info('DEBUG: User successfully verified', { 
      discordId: verification.discordId, 
      mudName, 
      username,
      totalMappings: this.userMappings.size 
    });

    // Send confirmation to MUD
    try {
      this.imcClient.sendTell({ mud: mudName, user: username }, 'Your Discord account has been successfully linked! You can now chat through Discord.');
    } catch (error) {
      this.logger.error('Failed to send verification success message to MUD:', error);
    }
  }

  private async handleWhoCommand(interaction: any): Promise<void> {
    await interaction.deferReply();
    
    // Request who list from network
    this.imcClient.requestWho('*'); // Request from all MUDs
    
    // Wait for response (implement timeout)
    setTimeout(async () => {
      await interaction.editReply('Who list request timed out');
    }, 5000);
  }

  private async handleChannelsCommand(interaction: any): Promise<void> {
    const embed = this.formatChannelList(this.config.channels);
    await interaction.reply({ embeds: [embed] });
  }

  private async handleIMCWhoResponse(message: MudVaultMessage): Promise<void> {
    // Format who list for Discord
    const embeds = this.formatWhoList(message.payload);
    
    // This would need to be linked to the original interaction
    // For now, just log it
    this.logger.info('Received who list', message.payload);
  }

  private convertAnsiToDiscord(text: string): string {
    // Convert ANSI escape codes to Discord ANSI format
    // This handles the standard ANSI codes that MUDs typically send
    
    // Remove any existing Discord ANSI formatting
    text = text.replace(/```ansi\n?/g, '').replace(/```/g, '');
    
    // ANSI codes are already in the right format for Discord
    // Just ensure proper reset at the end
    if (!text.includes('\u001b[0m')) {
      text += '\u001b[0m';
    }
    
    return text;
  }

  private getChannelColor(channel: string): number {
    const colors: { [key: string]: number } = {
      'ooc': 0x5865f2,    // Discord blue
      'chat': 0xffa500,   // Orange
      'gossip': 0xff69b4, // Pink
      'newbie': 0x00ff00, // Green
      'market': 0xffff00, // Yellow
      'default': 0x808080 // Gray
    };
    
    return colors[channel.toLowerCase()] || colors.default;
  }

  private formatWhoList(whoData: any): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];
    
    for (const mudName in whoData) {
      const players = whoData[mudName];
      
      const embed = new EmbedBuilder()
        .setTitle(`🌍 ${mudName}`)
        .setColor(0x00ff00)
        .setTimestamp();

      if (players.length === 0) {
        embed.setDescription('```ansi\n\u001b[0;31mNo players online\u001b[0m\n```');
      } else {
        let playerList = '';
        players.forEach((player: any, index: number) => {
          playerList += `\u001b[1;36m${player.name}\u001b[0m`;
          if (player.title) playerList += ` \u001b[0;37m${player.title}\u001b[0m`;
          if (player.level) playerList += ` \u001b[0;33m[${player.level}]\u001b[0m`;
          playerList += '\n';
        });

        embed.setDescription(`\`\`\`ansi\n${playerList}\`\`\``);
        embed.setFooter({ text: `${players.length} players online` });
      }

      embeds.push(embed);
    }

    return embeds;
  }

  private formatChannelList(channels: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('📺 Available Channels')
      .setColor(0x5865f2)
      .setTimestamp();

    if (channels.length === 0) {
      embed.setDescription('```ansi\n\u001b[0;31mNo channels available\u001b[0m\n```');
    } else {
      let channelList = '';
      channels.forEach((channel, index) => {
        const prefix = index === 0 ? '┌─' : index === channels.length - 1 ? '└─' : '├─';
        channelList += `${prefix} \u001b[1;36m#${channel}\u001b[0m\n`;
      });

      embed.setDescription(`\`\`\`ansi\n${channelList}\`\`\``);
      embed.setFooter({ text: `${channels.length} channels available` });
    }

    return embed;
  }

  private getMudChannelFromDiscordId(discordChannelId: string): string | null {
    for (const [mudChannel, discordId] of Object.entries(this.config.channelMappings)) {
      if (discordId === discordChannelId) {
        return mudChannel;
      }
    }
    return null;
  }

  /**
   * Normalize channel names to handle variations like "goss" -> "gossip"
   */
  private normalizeChannelName(channelName: string): string {
    const channelMappings: { [key: string]: string } = {
      'goss': 'gossip',
      'gossip': 'gossip',
      'ooc': 'ooc',
      'chat': 'chat',
      'general': 'chat'
    };

    const normalized = channelMappings[channelName.toLowerCase()];
    if (normalized) {
      this.logger.debug(`DEBUG: Channel normalized: ${channelName} -> ${normalized}`);
      return normalized;
    }

    // If no mapping found, return original and log it
    this.logger.debug(`DEBUG: No channel mapping for: ${channelName}, using as-is`);
    return channelName;
  }
}