import { EventEmitter } from 'events';
import { Channel, ChannelMessage, MudVaultMessage, MessageEndpoint } from '../types';
import { createChannelMessage } from '../utils/message';
import logger from '../utils/logger';
import redisService from './redis';

export class ChannelService extends EventEmitter {
  private channels: Map<string, Channel> = new Map();
  private userChannels: Map<string, Set<string>> = new Map(); // user@mud -> set of channels

  constructor() {
    super();
    this.loadChannelsFromRedis();
  }

  private async loadChannelsFromRedis(): Promise<void> {
    try {
      const channelKeys = await redisService.smembers('active_channels');
      
      for (const channelName of channelKeys) {
        const channelData = await redisService.get(`channel:${channelName}`);
        if (channelData) {
          const channel: Channel = JSON.parse(channelData);
          this.channels.set(channelName, channel);
        }
      }
      
      logger.info(`Loaded ${this.channels.size} channels from Redis`);
    } catch (error) {
      logger.error('Error loading channels from Redis:', error);
    }
  }

  private async saveChannelToRedis(channel: Channel): Promise<void> {
    try {
      await redisService.set(`channel:${channel.name}`, JSON.stringify(channel));
      await redisService.sadd('active_channels', channel.name);
    } catch (error) {
      logger.error(`Error saving channel ${channel.name} to Redis:`, error);
    }
  }

  public async createChannel(
    name: string, 
    creator: MessageEndpoint,
    description?: string,
    password?: string
  ): Promise<Channel> {
    if (this.channels.has(name)) {
      throw new Error(`Channel ${name} already exists`);
    }

    const channel: Channel = {
      name,
      description,
      moderators: [`${creator.user}@${creator.mud}`],
      banned: [],
      password,
      mudRestricted: false,
      allowedMuds: [],
      history: []
    };

    this.channels.set(name, channel);
    await this.saveChannelToRedis(channel);

    logger.info(`Channel ${name} created by ${creator.user}@${creator.mud}`);
    return channel;
  }

