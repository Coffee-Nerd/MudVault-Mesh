import { Redis } from 'redis';
import crypto from 'crypto';
import { UserMapping, VerificationRequest } from '../types';
import { User as DiscordUser } from 'discord.js';

export class VerificationManager {
  private redis: Redis;
  private verificationExpiry = 300; // 5 minutes

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Generate a verification code for a user
   */
  async createVerificationRequest(
    discordUser: DiscordUser,
    mudName: string,
    mudUsername: string
  ): Promise<string> {
    // Generate a secure 6-character code
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    
    const request: VerificationRequest = {
      discordUser: {
        id: discordUser.id,
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar
      },
      mudName,
      mudUsername,
      code,
      expiresAt: new Date(Date.now() + this.verificationExpiry * 1000)
    };

    // Store in Redis with expiry
    const key = `verification:${code}`;
    await this.redis.setex(
      key,
      this.verificationExpiry,
      JSON.stringify(request)
    );

    // Also store reverse lookup
    const userKey = `verification:user:${discordUser.id}`;
    await this.redis.setex(
      userKey,
      this.verificationExpiry,
      code
    );

    return code;
  }

  /**
   * Verify a code from MUD side
   */
  async verifyCode(
    code: string,
    mudName: string,
    mudUsername: string
  ): Promise<UserMapping | null> {
    const key = `verification:${code}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }

    const request: VerificationRequest = JSON.parse(data);
    
    // Validate the MUD details match
    if (request.mudName !== mudName || request.mudUsername !== mudUsername) {
      return null;
    }

    // Create user mapping
    const mapping: UserMapping = {
      discordId: request.discordUser.id,
      mudName,
      mudUsername,
      verified: true,
      verifiedAt: new Date(),
      messageCount: 0
    };

    // Store the mapping
    await this.storeUserMapping(mapping);

    // Clean up verification data
    await this.redis.del(key);
    await this.redis.del(`verification:user:${request.discordUser.id}`);

    return mapping;
  }

  /**
   * Store user mapping in Redis
   */
  async storeUserMapping(mapping: UserMapping): Promise<void> {
    const key = `user:${mapping.discordId}`;
    await this.redis.set(key, JSON.stringify(mapping));
    
    // Also store reverse lookup
    const mudKey = `user:mud:${mapping.mudName}:${mapping.mudUsername}`;
    await this.redis.set(mudKey, mapping.discordId);
  }

  /**
   * Get user mapping by Discord ID
   */
  async getUserMapping(discordId: string): Promise<UserMapping | null> {
    const key = `user:${discordId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * Get user mapping by MUD credentials
   */
  async getUserMappingByMud(
    mudName: string,
    mudUsername: string
  ): Promise<UserMapping | null> {
    const mudKey = `user:mud:${mudName}:${mudUsername}`;
    const discordId = await this.redis.get(mudKey);
    
    if (!discordId) {
      return null;
    }

    return this.getUserMapping(discordId);
  }

  /**
   * Check if a user has a pending verification
   */
  async hasPendingVerification(discordId: string): Promise<string | null> {
    const userKey = `verification:user:${discordId}`;
    return await this.redis.get(userKey);
  }

  /**
   * Revoke a user's verification
   */
  async revokeVerification(discordId: string): Promise<boolean> {
    const mapping = await this.getUserMapping(discordId);
    
    if (!mapping) {
      return false;
    }

    // Delete mapping
    await this.redis.del(`user:${discordId}`);
    await this.redis.del(`user:mud:${mapping.mudName}:${mapping.mudUsername}`);
    
    return true;
  }

  /**
   * Update message statistics for rate limiting
   */
  async updateMessageStats(discordId: string): Promise<void> {
    const mapping = await this.getUserMapping(discordId);
    
    if (!mapping) {
      return;
    }

    mapping.lastMessageAt = new Date();
    mapping.messageCount++;
    
    await this.storeUserMapping(mapping);
  }

  /**
   * Get all verified users
   */
  async getAllVerifiedUsers(): Promise<UserMapping[]> {
    const keys = await this.redis.keys('user:*');
    const users: UserMapping[] = [];
    
    for (const key of keys) {
      if (!key.includes(':mud:')) {
        const data = await this.redis.get(key);
        if (data) {
          users.push(JSON.parse(data));
        }
      }
    }
    
    return users.filter(u => u.verified);
  }
}