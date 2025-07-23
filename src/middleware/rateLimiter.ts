import { RateLimiterRedis } from 'rate-limiter-flexible';
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';
import logger from '../utils/logger';
import { AuthenticatedRequest } from './auth';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  password: process.env.REDIS_PASSWORD || undefined
});

redisClient.connect().catch(console.error);

// Rate limiting configurations
const rateLimiterConfigs = {
  // Global API rate limiter
  api: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_api',
    points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
    duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000') / 1000,
    blockDuration: 60,
  }),

  // Per-MUD rate limiter
  mud: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_mud',
    points: 200, // More generous for authenticated MUDs
    duration: 60,
    blockDuration: 60,
  }),

  // Authentication endpoint rate limiter
  auth: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_auth',
    points: 5, // Very restrictive for auth attempts
    duration: 300, // 5 minutes
    blockDuration: 900, // 15 minutes block
  }),

  // WebSocket connection rate limiter
  websocket: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_ws',
    points: 10, // 10 connections per IP
    duration: 60,
    blockDuration: 300,
  }),

  // Message rate limiter (for WebSocket messages)
  message: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_msg',
    points: 100, // 100 messages per minute per MUD
    duration: 60,
    blockDuration: 60,
  }),

  // Channel message rate limiter
  channel: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_channel',
    points: 50, // 50 channel messages per minute
    duration: 60,
    blockDuration: 120,
  }),

  // Tell message rate limiter
  tell: new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_tell',
    points: 30, // 30 tells per minute
    duration: 60,
    blockDuration: 120,
  })
};

export function createRateLimitMiddleware(limiterType: keyof typeof rateLimiterConfigs) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const limiter = rateLimiterConfigs[limiterType];
    const key = getKey(req, limiterType);

    try {
      await limiter.consume(key);
      next();
    } catch (rateLimiterRes: any) {
      const remainingPoints = rateLimiterRes?.remainingPoints || 0;
      const totalHits = rateLimiterRes?.totalHits || 0;
      const msBeforeNext = rateLimiterRes?.msBeforeNext || 0;

      res.set({
        'Retry-After': Math.round(msBeforeNext / 1000) || 1,
        'X-RateLimit-Limit': limiter.points,
        'X-RateLimit-Remaining': remainingPoints,
        'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString(),
      });

      logger.warn(`Rate limit exceeded for ${limiterType}: ${key} (${totalHits} hits)`);
      
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for ${limiterType}`,
        retryAfter: Math.round(msBeforeNext / 1000),
      });
    }
  };
}

function getKey(req: Request, limiterType: string): string {
  const authReq = req as AuthenticatedRequest;
  
  switch (limiterType) {
    case 'mud':
      return authReq.mud?.name || req.ip || 'unknown';
    case 'auth':
      return req.ip || 'unknown';
    case 'api':
      return authReq.mud?.name || req.ip || 'unknown';
    default:
      return req.ip || 'unknown';
  }
}

export async function checkWebSocketRateLimit(ip: string): Promise<boolean> {
  try {
    await rateLimiterConfigs.websocket.consume(ip);
    return true;
  } catch (rateLimiterRes) {
    logger.warn(`WebSocket rate limit exceeded for IP: ${ip}`);
    return false;
  }
}

export async function checkMessageRateLimit(mudName: string, messageType?: string): Promise<boolean> {
  try {
    // Check general message rate limit
    await rateLimiterConfigs.message.consume(mudName);
    
    // Check specific message type rate limits
    if (messageType === 'channel') {
      await rateLimiterConfigs.channel.consume(mudName);
    } else if (messageType === 'tell') {
      await rateLimiterConfigs.tell.consume(mudName);
    }
    
    return true;
  } catch (rateLimiterRes) {
    logger.warn(`Message rate limit exceeded for MUD: ${mudName}, type: ${messageType || 'general'}`);
    return false;
  }
}

export async function resetRateLimit(key: string, limiterType: keyof typeof rateLimiterConfigs): Promise<void> {
  try {
    const limiter = rateLimiterConfigs[limiterType];
    await limiter.delete(key);
    logger.info(`Rate limit reset for ${limiterType}: ${key}`);
  } catch (error) {
    logger.error(`Error resetting rate limit for ${limiterType}: ${key}`, error);
  }
}

export async function getRateLimitInfo(key: string, limiterType: keyof typeof rateLimiterConfigs): Promise<any> {
  try {
    const limiter = rateLimiterConfigs[limiterType];
    const res = await limiter.get(key);
    
    if (!res) {
      return {
        points: limiter.points,
        remaining: limiter.points,
        reset: null,
        blocked: false
      };
    }

    return {
      points: limiter.points,
      remaining: res.remainingPoints,
      reset: new Date(Date.now() + res.msBeforeNext),
      blocked: res.msBeforeNext > 0 && res.remainingPoints <= 0
    };
  } catch (error) {
    logger.error(`Error getting rate limit info for ${limiterType}: ${key}`, error);
    return null;
  }
}

export function createBurstProtection(points: number, duration: number, blockDuration: number) {
  return new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'rl_burst',
    points,
    duration,
    blockDuration,
    execEvenly: true, // Spread requests evenly across duration
  });
}

// Middleware exports
export const apiRateLimit = createRateLimitMiddleware('api');
export const mudRateLimit = createRateLimitMiddleware('mud');
export const authRateLimit = createRateLimitMiddleware('auth');

// Advanced rate limiting for high-priority operations
export async function checkPriorityRateLimit(mudName: string, priority: number): Promise<boolean> {
  const multiplier = Math.max(0.5, (11 - priority) / 10); // Higher priority = more generous limits
  const adjustedPoints = Math.floor(rateLimiterConfigs.message.points * multiplier);
  
  const priorityLimiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: `rl_priority_${priority}`,
    points: adjustedPoints,
    duration: 60,
    blockDuration: 60,
  });

  try {
    await priorityLimiter.consume(mudName);
    return true;
  } catch (rateLimiterRes) {
    logger.warn(`Priority rate limit exceeded for MUD: ${mudName}, priority: ${priority}`);
    return false;
  }
}

export default {
  createRateLimitMiddleware,
  checkWebSocketRateLimit,
  checkMessageRateLimit,
  resetRateLimit,
  getRateLimitInfo,
  apiRateLimit,
  mudRateLimit,
  authRateLimit,
  checkPriorityRateLimit
};