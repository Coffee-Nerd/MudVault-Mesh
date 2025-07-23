import { EventEmitter } from 'events';
import { Redis } from 'redis';
import winston from 'winston';
import { CommandInteraction } from 'discord.js';
import { BridgeConfig, BridgedMessage, UserMapping } from './types';
import { DiscordBot } from './bot/DiscordBot';
import { MudVaultBridgeClient } from './mudvault/MudVaultClient';
import { VerificationManager } from './security/verification';
import { BridgeRateLimiter } from './security/rateLimiter';
import { MessageFormatter } from './utils/formatters';

export class MudVaultDiscordBridge extends EventEmitter {
  private config: BridgeConfig;
  private redis: Redis;
  private logger: winston.Logger;
  private discordBot: DiscordBot;
  private mudvaultClient: MudVaultBridgeClient;
  private verificationManager: VerificationManager;
  private rateLimiter: BridgeRateLimiter;
  private running = false;

  constructor(config: BridgeConfig, redis: Redis, logger: winston.Logger) {
    super();
    this.config = config;
    this.redis = redis;
    this.logger = logger;

    // Initialize components
    this.verificationManager = new VerificationManager(redis);
    this.rateLimiter = new BridgeRateLimiter(redis, config);
    this.discordBot = new DiscordBot(config, this.verificationManager, this.rateLimiter, logger);
    this.mudvaultClient = new MudVaultBridgeClient(config, logger);

    this.setupEventHandlers();
  }

  /**
   * Start the bridge
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Bridge already running');
    }

    this.logger.info('Starting MudVault-Discord bridge...');

    try {
      // Connect to both services
      await Promise.all([
        this.discordBot.connect(),
        this.mudvaultClient.connect()
      ]);

      this.running = true;
      this.logger.info('Bridge started successfully');
      this.emit('started');
    } catch (error) {
      this.logger.error('Failed to start bridge', error);
      throw error;
    }
  }

  /**
   * Stop the bridge
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping MudVault-Discord bridge...');

    try {
      await Promise.all([
        this.discordBot.disconnect(),
        this.mudvaultClient.disconnect()
      ]);

      this.running = false;
      this.logger.info('Bridge stopped successfully');
      this.emit('stopped');
    } catch (error) {
      this.logger.error('Error while stopping bridge', error);
      throw error;
    }
  }

  /**
   * Setup event handlers for bidirectional message flow
   */
  private setupEventHandlers(): void {
    // Discord -> MudVault
    this.discordBot.on('message', async (message: BridgedMessage, mapping: UserMapping) => {
      try {
        this.logger.debug('Bridging message from Discord to MudVault', {
          author: message.author.username,
          content: message.content.substring(0, 50)
        });

        await this.mudvaultClient.sendMessage(message, mapping);
        
        // Log successful bridge
        await this.logBridgedMessage(message, 'discord->mudvault');
      } catch (error) {
        this.logger.error('Failed to bridge message to MudVault', error);
      }
    });

    // MudVault -> Discord
    this.mudvaultClient.on('message', async (message: BridgedMessage) => {
      try {
        // Check if the sender is in our blocked list
        if (this.config.security.blockedUsers?.includes(message.author.id)) {
          this.logger.debug('Blocked message from blocked user', {
            user: message.author.id
          });
          return;
        }

        this.logger.debug('Bridging message from MudVault to Discord', {
          author: message.author.username,
          content: message.content.substring(0, 50)
        });

        await this.discordBot.sendMessage(message);
        
        // Log successful bridge
        await this.logBridgedMessage(message, 'mudvault->discord');
      } catch (error) {
        this.logger.error('Failed to bridge message to Discord', error);
      }
    });

    // Handle verification flow
    this.mudvaultClient.on('verification', async ({ code, mudName, username }) => {
      try {
        const mapping = await this.verificationManager.verifyCode(code, mudName, username);
        
        if (mapping) {
          // Get Discord user info
          const discordUser = await this.discordBot.client.users.fetch(mapping.discordId);
          
          // Send confirmation back to MUD
          await this.mudvaultClient.sendVerificationConfirmation(
            mudName,
            username,
            `${discordUser.username}#${discordUser.discriminator}`
          );

          // Send success message to verification channel or DM
          const successEmbed = MessageFormatter.formatVerificationSuccess(
            `${discordUser.username}#${discordUser.discriminator}`,
            mudName,
            username
          );

          // Try to send to verification channel first, then DM
          try {
            if (this.config.discord.verificationChannelId) {
              const verifyChannel = this.discordBot.client.channels.cache.get(this.config.discord.verificationChannelId);
              if (verifyChannel && verifyChannel.isTextBased()) {
                await verifyChannel.send({ embeds: [successEmbed] });
              }
            } else {
              // Send DM to user
              await discordUser.send({ embeds: [successEmbed] });
            }
          } catch (dmError) {
            this.logger.warn('Could not send verification success message', dmError);
          }

          this.logger.info('User verified successfully', {
            discordId: mapping.discordId,
            mudName,
            username
          });
        }
      } catch (error) {
        this.logger.error('Verification error', error);
      }
    });

    // Handle Discord commands that need MudVault data
    this.discordBot.on('command:who', async (interaction: CommandInteraction) => {
      try {
        const whoData = await this.mudvaultClient.getWhoList();
        
        // Format who list using the formatter
        const embeds = MessageFormatter.formatWhoList(whoData);
        
        if (embeds.length === 0) {
          await interaction.editReply('No MUDs are currently connected.');
        } else if (embeds.length === 1) {
          await interaction.editReply({ embeds });
        } else {
          // If multiple MUDs, send them in chunks to avoid Discord limits
          await interaction.editReply({ embeds: embeds.slice(0, 10) });
          
          if (embeds.length > 10) {
            // Send additional embeds as follow-up messages
            for (let i = 10; i < embeds.length; i += 10) {
              await interaction.followUp({ 
                embeds: embeds.slice(i, i + 10),
                ephemeral: true
              });
            }
          }
        }
      } catch (error) {
        this.logger.error('Failed to get who list', error);
        await interaction.editReply('Failed to fetch online players.');
      }
    });

    this.discordBot.on('command:channels', async (interaction: CommandInteraction) => {
      const channels = this.mudvaultClient.getChannels();
      const embed = MessageFormatter.formatChannelList(channels);
      await interaction.editReply({ embeds: [embed] });
    });

    // Handle connection events
    this.discordBot.on('ready', () => {
      this.emit('discord:ready');
    });

    this.mudvaultClient.on('connected', () => {
      this.emit('mudvault:connected');
    });

    this.mudvaultClient.on('disconnected', () => {
      this.emit('mudvault:disconnected');
    });

    // Handle errors
    this.discordBot.on('error', (error) => {
      this.logger.error('Discord bot error', error);
      this.emit('error', error);
    });

    this.mudvaultClient.on('error', (error) => {
      this.logger.error('MudVault client error', error);
      this.emit('error', error);
    });
  }

