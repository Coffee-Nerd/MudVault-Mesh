import { EventEmitter } from 'events';
import { UserInfo, UserLocation, MessageEndpoint } from '../types';
import logger from '../utils/logger';
import redisService from './redis';

export class UserService extends EventEmitter {
  private onlineUsers: Map<string, UserInfo> = new Map(); // user@mud -> UserInfo
  private userLocations: Map<string, UserLocation[]> = new Map(); // username -> locations

  constructor() {
    super();
  }

  public async setUserOnline(mud: string, userInfo: UserInfo): Promise<void> {
    const userKey = `${userInfo.username}@${mud}`;
    
    const fullUserInfo: UserInfo = {
      ...userInfo,
      lastLogin: new Date().toISOString()
    };

    this.onlineUsers.set(userKey, fullUserInfo);

    // Update location tracking
    if (!this.userLocations.has(userInfo.username)) {
      this.userLocations.set(userInfo.username, []);
    }

    const locations = this.userLocations.get(userInfo.username)!;
    const existingLocation = locations.find(loc => loc.mud === mud);
    
    if (existingLocation) {
      existingLocation.online = true;
      existingLocation.room = userInfo.location;
    } else {
      locations.push({
        mud,
        room: userInfo.location,
        online: true
      });
    }

    // Store in Redis
    await redisService.set(`user:${userKey}`, JSON.stringify(fullUserInfo), 3600);
    await redisService.sadd(`online_users:${mud}`, userInfo.username);
    await redisService.set(`user_locations:${userInfo.username}`, JSON.stringify(locations), 3600);

    logger.debug(`User ${userKey} is now online`);
    this.emit('userOnline', { mud, userInfo: fullUserInfo });
  }

  public async setUserOffline(mud: string, username: string): Promise<void> {
    const userKey = `${username}@${mud}`;
    
    this.onlineUsers.delete(userKey);

    // Update location tracking
    const locations = this.userLocations.get(username);
    if (locations) {
      const location = locations.find(loc => loc.mud === mud);
      if (location) {
        location.online = false;
      }
      
      // If no locations are online, remove the user entirely
      if (!locations.some(loc => loc.online)) {
        this.userLocations.delete(username);
        await redisService.del(`user_locations:${username}`);
      } else {
        await redisService.set(`user_locations:${username}`, JSON.stringify(locations), 3600);
      }
    }

    // Clean up Redis
    await redisService.del(`user:${userKey}`);
    await redisService.srem(`online_users:${mud}`, username);

    logger.debug(`User ${userKey} is now offline`);
    this.emit('userOffline', { mud, username });
  }

  public async updateUserInfo(mud: string, userInfo: Partial<UserInfo> & { username: string }): Promise<void> {
    const userKey = `${userInfo.username}@${mud}`;
    const existingInfo = this.onlineUsers.get(userKey);
    
    if (!existingInfo) {
      logger.warn(`Attempted to update info for offline user ${userKey}`);
      return;
    }

    const updatedInfo = { ...existingInfo, ...userInfo };
    this.onlineUsers.set(userKey, updatedInfo);

    // Update location if provided
    if (userInfo.location) {
      const locations = this.userLocations.get(userInfo.username);
      if (locations) {
        const location = locations.find(loc => loc.mud === mud);
        if (location) {
          location.room = userInfo.location;
          await redisService.set(`user_locations:${userInfo.username}`, JSON.stringify(locations), 3600);
        }
      }
    }

    await redisService.set(`user:${userKey}`, JSON.stringify(updatedInfo), 3600);

    logger.debug(`Updated info for user ${userKey}`);
    this.emit('userUpdated', { mud, userInfo: updatedInfo });
  }

  public getUserInfo(user: MessageEndpoint): UserInfo | undefined {
    const userKey = `${user.user}@${user.mud}`;
    return this.onlineUsers.get(userKey);
  }

  public async getUserInfoFromRedis(user: MessageEndpoint): Promise<UserInfo | null> {
    try {
      const userKey = `${user.user}@${user.mud}`;
      const userData = await redisService.get(`user:${userKey}`);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      logger.error(`Error getting user info from Redis for ${user.user}@${user.mud}:`, error);
      return null;
    }
  }

