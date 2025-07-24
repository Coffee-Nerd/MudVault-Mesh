import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import redisService from '../services/redis';

export interface JWTPayload {
  mudName: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  mud?: {
    name: string;
    authenticated: boolean;
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export class AuthService {
  private apiKeys: Map<string, string> = new Map(); // mudName -> hashedApiKey
  private activeSessions: Set<string> = new Set(); // Set of active JWT tokens

  constructor() {
    this.loadApiKeysFromRedis();
  }

  private async loadApiKeysFromRedis(): Promise<void> {
    try {
      const keys = await redisService.smembers('api_keys');
      
      for (const mudName of keys) {
        const hashedKey = await redisService.get(`api_key:${mudName}`);
        if (hashedKey) {
          this.apiKeys.set(mudName, hashedKey);
        }
      }
      
      logger.info(`Loaded ${this.apiKeys.size} API keys from Redis`);
    } catch (error) {
      logger.error('Error loading API keys from Redis:', error);
    }
  }

  public async generateApiKey(mudName: string, adminSecret?: string): Promise<string> {
    // Simple admin verification for initial setup
    if (adminSecret && adminSecret !== process.env.ADMIN_SECRET) {
      throw new Error('Invalid admin secret');
    }

    const apiKey = this.generateRandomKey();
    const hashedKey = await bcrypt.hash(apiKey, 12);
    
    this.apiKeys.set(mudName, hashedKey);
    
    // Store in Redis
    await redisService.set(`api_key:${mudName}`, hashedKey);
    await redisService.sadd('api_keys', mudName);
    
    logger.info(`Generated API key for MUD: ${mudName}`);
    
    return apiKey;
  }

  public async validateApiKey(mudName: string, apiKey: string): Promise<boolean> {
    let hashedKey = this.apiKeys.get(mudName);
    
    // If not in memory cache, try to load from Redis
    if (!hashedKey) {
      try {
        const redisKey = await redisService.get(`api_key:${mudName}`);
        if (redisKey) {
          hashedKey = redisKey;
          this.apiKeys.set(mudName, hashedKey);
          logger.info(`Loaded API key for ${mudName} from Redis`);
        } else {
          return false;
        }
      } catch (error) {
        logger.error(`Error loading API key for ${mudName} from Redis:`, error);
        return false;
      }
    }

    try {
      return await bcrypt.compare(apiKey, hashedKey);
    } catch (error) {
      logger.error(`Error validating API key for ${mudName}:`, error);
      return false;
    }
  }

  public async revokeApiKey(mudName: string): Promise<void> {
    this.apiKeys.delete(mudName);
    
    await redisService.del(`api_key:${mudName}`);
    await redisService.srem('api_keys', mudName);
    
    logger.info(`Revoked API key for MUD: ${mudName}`);
  }

  public generateJWT(mudName: string): string {
    const payload: JWTPayload = {
      mudName,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.parseExpiration(JWT_EXPIRES_IN)
    };

    const token = jwt.sign(payload, JWT_SECRET);
    this.activeSessions.add(token);
    
    return token;
  }

  public verifyJWT(token: string): JWTPayload | null {
    try {
      if (!this.activeSessions.has(token)) {
        return null;
      }

      const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
      return payload;
    } catch (error) {
      logger.warn('Invalid JWT token:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  public revokeJWT(token: string): void {
    this.activeSessions.delete(token);
  }

  public async authenticateWithApiKey(mudName: string, apiKey: string): Promise<string | null> {
    const isValid = await this.validateApiKey(mudName, apiKey);
    if (!isValid) {
      return null;
    }

    return this.generateJWT(mudName);
  }

  private generateRandomKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }

  private parseExpiration(expiration: string): number {
    const unit = expiration.slice(-1);
    const value = parseInt(expiration.slice(0, -1));
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600; // Default to 1 hour
    }
  }

  public cleanupExpiredSessions(): void {
    const now = Math.floor(Date.now() / 1000);
    
    for (const token of this.activeSessions) {
      try {
        const payload = jwt.decode(token) as JWTPayload;
        if (payload && payload.exp < now) {
          this.activeSessions.delete(token);
        }
      } catch (error) {
        this.activeSessions.delete(token);
      }
    }
  }

  public getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  public getMudNames(): string[] {
    return Array.from(this.apiKeys.keys());
  }
}

export const authService = new AuthService();

// Middleware for JWT authentication
export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  const payload = authService.verifyJWT(token);
  if (!payload) {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }

  req.mud = {
    name: payload.mudName,
    authenticated: true
  };

  next();
}

// Middleware for API key authentication
export function authenticateApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  const mudName = req.headers['x-mud-name'] as string;

  if (!apiKey || !mudName) {
    res.status(401).json({ error: 'API key and MUD name required' });
    return;
  }

  authService.validateApiKey(mudName, apiKey).then(isValid => {
    if (!isValid) {
      res.status(403).json({ error: 'Invalid API key' });
      return;
    }

    req.mud = {
      name: mudName,
      authenticated: true
    };

    next();
  }).catch(error => {
    logger.error('Error validating API key:', error);
    res.status(500).json({ error: 'Internal server error' });
  });
}

// Combined authentication middleware (JWT or API Key)
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string;
  
  if (authHeader) {
    authenticateJWT(req, res, next);
  } else if (apiKey) {
    authenticateApiKey(req, res, next);
  } else {
    res.status(401).json({ error: 'Authentication required (JWT or API key)' });
  }
}

// Start cleanup interval
setInterval(() => {
  authService.cleanupExpiredSessions();
}, 60000); // Every minute

export default authService;