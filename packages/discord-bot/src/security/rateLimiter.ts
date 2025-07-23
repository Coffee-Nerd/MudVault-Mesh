import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { Redis } from 'redis';
import { BridgeConfig } from '../types';

export class BridgeRateLimiter {
  private messageLimiter: RateLimiterRedis;
  private commandLimiter: RateLimiterRedis;
  private globalLimiter: RateLimiterRedis;

  constructor(redis: Redis, config: BridgeConfig) {
    // Per-user message rate limiter
    this.messageLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:msg',
      points: config.security.rateLimit.messagesPerMinute,
      duration: 60, // 1 minute
      blockDuration: 60 * 5, // 5 minute block if exceeded
    });

    // Per-user command rate limiter
    this.commandLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:cmd',
      points: config.security.rateLimit.commandsPerMinute,
      duration: 60, // 1 minute
      blockDuration: 60 * 10, // 10 minute block if exceeded
    });

    // Global rate limiter (prevent overall spam)
    this.globalLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl:global',
      points: config.security.rateLimit.messagesPerMinute * 10, // 10x individual limit
      duration: 60, // 1 minute
    });
  }

  /**
   * Check if a message is allowed
   */
  async checkMessage(userId: string): Promise<{
    allowed: boolean;
    retryAfter?: number;
    reason?: string;
  }> {
    try {
      // Check global limit first
      await this.globalLimiter.consume('global', 1);
      
      // Then check user limit
      await this.messageLimiter.consume(userId, 1);
      
      return { allowed: true };
    } catch (rateLimiterRes) {
      const res = rateLimiterRes as RateLimiterRes;
      return {
        allowed: false,
        retryAfter: Math.round(res.msBeforeNext / 1000),
        reason: res.totalHits > res.points * 2 ? 'spam' : 'rate_limit'
      };
    }
  }

  /**
   * Check if a command is allowed
   */
  async checkCommand(userId: string): Promise<{
    allowed: boolean;
    retryAfter?: number;
  }> {
    try {
      await this.commandLimiter.consume(userId, 1);
      return { allowed: true };
    } catch (rateLimiterRes) {
      const res = rateLimiterRes as RateLimiterRes;
      return {
        allowed: false,
        retryAfter: Math.round(res.msBeforeNext / 1000)
      };
    }
  }

  /**
   * Reset limits for a user (admin action)
   */
  async resetUserLimits(userId: string): Promise<void> {
    await this.messageLimiter.delete(userId);
    await this.commandLimiter.delete(userId);
  }

  /**
   * Get current usage for a user
   */
  async getUserUsage(userId: string): Promise<{
    messages: { used: number; remaining: number };
    commands: { used: number; remaining: number };
  }> {
    const [msgRes, cmdRes] = await Promise.all([
      this.messageLimiter.get(userId),
      this.commandLimiter.get(userId)
    ]);

    return {
      messages: {
        used: msgRes?.consumedPoints || 0,
        remaining: msgRes ? msgRes.remainingPoints : this.messageLimiter.points
      },
      commands: {
        used: cmdRes?.consumedPoints || 0,
        remaining: cmdRes ? cmdRes.remainingPoints : this.commandLimiter.points
      }
    };
  }

  /**
   * Apply penalties for spam behavior
   */
  async applySpamPenalty(userId: string, severity: 'low' | 'medium' | 'high'): Promise<void> {
    const penalties = {
      low: 60 * 5,      // 5 minutes
      medium: 60 * 30,  // 30 minutes
      high: 60 * 60 * 24 // 24 hours
    };

    const blockDuration = penalties[severity];
    
    // Block both message and command limits
    await Promise.all([
      this.messageLimiter.block(userId, blockDuration),
      this.commandLimiter.block(userId, blockDuration)
    ]);
  }
}