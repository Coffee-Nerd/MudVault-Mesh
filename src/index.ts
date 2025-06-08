import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Gateway } from './services/gateway';
import apiRoutes from './routes/api';
import redisService from './services/redis';
import userService from './services/user';
import channelService from './services/channel';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '8080');
const WS_PORT = parseInt(process.env.WS_PORT || '8081');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-MUD-Name']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy if configured
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}

// API routes
app.use('/api/v1', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'OpenIMC Gateway',
    version: '1.0.0',
    description: 'Modern Inter-MUD Communication Protocol Gateway',
    documentation: 'https://github.com/Coffee-Nerd/OpenIMC',
    endpoints: {
      api: '/api/v1',
      websocket: `ws://localhost:${WS_PORT}`,
      health: '/api/v1/health'
    },
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    availableEndpoints: [
      'GET /',
      'GET /api/v1/health',
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/login',
      'GET /api/v1/muds',
      'GET /api/v1/channels',
      'GET /api/v1/users/online'
    ]
  });
});

// Global error handler
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// Initialize services and start server
async function startServer() {
  try {
    logger.info('Starting OpenIMC Gateway...');

    // Connect to Redis
    logger.info('Connecting to Redis...');
    await redisService.connect();
    
    // Initialize services
    logger.info('Initializing services...');
    await userService.initialize();
    
    // Start WebSocket gateway
    logger.info(`Starting WebSocket gateway on port ${WS_PORT}...`);
    const gateway = new Gateway(WS_PORT);
    
    // Set up gateway event handlers
    gateway.on('mudConnected', ({ mudName, connectionId }) => {
      logger.info(`MUD connected: ${mudName} (${connectionId})`);
    });

    gateway.on('mudDisconnected', ({ mudName, connectionId }) => {
      logger.info(`MUD disconnected: ${mudName} (${connectionId})`);
    });

    gateway.on('messageRouted', ({ message, fromConnection }) => {
      logger.debug(`Message routed: ${message.type} from ${message.from.mud} to ${message.to.mud}`);
    });

    // Set up channel service event handlers
    channelService.on('messagePosted', ({ channel, message, userKey }) => {
      logger.debug(`Channel message: [${channel}] ${userKey}: ${(message.payload as any).message}`);
    });

    channelService.on('userJoined', ({ channel, user }) => {
      logger.info(`User joined channel: ${user} -> ${channel}`);
    });

    channelService.on('userLeft', ({ channel, user }) => {
      logger.info(`User left channel: ${user} <- ${channel}`);
    });

    // Start HTTP server
    logger.info(`Starting HTTP server on port ${PORT}...`);
    const server = app.listen(PORT, () => {
      logger.info(`✅ OpenIMC Gateway started successfully!`);
      logger.info(`🌐 HTTP API: http://localhost:${PORT}`);
      logger.info(`🔌 WebSocket: ws://localhost:${WS_PORT}`);
      logger.info(`📖 Documentation: https://github.com/Coffee-Nerd/OpenIMC`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      server.close(() => {
        logger.info('HTTP server closed');
      });

      try {
        await gateway.close();
        logger.info('WebSocket gateway closed');
        
        await redisService.disconnect();
        logger.info('Redis connection closed');
        
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
if (require.main === module) {
  startServer();
}

export default app;