  public getOnlineUsers(mud?: string): UserInfo[] {
    if (mud) {
      return Array.from(this.onlineUsers.entries())
        .filter(([userKey]) => userKey.endsWith(`@${mud}`))
        .map(([, userInfo]) => userInfo);
    }
    
    return Array.from(this.onlineUsers.values());
  }

  public async getOnlineUsersFromRedis(mud: string): Promise<string[]> {
    try {
      return await redisService.smembers(`online_users:${mud}`);
    } catch (error) {
      logger.error(`Error getting online users from Redis for ${mud}:`, error);
      return [];
    }
  }

  public async locateUser(username: string): Promise<UserLocation[]> {
    // First check memory
    const memoryCachedLocations = this.userLocations.get(username);
    if (memoryCachedLocations) {
      return memoryCachedLocations.filter(loc => loc.online);
    }

    // Then check Redis
    try {
      const locationsData = await redisService.get(`user_locations:${username}`);
      if (locationsData) {
        const locations: UserLocation[] = JSON.parse(locationsData);
        this.userLocations.set(username, locations);
        return locations.filter(loc => loc.online);
      }
    } catch (error) {
      logger.error(`Error locating user ${username}:`, error);
    }

    return [];
  }

  public isUserOnline(user: MessageEndpoint): boolean {
    const userKey = `${user.user}@${user.mud}`;
    return this.onlineUsers.has(userKey);
  }

  public async getUserCount(mud?: string): Promise<number> {
    if (mud) {
      return (await this.getOnlineUsersFromRedis(mud)).length;
    }
    
    let total = 0;
    const muds = await redisService.smembers('connected_muds');
    
    for (const mudName of muds) {
      const count = await this.getUserCount(mudName);
      total += count;
    }
    
    return total;
  }

  public async cleanupOfflineUsers(): Promise<void> {
    logger.info('Cleaning up offline users...');
    
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    for (const [userKey, userInfo] of this.onlineUsers) {
      const lastLogin = new Date(userInfo.lastLogin || 0).getTime();
      
      if (now - lastLogin > timeout) {
        const [username, mud] = userKey.split('@');
        await this.setUserOffline(mud, username);
        logger.debug(`Cleaned up inactive user ${userKey}`);
      }
    }
  }

  public async searchUsers(query: string, limit: number = 10): Promise<UserInfo[]> {
    const results: UserInfo[] = [];
    const lowerQuery = query.toLowerCase();
    
    for (const userInfo of this.onlineUsers.values()) {
      if (results.length >= limit) break;
      
      if (
        userInfo.username.toLowerCase().includes(lowerQuery) ||
        userInfo.displayName?.toLowerCase().includes(lowerQuery) ||
        userInfo.realName?.toLowerCase().includes(lowerQuery)
      ) {
        results.push(userInfo);
      }
    }
    
    return results;
  }

  public getStats(): { totalUsers: number; mudCounts: Record<string, number> } {
    const mudCounts: Record<string, number> = {};
    let totalUsers = 0;
    
    for (const [userKey] of this.onlineUsers) {
      const mud = userKey.split('@')[1];
      mudCounts[mud] = (mudCounts[mud] || 0) + 1;
      totalUsers++;
    }
    
    return { totalUsers, mudCounts };
  }

  public async initialize(): Promise<void> {
    // Load online users from Redis on startup
    try {
      const muds = await redisService.smembers('connected_muds');
      
      for (const mud of muds) {
        const usernames = await this.getOnlineUsersFromRedis(mud);
        
        for (const username of usernames) {
          const userKey = `${username}@${mud}`;
          const userData = await redisService.get(`user:${userKey}`);
          
          if (userData) {
            const userInfo: UserInfo = JSON.parse(userData);
            this.onlineUsers.set(userKey, userInfo);
          }
        }
      }
      
      logger.info(`Loaded ${this.onlineUsers.size} online users from Redis`);
    } catch (error) {
      logger.error('Error initializing user service:', error);
    }

    // Start cleanup interval
    setInterval(() => {
      this.cleanupOfflineUsers();
    }, 60000); // Every minute
  }
}

export default new UserService();