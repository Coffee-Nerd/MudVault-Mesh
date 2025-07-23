import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  EmbedBuilder,
  SlashCommandBuilder,
  CommandInteraction,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { EventEmitter } from 'events';
import { BridgeConfig, BridgedMessage } from '../types';
import { VerificationManager } from '../security/verification';
import { BridgeRateLimiter } from '../security/rateLimiter';
import winston from 'winston';

export class DiscordBot extends EventEmitter {
  private client: Client;
  private config: BridgeConfig;
  private verificationManager: VerificationManager;
  private rateLimiter: BridgeRateLimiter;
  private logger: winston.Logger;
  private ready = false;

  constructor(
    config: BridgeConfig,
    verificationManager: VerificationManager,
    rateLimiter: BridgeRateLimiter,
    logger: winston.Logger
  ) {
    super();
    this.config = config;
    this.verificationManager = verificationManager;
    this.rateLimiter = rateLimiter;
    this.logger = logger;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ]
    });

    this.setupEventHandlers();
    this.setupCommands();
  }

  /**
   * Connect to Discord
   */
  async connect(): Promise<void> {
    await this.client.login(this.config.discord.token);
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.ready = false;
    await this.client.destroy();
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('ready', () => {
      this.logger.info('Discord bot connected', {
        username: this.client.user?.username,
        id: this.client.user?.id
      });
      this.ready = true;
      this.emit('ready');
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isCommand()) {
        await this.handleCommand(interaction);
      }
    });

    this.client.on('error', (error) => {
      this.logger.error('Discord client error', error);
      this.emit('error', error);
    });
  }

  /**
   * Setup slash commands
   */
  private async setupCommands(): Promise<void> {
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
        .setName('unverify')
        .setDescription('Unlink your Discord account from MUD'),

      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check your verification status and rate limits'),

      new SlashCommandBuilder()
        .setName('who')
        .setDescription('See who is online across connected MUDs'),

      new SlashCommandBuilder()
        .setName('channels')
        .setDescription('List available MudVault channels'),

      new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
          subcommand
            .setName('resetlimits')
            .setDescription('Reset rate limits for a user')
            .addUserOption(option =>
              option.setName('user')
                .setDescription('The user to reset')
                .setRequired(true)))
        .addSubcommand(subcommand =>
          subcommand
            .setName('ban')
            .setDescription('Ban a user from the bridge')
            .addUserOption(option =>
              option.setName('user')
                .setDescription('The user to ban')
                .setRequired(true)))
        .addSubcommand(subcommand =>
          subcommand
            .setName('unban')
            .setDescription('Unban a user from the bridge')
            .addUserOption(option =>
              option.setName('user')
                .setDescription('The user to unban')
                .setRequired(true)))
    ];

    // Register commands with Discord
    this.client.on('ready', async () => {
      const guild = this.client.guilds.cache.get(this.config.discord.guildId);
      if (guild) {
        await guild.commands.set(commands);
      }
    });
  }

  /**
   * Handle incoming Discord messages
   */
  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only process messages from the bridge channel
    if (message.channel.id !== this.config.discord.bridgeChannelId) return;

    // Check if user is verified
    const mapping = await this.verificationManager.getUserMapping(message.author.id);
    if (!mapping || !mapping.verified) {
      // Send ephemeral message about verification
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('Verification Required')
        .setDescription('You must verify your MUD character before sending messages.')
        .addFields({
          name: 'How to verify',
          value: 'Use `/verify <mud> <character>` to link your account.'
        });
      
      await message.reply({ embeds: [embed], ephemeral: true });
      await message.delete();
      return;
    }

    // Check rate limits
    const rateLimitCheck = await this.rateLimiter.checkMessage(message.author.id);
    if (!rateLimitCheck.allowed) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('Rate Limited')
        .setDescription(`Please wait ${rateLimitCheck.retryAfter} seconds before sending another message.`);
      
      await message.reply({ embeds: [embed], ephemeral: true });
      await message.delete();
      return;
    }

    // Update message stats
    await this.verificationManager.updateMessageStats(message.author.id);

    // Delete the original message to keep channel clean
    await message.delete();

    // Create a nice embed for the Discord message
    const discordEmbed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL()
      })
      .setDescription(message.content)
      .setColor(0x5865f2) // Discord blue
      .setTimestamp()
      .setFooter({
        text: `→ ${mapping.mudName} as ${mapping.mudUsername}`
      });

    // Add attachments if any
    if (message.attachments.size > 0) {
      const attachmentList = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
      discordEmbed.addFields({
        name: '📎 Attachments',
        value: attachmentList,
        inline: false
      });
    }

    // Send the formatted message to Discord
    await (message.channel as TextChannel).send({ embeds: [discordEmbed] });

    // Convert to bridged message
    const bridgedMessage: BridgedMessage = {
      id: message.id,
      originalId: message.id,
      source: 'discord',
      author: {
        id: message.author.id,
        username: mapping.mudUsername,
        displayName: message.author.displayName
      },
      content: message.content,
      timestamp: message.createdAt,
      attachments: message.attachments.map(a => ({
        url: a.url,
        name: a.name,
        size: a.size
      }))
    };

    // Emit for the bridge to handle
    this.emit('message', bridgedMessage, mapping);
  }

  /**
   * Handle slash commands
   */
  private async handleCommand(interaction: CommandInteraction): Promise<void> {
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'verify':
          await this.handleVerifyCommand(interaction);
          break;
        case 'unverify':
          await this.handleUnverifyCommand(interaction);
          break;
        case 'status':
          await this.handleStatusCommand(interaction);
          break;
        case 'who':
          await this.handleWhoCommand(interaction);
          break;
        case 'channels':
          await this.handleChannelsCommand(interaction);
          break;
        case 'admin':
          await this.handleAdminCommand(interaction);
          break;
      }
    } catch (error) {
      this.logger.error('Command error', { commandName, error });
      await interaction.reply({
        content: 'An error occurred while processing your command.',
        ephemeral: true
      });
    }
  }

  /**
   * Handle /verify command
   */
  private async handleVerifyCommand(interaction: CommandInteraction): Promise<void> {
    const mud = interaction.options.getString('mud', true);
    const character = interaction.options.getString('character', true);

    // Check if user already has pending verification
    const pending = await this.verificationManager.hasPendingVerification(interaction.user.id);
    if (pending) {
      await interaction.reply({
        content: `You already have a pending verification. Your code is: **${pending}**`,
        ephemeral: true
      });
      return;
    }

    // Check if user is already verified
    const existing = await this.verificationManager.getUserMapping(interaction.user.id);
    if (existing && existing.verified) {
      await interaction.reply({
        content: 'You are already verified. Use `/unverify` to unlink your account first.',
        ephemeral: true
      });
      return;
    }

    // Generate verification code
    const code = await this.verificationManager.createVerificationRequest(
      interaction.user,
      mud,
      character
    );

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Verification Started')
      .setDescription('Please complete verification in your MUD')
      .addFields(
        { name: 'MUD', value: mud, inline: true },
        { name: 'Character', value: character, inline: true },
        { name: 'Verification Code', value: `**${code}**`, inline: false },
        { 
          name: 'Instructions', 
          value: `In your MUD, type: \`mudvault verify ${code}\`\nThis code expires in 5 minutes.`
        }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /**
   * Handle /unverify command
   */
  private async handleUnverifyCommand(interaction: CommandInteraction): Promise<void> {
    const success = await this.verificationManager.revokeVerification(interaction.user.id);
    
    if (success) {
      await interaction.reply({
        content: 'Your account has been unlinked successfully.',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: 'You are not currently verified.',
        ephemeral: true
      });
    }
  }

  /**
   * Handle /status command
   */
  private async handleStatusCommand(interaction: CommandInteraction): Promise<void> {
    const mapping = await this.verificationManager.getUserMapping(interaction.user.id);
    const usage = await this.rateLimiter.getUserUsage(interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(mapping?.verified ? 0x00ff00 : 0xff0000)
      .setTitle('Bridge Status')
      .setThumbnail(interaction.user.displayAvatarURL());

    if (mapping?.verified) {
      embed.addFields(
        { name: 'Status', value: '✅ Verified', inline: true },
        { name: 'MUD', value: mapping.mudName, inline: true },
        { name: 'Character', value: mapping.mudUsername, inline: true },
        { name: 'Messages Sent', value: mapping.messageCount.toString(), inline: true },
        { 
          name: 'Rate Limits', 
          value: `Messages: ${usage.messages.used}/${usage.messages.used + usage.messages.remaining}\nCommands: ${usage.commands.used}/${usage.commands.used + usage.commands.remaining}`,
          inline: false
        }
      );
    } else {
      embed.addFields(
        { name: 'Status', value: '❌ Not Verified', inline: false },
        { name: 'Next Step', value: 'Use `/verify` to link your MUD character', inline: false }
      );
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /**
   * Handle /who command
   */
  private async handleWhoCommand(interaction: CommandInteraction): Promise<void> {
    // This will be implemented when we have the MudVault client
    await interaction.reply({
      content: 'Fetching online players...',
      ephemeral: true
    });
    
    // Emit event for the bridge to handle
    this.emit('command:who', interaction);
  }

  /**
   * Handle /channels command
   */
  private async handleChannelsCommand(interaction: CommandInteraction): Promise<void> {
    // This will be implemented when we have the MudVault client
    await interaction.reply({
      content: 'Fetching available channels...',
      ephemeral: true
    });
    
    // Emit event for the bridge to handle
    this.emit('command:channels', interaction);
  }

  /**
   * Handle admin commands
   */
  private async handleAdminCommand(interaction: CommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
      case 'resetlimits': {
        const user = interaction.options.getUser('user', true);
        await this.rateLimiter.resetUserLimits(user.id);
        await interaction.reply({
          content: `Rate limits reset for ${user.username}`,
          ephemeral: true
        });
        break;
      }
      case 'ban': {
        const user = interaction.options.getUser('user', true);
        // Implement ban logic
        await interaction.reply({
          content: `User ${user.username} has been banned from the bridge`,
          ephemeral: true
        });
        break;
      }
      case 'unban': {
        const user = interaction.options.getUser('user', true);
        // Implement unban logic
        await interaction.reply({
          content: `User ${user.username} has been unbanned from the bridge`,
          ephemeral: true
        });
        break;
      }
    }
  }

  /**
   * Send a message to Discord from MudVault
   */
  async sendMessage(message: BridgedMessage): Promise<void> {
    if (!this.ready) {
      throw new Error('Discord bot not ready');
    }

    const channel = this.client.channels.cache.get(this.config.discord.bridgeChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error('Bridge channel not found or invalid');
    }

    // Parse MUD name and channel from the message
    const mudName = message.author.displayName?.split('@')[1] || 'Unknown MUD';
    const mudChannel = message.channel || 'tell';

    // Create a terminal-style embed
    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${mudName}`,
        iconURL: 'https://i.imgur.com/AfFp7pu.png' // Terminal icon placeholder
      })
      .setTitle(`${message.author.username}`)
      .setDescription(`\`\`\`ansi\n${this.formatMessageContent(message.content)}\n\`\`\``)
      .setTimestamp(message.timestamp)
      .setFooter({
        text: `#${mudChannel}`
      });

    // Color based on message type/channel
    const colorMap: { [key: string]: number } = {
      'tell': 0x00ff00,      // Green for tells
      'ooc': 0x5865f2,       // Discord blue for OOC
      'chat': 0xffa500,      // Orange for chat
      'gossip': 0xff69b4,    // Pink for gossip
      'market': 0xffff00,    // Yellow for market
      'default': 0x808080    // Gray default
    };

    embed.setColor(colorMap[mudChannel.toLowerCase()] || colorMap.default);

    // Add fields for additional context if available
    if (message.metadata) {
      const fields: { name: string; value: string; inline: boolean }[] = [];
      
      if (message.metadata.room) {
        fields.push({
          name: '📍 Location',
          value: message.metadata.room,
          inline: true
        });
      }
      
      if (message.metadata.level) {
        fields.push({
          name: '⚔️ Level',
          value: message.metadata.level.toString(),
          inline: true
        });
      }
      
      if (fields.length > 0) {
        embed.addFields(fields);
      }
    }

    await (channel as TextChannel).send({ embeds: [embed] });
  }

  /**
   * Format message content with ANSI colors if present
   */
  private formatMessageContent(content: string): string {
    // Convert common MUD color codes to ANSI
    const colorMap: { [key: string]: string } = {
      '@r': '\u001b[0;31m',  // Red
      '@R': '\u001b[1;31m',  // Bright Red
      '@g': '\u001b[0;32m',  // Green
      '@G': '\u001b[1;32m',  // Bright Green
      '@y': '\u001b[0;33m',  // Yellow
      '@Y': '\u001b[1;33m',  // Bright Yellow
      '@b': '\u001b[0;34m',  // Blue
      '@B': '\u001b[1;34m',  // Bright Blue
      '@m': '\u001b[0;35m',  // Magenta
      '@M': '\u001b[1;35m',  // Bright Magenta
      '@c': '\u001b[0;36m',  // Cyan
      '@C': '\u001b[1;36m',  // Bright Cyan
      '@w': '\u001b[0;37m',  // White
      '@W': '\u001b[1;37m',  // Bright White
      '@x': '\u001b[0m',     // Reset
      '@D': '\u001b[1;30m',  // Dark Gray
      '@d': '\u001b[0;30m',  // Black
    };

    // Handle @x### codes (xterm 256 colors)
    content = content.replace(/@x(\d{3})/g, (match, code) => {
      const colorCode = parseInt(code);
      if (colorCode >= 0 && colorCode <= 255) {
        return `\u001b[38;5;${colorCode}m`;
      }
      return match;
    });

    // Replace standard color codes
    for (const [code, ansi] of Object.entries(colorMap)) {
      content = content.replace(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ansi);
    }

    // Ensure we end with a reset
    if (!content.endsWith('\u001b[0m')) {
      content += '\u001b[0m';
    }

    return content;
  }
}