  public async joinChannel(channelName: string, user: MessageEndpoint): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} does not exist`);
    }

    const userKey = `${user.user}@${user.mud}`;
    
    if (channel.banned.includes(userKey)) {
      throw new Error(`User ${userKey} is banned from channel ${channelName}`);
    }

    if (channel.mudRestricted && channel.allowedMuds.length > 0) {
      if (!channel.allowedMuds.includes(user.mud)) {
        throw new Error(`MUD ${user.mud} is not allowed in channel ${channelName}`);
      }
    }

    if (!this.userChannels.has(userKey)) {
      this.userChannels.set(userKey, new Set());
    }
    
    this.userChannels.get(userKey)!.add(channelName);

    const joinMessage = createChannelMessage(user, channelName, '', 'join');
    await this.addMessageToChannel(channelName, joinMessage);

    await redisService.sadd(`channel_members:${channelName}`, userKey);

    logger.info(`${userKey} joined channel ${channelName}`);
    
    this.emit('userJoined', { channel: channelName, user: userKey });
  }

  public async leaveChannel(channelName: string, user: MessageEndpoint): Promise<void> {
    const userKey = `${user.user}@${user.mud}`;
    const userChannelSet = this.userChannels.get(userKey);
    
    if (!userChannelSet || !userChannelSet.has(channelName)) {
      throw new Error(`User ${userKey} is not in channel ${channelName}`);
    }

    userChannelSet.delete(channelName);
    if (userChannelSet.size === 0) {
      this.userChannels.delete(userKey);
    }

    const leaveMessage = createChannelMessage(user, channelName, '', 'leave');
    await this.addMessageToChannel(channelName, leaveMessage);

    await redisService.srem(`channel_members:${channelName}`, userKey);

    logger.info(`${userKey} left channel ${channelName}`);
    
    this.emit('userLeft', { channel: channelName, user: userKey });
  }

  public async sendMessage(channelName: string, from: MessageEndpoint, message: string): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} does not exist`);
    }

    const userKey = `${from.user}@${from.mud}`;
    const userChannelSet = this.userChannels.get(userKey);
    
    if (!userChannelSet || !userChannelSet.has(channelName)) {
      throw new Error(`User ${userKey} is not in channel ${channelName}`);
    }

    if (channel.banned.includes(userKey)) {
      throw new Error(`User ${userKey} is banned from channel ${channelName}`);
    }

    const channelMessage = createChannelMessage(from, channelName, message, 'message');
    await this.addMessageToChannel(channelName, channelMessage);

    this.emit('messagePosted', { 
      channel: channelName, 
      message: channelMessage,
      userKey 
    });
  }

  private async addMessageToChannel(channelName: string, message: MudVaultMessage): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      return;
    }

    const channelMessage: ChannelMessage = {
      id: message.id,
      timestamp: message.timestamp,
      from: message.from,
      message: (message.payload as any).message || '',
      type: (message.payload as any).action || 'message'
    };

    channel.history.push(channelMessage);
    
    // Keep only last 100 messages in memory
    if (channel.history.length > 100) {
      channel.history = channel.history.slice(-100);
    }

    await this.saveChannelToRedis(channel);

    // Also store in Redis for persistence
    const historyKey = `channel_history:${channelName}`;
    await redisService.lpush(historyKey, JSON.stringify(channelMessage));
    await redisService.ltrim(historyKey, 0, 999); // Keep last 1000 messages
  }

  public getChannel(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  public getChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  public getUserChannels(user: MessageEndpoint): string[] {
    const userKey = `${user.user}@${user.mud}`;
    const userChannelSet = this.userChannels.get(userKey);
    return userChannelSet ? Array.from(userChannelSet) : [];
  }

  public async getChannelMembers(channelName: string): Promise<string[]> {
    try {
      return await redisService.smembers(`channel_members:${channelName}`);
    } catch (error) {
      logger.error(`Error getting members for channel ${channelName}:`, error);
      return [];
    }
  }

  public async getChannelHistory(channelName: string, limit: number = 50): Promise<ChannelMessage[]> {
    try {
      const historyData = await redisService.lrange(`channel_history:${channelName}`, 0, limit - 1);
      return historyData.map(data => JSON.parse(data));
    } catch (error) {
      logger.error(`Error getting history for channel ${channelName}:`, error);
      return [];
    }
  }

  public async banUser(channelName: string, targetUser: string, moderator: MessageEndpoint): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} does not exist`);
    }

    const moderatorKey = `${moderator.user}@${moderator.mud}`;
    if (!channel.moderators.includes(moderatorKey)) {
      throw new Error(`User ${moderatorKey} is not a moderator of channel ${channelName}`);
    }

    if (!channel.banned.includes(targetUser)) {
      channel.banned.push(targetUser);
      await this.saveChannelToRedis(channel);
    }

    // Remove user from channel if they're currently in it
    const userChannelSet = this.userChannels.get(targetUser);
    if (userChannelSet && userChannelSet.has(channelName)) {
      userChannelSet.delete(channelName);
      await redisService.srem(`channel_members:${channelName}`, targetUser);
    }

    logger.info(`${targetUser} was banned from channel ${channelName} by ${moderatorKey}`);
  }

  public async unbanUser(channelName: string, targetUser: string, moderator: MessageEndpoint): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} does not exist`);
    }

    const moderatorKey = `${moderator.user}@${moderator.mud}`;
    if (!channel.moderators.includes(moderatorKey)) {
      throw new Error(`User ${moderatorKey} is not a moderator of channel ${channelName}`);
    }

    const banIndex = channel.banned.indexOf(targetUser);
    if (banIndex !== -1) {
      channel.banned.splice(banIndex, 1);
      await this.saveChannelToRedis(channel);
    }

    logger.info(`${targetUser} was unbanned from channel ${channelName} by ${moderatorKey}`);
  }

  public async deleteChannel(channelName: string, user: MessageEndpoint): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Channel ${channelName} does not exist`);
    }

    const userKey = `${user.user}@${user.mud}`;
    if (!channel.moderators.includes(userKey)) {
      throw new Error(`User ${userKey} is not a moderator of channel ${channelName}`);
    }

    // Remove all users from the channel
    for (const [userKey, channelSet] of this.userChannels) {
      channelSet.delete(channelName);
      if (channelSet.size === 0) {
        this.userChannels.delete(userKey);
      }
    }

    // Clean up Redis
    await redisService.del(`channel:${channelName}`);
    await redisService.del(`channel_members:${channelName}`);
    await redisService.del(`channel_history:${channelName}`);
    await redisService.srem('active_channels', channelName);

    this.channels.delete(channelName);

    logger.info(`Channel ${channelName} deleted by ${userKey}`);
    
    this.emit('channelDeleted', { channel: channelName, deletedBy: userKey });
  }
}

export default new ChannelService();