import { User as DiscordUser } from 'discord.js';

export interface BridgeConfig {
  discord: {
    token: string;
    guildId: string;
    bridgeChannelId: string;
    adminRoleId?: string;
    verificationChannelId?: string;
  };
  mudvault: {
    url: string;
    apiKey: string;
    mudName: string;
    channels: string[];
  };
  security: {
    requireVerification: boolean;
    rateLimit: {
      messagesPerMinute: number;
      commandsPerMinute: number;
    };
    allowedMuds?: string[];
    blockedUsers?: string[];
  };
}

export interface UserMapping {
  discordId: string;
  mudName: string;
  mudUsername: string;
  verified: boolean;
  verifiedAt?: Date;
  verificationCode?: string;
  lastMessageAt?: Date;
  messageCount: number;
}

export interface ChannelMapping {
  discordChannelId: string;
  mudvaultChannel: string;
  twoWay: boolean;
  filters?: MessageFilter[];
}

export interface MessageFilter {
  type: 'user' | 'content' | 'mud';
  pattern: string | RegExp;
  action: 'block' | 'allow';
}

export interface BridgedMessage {
  id: string;
  originalId: string;
  source: 'discord' | 'mudvault';
  author: {
    id: string;
    username: string;
    displayName?: string;
  };
  content: string;
  timestamp: Date;
  channel?: string;
  attachments?: Array<{
    url: string;
    name: string;
    size: number;
  }>;
  metadata?: {
    room?: string;
    area?: string;
    level?: number;
    class?: string;
    guild?: string;
    [key: string]: any;
  };
}

export interface VerificationRequest {
  discordUser: DiscordUser;
  mudName: string;
  mudUsername: string;
  code: string;
  expiresAt: Date;
}