import crypto from 'crypto';
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

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === 'your-secret-key-change-this') {
  throw new Error('JWT_SECRET must be set to a strong value');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const MAX_SESSIONS_PER_MUD = 8;
const MAX_API_KEY_LENGTH = 128;
// Compared against when a name is unknown, so timing does not reveal which MUDs exist.
// It is the hash of a discarded random value, and costs nothing at startup.
const DUMMY_HASH = '$2b$12$GHmbBdMBUNlneKlCof4P8eJkDRBpsT3ZWTvMBu/HTthLN56ugi0G.';
const RESERVED_NAMES = new Set(['gateway', 'system', 'admin', 'mudvault']);

export class AuthService {
  private apiKeys: Map<string, string> = new Map(); // mudName -> hashedApiKey
  private activeSessions: Set<string> = new Set(); // Set of active JWT tokens
  private sessionsByMud: Map<string, Set<string>> = new Map();

  constructor() {
    // This service is created before Redis connects, so load once it is ready.
    redisService.onReady(() => void this.loadApiKeysFromRedis());
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

  public adminSecretValid(provided?: unknown): boolean {
    const expected = process.env.ADMIN_SECRET;
    if (!expected || expected.length < 32 || typeof provided !== 'string') {
      return false;
    }
    const a = crypto.createHash('sha256').update(provided).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  }

  public async generateApiKey(mudName: string, adminSecret?: string, rotate = false): Promise<string> {
    if (!this.adminSecretValid(adminSecret)) {
      throw new Error('FORBIDDEN');
    }

    if (RESERVED_NAMES.has(mudName.toLowerCase())) {
      throw new Error('RESERVED');
    }

    // Names are case-insensitive on the mesh, so "dark-wizardry" must not be
    // able to coexist with "Dark-Wizardry" under a different key.
    const registered = await redisService.smembers('api_keys');
    const clash = registered.find(n => n.toLowerCase() === mudName.toLowerCase());
    if (clash && (!rotate || clash !== mudName)) {
      throw new Error('EXISTS');
    }
    if (clash) {
      // A rotated key must also end sessions opened with the old one.
      this.dropSessions(clash);
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
    if (typeof mudName !== 'string' || typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > MAX_API_KEY_LENGTH) {
      return false;
    }

    let hashedKey = this.apiKeys.get(mudName);
    if (!hashedKey) {
      try {
        const stored = await redisService.get(`api_key:${mudName}`);
        if (stored) {
          hashedKey = stored;
          this.apiKeys.set(mudName, stored);
        }
      } catch (error) {
        logger.error(`Error loading API key for ${mudName} from Redis:`, error);
      }
    }

    try {
      const matches = await bcrypt.compare(apiKey, hashedKey ?? DUMMY_HASH);
      return matches && hashedKey !== undefined;
    } catch (error) {
      logger.error(`Error validating API key for ${mudName}:`, error);
      return false;
    }
  }

  /** Finds the registered spelling of a name, which may differ in capitals. */
  public async registeredName(mudName: string): Promise<string | undefined> {
    const registered = await redisService.smembers('api_keys');
    return registered.find(name => name.toLowerCase() === mudName.toLowerCase());
  }

  public async revokeApiKey(mudName: string): Promise<void> {
    this.apiKeys.delete(mudName);
    this.dropSessions(mudName);
    
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

    const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
    this.activeSessions.add(token);

    // Reconnects mint new tokens, so keep only the newest few per MUD.
    let tokens = this.sessionsByMud.get(mudName);
    if (!tokens) {
      tokens = new Set();
      this.sessionsByMud.set(mudName, tokens);
    }
    tokens.add(token);
    if (tokens.size > MAX_SESSIONS_PER_MUD) {
      const oldest = tokens.values().next().value as string;
      tokens.delete(oldest);
      this.activeSessions.delete(oldest);
    }

    return token;
  }

  public verifyJWT(token: string): JWTPayload | null {
    try {
      if (!this.activeSessions.has(token)) {
        return null;
      }

      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JWTPayload;
      return payload;
    } catch (error) {
      logger.warn('Invalid JWT token:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  public dropSessions(mudName: string): void {
    const tokens = this.sessionsByMud.get(mudName);
    if (tokens) {
      for (const token of tokens) {
        this.activeSessions.delete(token);
      }
      this.sessionsByMud.delete(mudName);
    }
  }

  public revokeJWT(token: string): void {
    this.activeSessions.delete(token);
    const payload = jwt.decode(token) as JWTPayload | null;
    if (payload?.mudName) {
      this.sessionsByMud.get(payload.mudName)?.delete(token);
    }
  }

  public async authenticateWithApiKey(mudName: string, apiKey: string): Promise<string | null> {
    const isValid = await this.validateApiKey(mudName, apiKey);
    if (!isValid) {
      return null;
    }

    return this.generateJWT(mudName);
  }

  private generateRandomKey(): string {
    return crypto.randomBytes(32).toString('hex');
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
          this.revokeJWT(token);
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
}, 60000).unref(); // Every minute

export default authService;