  /**
   * Log bridged messages for analytics and debugging
   */
  private async logBridgedMessage(message: BridgedMessage, direction: string): Promise<void> {
    const key = `bridge:messages:${new Date().toISOString().split('T')[0]}`;
    const logEntry = {
      id: message.id,
      direction,
      source: message.source,
      author: message.author.username,
      timestamp: message.timestamp,
      contentLength: message.content.length
    };

    await this.redis.lpush(key, JSON.stringify(logEntry));
    await this.redis.expire(key, 86400 * 7); // Keep logs for 7 days
  }

  /**
   * Get bridge statistics
   */
  async getStats(): Promise<{
    bridge: { running: boolean; uptime: number };
    discord: { connected: boolean; guilds: number; users: number };
    mudvault: { connected: boolean; queuedMessages: number };
    messages: { today: number; total: number };
    users: { verified: number };
  }> {
    const verifiedUsers = await this.verificationManager.getAllVerifiedUsers();
    const todayKey = `bridge:messages:${new Date().toISOString().split('T')[0]}`;
    const todayMessages = await this.redis.llen(todayKey);

    return {
      bridge: {
        running: this.running,
        uptime: process.uptime()
      },
      discord: {
        connected: this.discordBot.client?.user !== null,
        guilds: this.discordBot.client?.guilds.cache.size || 0,
        users: this.discordBot.client?.users.cache.size || 0
      },
      mudvault: this.mudvaultClient.getStats(),
      messages: {
        today: todayMessages,
        total: await this.getTotalMessages()
      },
      users: {
        verified: verifiedUsers.length
      }
    };
  }

  /**
   * Get total message count
   */
  private async getTotalMessages(): Promise<number> {
    const keys = await this.redis.keys('bridge:messages:*');
    let total = 0;
    
    for (const key of keys) {
      total += await this.redis.llen(key);
    }
    
    return total;
  }

  /**
   * Check if bridge is running
   */
  isRunning(): boolean {
    return this.running;
  }
}