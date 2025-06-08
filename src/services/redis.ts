import { createClient, RedisClientType } from 'redis';
import logger from '../utils/logger';

class RedisService {
  private client: RedisClientType;
  private connected: boolean = false;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      password: process.env.REDIS_PASSWORD || undefined,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000)
      }
    });

    this.client.on('error', (err) => {
      logger.error('Redis client error:', err);
    });

    this.client.on('connect', () => {
      logger.info('Connected to Redis');
      this.connected = true;
    });

    this.client.on('disconnect', () => {
      logger.warn('Disconnected from Redis');
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      this.connected = false;
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error(`Error setting key ${key}:`, error);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Error getting key ${key}:`, error);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error(`Error deleting key ${key}:`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Error checking existence of key ${key}:`, error);
      throw error;
    }
  }

  async lpush(key: string, value: string): Promise<void> {
    try {
      await this.client.lPush(key, value);
    } catch (error) {
      logger.error(`Error pushing to list ${key}:`, error);
      throw error;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      logger.error(`Error getting range from list ${key}:`, error);
      throw error;
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    try {
      await this.client.lTrim(key, start, stop);
    } catch (error) {
      logger.error(`Error trimming list ${key}:`, error);
      throw error;
    }
  }

  async sadd(key: string, member: string): Promise<void> {
    try {
      await this.client.sAdd(key, member);
    } catch (error) {
      logger.error(`Error adding to set ${key}:`, error);
      throw error;
    }
  }

  async srem(key: string, member: string): Promise<void> {
    try {
      await this.client.sRem(key, member);
    } catch (error) {
      logger.error(`Error removing from set ${key}:`, error);
      throw error;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.sMembers(key);
    } catch (error) {
      logger.error(`Error getting set members ${key}:`, error);
      throw error;
    }
  }

  async sismember(key: string, member: string): Promise<boolean> {
    try {
      return await this.client.sIsMember(key, member);
    } catch (error) {
      logger.error(`Error checking set membership ${key}:`, error);
      throw error;
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.client.publish(channel, message);
    } catch (error) {
      logger.error(`Error publishing to channel ${channel}:`, error);
      throw error;
    }
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();
      
      await subscriber.subscribe(channel, (message) => {
        callback(message);
      });
    } catch (error) {
      logger.error(`Error subscribing to channel ${channel}:`, error);
      throw error;
    }
  }
}

export default new RedisService();