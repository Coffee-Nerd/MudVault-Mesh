import { EventEmitter } from 'events';
import { MudVaultClient } from 'mudvault-mesh';
import { BridgeConfig, BridgedMessage, UserMapping } from '../types';
import winston from 'winston';

export class MudVaultBridgeClient extends EventEmitter {
  private client: MudVaultClient;
  private config: BridgeConfig;
  private logger: winston.Logger;
  private connected = false;
  private messageQueue: BridgedMessage[] = [];

  constructor(config: BridgeConfig, logger: winston.Logger) {
    super();
    this.config = config;
    this.logger = logger;

    this.client = new MudVaultClient({
      mudName: config.mudvault.mudName,
      url: config.mudvault.url,
      apiKey: config.mudvault.apiKey,
      reconnect: true,
      heartbeatInterval: 30000
    });

    this.setupEventHandlers();
  }

  /**
   * Connect to MudVault Mesh
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnect from MudVault Mesh
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    await this.client.disconnect();
  }

  /**
   * Setup MudVault event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('connected', () => {
      this.logger.info('Connected to MudVault Mesh');
      this.connected = true;
      
      // Join configured channels
      this.config.mudvault.channels.forEach(channel => {
        this.client.joinChannel(channel);
      });

      // Process queued messages
      this.processMessageQueue();
      
      this.emit('connected');
    });

    this.client.on('disconnected', () => {
      this.logger.warn('Disconnected from MudVault Mesh');
      this.connected = false;
      this.emit('disconnected');
    });

    this.client.on('tell', (message) => {
      this.handleIncomingMessage(message, 'tell');
    });

    this.client.on('channel', (message) => {
      this.handleIncomingMessage(message, 'channel');
    });

    this.client.on('who', (message) => {
      this.emit('who', message.payload.users);
    });

    this.client.on('presence', (message) => {
      this.emit('presence', message);
    });

    this.client.on('error', (error) => {
      this.logger.error('MudVault client error', error);
      this.emit('error', error);
    });

    // Handle verification requests from MUD side
    this.client.on('message', (message) => {
      if (message.type === 'custom' && message.payload.type === 'discord_verify') {
        this.handleVerificationMessage(message);
      }
    });
  }

  /**
   * Handle incoming messages from MudVault
   */
  private handleIncomingMessage(message: any, type: 'tell' | 'channel'): void {
    // Check if this message is from an allowed MUD
    if (this.config.security.allowedMuds && 
        !this.config.security.allowedMuds.includes(message.from.mud)) {
      this.logger.debug('Ignoring message from non-allowed MUD', {
        mud: message.from.mud
      });
      return;
    }

    // Convert to bridged message format
    const bridgedMessage: BridgedMessage = {
      id: message.id,
      originalId: message.id,
      source: 'mudvault',
      author: {
        id: `${message.from.mud}:${message.from.user}`,
        username: message.from.user || 'Unknown',
        displayName: `${message.from.user}@${message.from.mud}`
      },
      content: message.payload.message,
      timestamp: new Date(message.timestamp),
      channel: type === 'channel' ? message.to.channel : undefined
    };

    // Emit for the bridge to handle
    this.emit('message', bridgedMessage);
  }

  /**
   * Handle verification messages from MUD
   */
  private handleVerificationMessage(message: any): void {
    const { code, mudName, username } = message.payload;
    this.emit('verification', { code, mudName, username });
  }

  /**
   * Send a message to MudVault from Discord
   */
  async sendMessage(
    message: BridgedMessage, 
    mapping: UserMapping,
    channel?: string
  ): Promise<void> {
    if (!this.connected) {
      // Queue the message
      this.messageQueue.push(message);
      return;
    }

    try {
      if (channel || this.config.mudvault.channels[0]) {
        // Send as channel message
        await this.client.sendChannel(
          channel || this.config.mudvault.channels[0],
          message.content,
          {
            discordId: message.author.id,
            discordUsername: message.author.displayName
          }
        );
      } else {
        // Send as broadcast tell
        await this.client.sendBroadcast(
          message.content,
          {
            discordId: message.author.id,
            discordUsername: message.author.displayName
          }
        );
      }
    } catch (error) {
      this.logger.error('Failed to send message to MudVault', error);
      throw error;
    }
  }

  /**
   * Process queued messages
   */
  private async processMessageQueue(): Promise<void> {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          // We need the mapping for queued messages
          // In real implementation, this would be stored with the message
          this.logger.info('Processing queued message', { id: message.id });
        } catch (error) {
          this.logger.error('Failed to process queued message', error);
        }
      }
    }
  }

  /**
   * Get who list from MudVault
   */
  async getWhoList(): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected to MudVault');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Who list request timed out'));
      }, 5000);

      this.client.once('who', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.client.sendWho();
    });
  }

  /**
   * Get channel list
   */
  getChannels(): string[] {
    return this.config.mudvault.channels;
  }

  /**
   * Send verification confirmation to MUD
   */
  async sendVerificationConfirmation(
    mudName: string,
    username: string,
    discordTag: string
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to MudVault');
    }

    // Send custom message type for verification confirmation
    await this.client.send({
      type: 'custom',
      to: { mud: mudName, user: username },
      payload: {
        type: 'discord_verify_complete',
        discordTag,
        message: `Your Discord account (${discordTag}) has been successfully linked!`
      }
    });
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connected: boolean;
    queuedMessages: number;
    connectedMuds: number;
  } {
    return {
      connected: this.connected,
      queuedMessages: this.messageQueue.length,
      connectedMuds: this.client.getConnectedMuds ? this.client.getConnectedMuds().length : 0
    };
  }
}