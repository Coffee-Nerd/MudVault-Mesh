import { createClient } from 'redis';
import winston from 'winston';
import dotenv from 'dotenv';
import { BridgeConfig } from './types';
import { MudVaultDiscordBridge } from './Bridge';

// Load environment variables
dotenv.config();

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'bridge-error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'bridge.log' 
    })
  ]
});

// Build configuration from environment
const config: BridgeConfig = {
  discord: {
    token: process.env.DISCORD_TOKEN!,
    guildId: process.env.DISCORD_GUILD_ID!,
    bridgeChannelId: process.env.DISCORD_BRIDGE_CHANNEL_ID!,
    adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID,
    verificationChannelId: process.env.DISCORD_VERIFICATION_CHANNEL_ID
  },
  mudvault: {
    url: process.env.MUDVAULT_URL || 'ws://localhost:8081',
    apiKey: process.env.MUDVAULT_API_KEY!,
    mudName: process.env.MUDVAULT_MUD_NAME || 'Discord-Bridge',
    channels: (process.env.MUDVAULT_CHANNELS || 'ooc,chat').split(',')
  },
  security: {
    requireVerification: process.env.REQUIRE_VERIFICATION === 'true',
    rateLimit: {
      messagesPerMinute: parseInt(process.env.RATE_LIMIT_MESSAGES || '10'),
      commandsPerMinute: parseInt(process.env.RATE_LIMIT_COMMANDS || '5')
    },
    allowedMuds: process.env.ALLOWED_MUDS?.split(','),
    blockedUsers: process.env.BLOCKED_USERS?.split(',')
  }
};

// Validate required configuration
function validateConfig(): void {
  const required = [
    'DISCORD_TOKEN',
    'DISCORD_GUILD_ID',
    'DISCORD_BRIDGE_CHANNEL_ID',
    'MUDVAULT_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Main application
async function main() {
  try {
    // Validate configuration
    validateConfig();

    logger.info('Starting MudVault-Discord Bridge...');

    // Connect to Redis
    const redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    redis.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    await redis.connect();
    logger.info('Connected to Redis');

    // Create and start bridge
    const bridge = new MudVaultDiscordBridge(config, redis, logger);

    // Setup event handlers
    bridge.on('started', () => {
      logger.info('Bridge started successfully');
    });

    bridge.on('discord:ready', () => {
      logger.info('Discord bot ready');
    });

    bridge.on('mudvault:connected', () => {
      logger.info('Connected to MudVault Mesh');
    });

    bridge.on('mudvault:disconnected', () => {
      logger.warn('Disconnected from MudVault Mesh');
    });

    bridge.on('error', (error) => {
      logger.error('Bridge error:', error);
    });

    // Start the bridge
    await bridge.start();

    // Setup graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await bridge.stop();
      await redis.quit();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await bridge.stop();
      await redis.quit();
      process.exit(0);
    });

    // Log statistics periodically
    setInterval(async () => {
      try {
        const stats = await bridge.getStats();
        logger.info('Bridge statistics', stats);
      } catch (error) {
        logger.error('Failed to get statistics', error);
      }
    }, 60000); // Every minute

  } catch (error) {
    logger.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});