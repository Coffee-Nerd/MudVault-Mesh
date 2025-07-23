import express from 'express';
import { authenticate, authService, AuthenticatedRequest } from '../middleware/auth';
import { apiRateLimit, mudRateLimit, authRateLimit } from '../middleware/rateLimiter';
import { createTellMessage } from '../utils/message';
import { validateMessage } from '../utils/validation';
import channelService from '../services/channel';
import userService from '../services/user';
import redisService from '../services/redis';
import logger from '../utils/logger';

const router = express.Router();

// Authentication endpoints
router.post('/auth/register', authRateLimit, async (req, res) => {
  try {
    const { mudName, adminSecret } = req.body;
    
    if (!mudName) {
      return res.status(400).json({ error: 'MUD name is required' });
    }

    const apiKey = await authService.generateApiKey(mudName, adminSecret);
    
    res.json({
      message: 'MUD registered successfully',
      mudName,
      apiKey,
      warning: 'Store this API key securely. It cannot be recovered.'
    });
  } catch (error) {
    logger.error('Error registering MUD:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/auth/login', authRateLimit, async (req, res) => {
  try {
    const { mudName, apiKey } = req.body;
    
    if (!mudName || !apiKey) {
      return res.status(400).json({ error: 'MUD name and API key are required' });
    }

    const token = await authService.authenticateWithApiKey(mudName, apiKey);
    
    if (!token) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      message: 'Authentication successful',
      token,
      mudName,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
  } catch (error) {
    logger.error('Error authenticating MUD:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.post('/auth/logout', authenticate, (req: AuthenticatedRequest, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    authService.revokeJWT(token);
  }
  
  res.json({ message: 'Logged out successfully' });
});

// Message endpoints
router.post('/messages/send', authenticate, mudRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const validation = validateMessage(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const message = validation.value!;
    message.from.mud = req.mud!.name;

    // Store message for delivery
    await redisService.lpush('outbound_messages', JSON.stringify(message));
    
    res.json({
      message: 'Message queued for delivery',
      id: message.id,
      timestamp: message.timestamp
    });
  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.get('/messages/history/:type', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { type } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const messages = await redisService.lrange(`message_history:${type}`, offset, offset + limit - 1);
    const parsedMessages = messages.map(msg => JSON.parse(msg));

    res.json({
      type,
      messages: parsedMessages,
      count: parsedMessages.length,
      limit,
      offset
    });
  } catch (error) {
    logger.error('Error fetching message history:', error);
    res.status(500).json({ error: 'Failed to fetch message history' });
  }
});

// Tell endpoints
router.post('/tell', authenticate, mudRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to || !to.mud || !to.user || !message) {
      return res.status(400).json({ error: 'Target mud, user, and message are required' });
    }

    const tellMessage = createTellMessage(
      { mud: req.mud!.name, user: req.body.from?.user || 'System' },
      to,
      message
    );

    await redisService.lpush('outbound_messages', JSON.stringify(tellMessage));
    
    res.json({
      message: 'Tell sent successfully',
      id: tellMessage.id,
      to: `${to.user}@${to.mud}`
    });
  } catch (error) {
    logger.error('Error sending tell:', error);
    res.status(500).json({ error: 'Failed to send tell' });
  }
});

// Channel endpoints
router.get('/channels', authenticate, apiRateLimit, (req: AuthenticatedRequest, res) => {
  try {
    const channels = channelService.getChannels().map(channel => ({
      name: channel.name,
      description: channel.description,
      moderators: channel.moderators,
      mudRestricted: channel.mudRestricted,
      allowedMuds: channel.allowedMuds
    }));

    res.json({ channels });
  } catch (error) {
    logger.error('Error fetching channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

router.post('/channels/:name/join', authenticate, mudRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.params;
    const { user } = req.body;
    
    if (!user) {
      return res.status(400).json({ error: 'User information is required' });
    }

    const userEndpoint = {
      mud: req.mud!.name,
      user: user.username || user,
      displayName: user.displayName
    };

    await channelService.joinChannel(name, userEndpoint);
    
    res.json({
      message: `Successfully joined channel ${name}`,
      channel: name,
      user: `${userEndpoint.user}@${userEndpoint.mud}`
    });
  } catch (error) {
    logger.error(`Error joining channel ${req.params.name}:`, error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/channels/:name/leave', authenticate, mudRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.params;
    const { user } = req.body;
    
    if (!user) {
      return res.status(400).json({ error: 'User information is required' });
    }

    const userEndpoint = {
      mud: req.mud!.name,
      user: user.username || user,
      displayName: user.displayName
    };

    await channelService.leaveChannel(name, userEndpoint);
    
    res.json({
      message: `Successfully left channel ${name}`,
      channel: name,
      user: `${userEndpoint.user}@${userEndpoint.mud}`
    });
  } catch (error) {
    logger.error(`Error leaving channel ${req.params.name}:`, error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/channels/:name/message', authenticate, mudRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.params;
    const { user, message } = req.body;
    
    if (!user || !message) {
      return res.status(400).json({ error: 'User and message are required' });
    }

    const userEndpoint = {
      mud: req.mud!.name,
      user: user.username || user,
      displayName: user.displayName
    };

    await channelService.sendMessage(name, userEndpoint, message);
    
    res.json({
      message: `Message sent to channel ${name}`,
      channel: name,
      user: `${userEndpoint.user}@${userEndpoint.mud}`
    });
  } catch (error) {
    logger.error(`Error sending message to channel ${req.params.name}:`, error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/channels/:name/history', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    const history = await channelService.getChannelHistory(name, limit);
    
    res.json({
      channel: name,
      history,
      count: history.length
    });
  } catch (error) {
    logger.error(`Error fetching history for channel ${req.params.name}:`, error);
    res.status(500).json({ error: 'Failed to fetch channel history' });
  }
});

router.get('/channels/:name/members', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.params;
    const members = await channelService.getChannelMembers(name);
    
    res.json({
      channel: name,
      members,
      count: members.length
    });
  } catch (error) {
    logger.error(`Error fetching members for channel ${req.params.name}:`, error);
    res.status(500).json({ error: 'Failed to fetch channel members' });
  }
});

// User endpoints
router.get('/users/online', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { mud } = req.query;
    const users = userService.getOnlineUsers(mud as string);
    
    res.json({
      users,
      count: users.length,
      mud: mud || 'all'
    });
  } catch (error) {
    logger.error('Error fetching online users:', error);
    res.status(500).json({ error: 'Failed to fetch online users' });
  }
});

router.get('/users/locate/:username', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { username } = req.params;
    const locations = await userService.locateUser(username);
    
    res.json({
      username,
      locations,
      found: locations.length > 0
    });
  } catch (error) {
    logger.error(`Error locating user ${req.params.username}:`, error);
    res.status(500).json({ error: 'Failed to locate user' });
  }
});

router.get('/users/search', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { q, limit } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const users = await userService.searchUsers(q as string, parseInt(limit as string) || 10);
    
    res.json({
      query: q,
      users,
      count: users.length
    });
  } catch (error) {
    logger.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// MUD management endpoints
router.get('/muds', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const connectedMuds = await redisService.smembers('connected_muds');
    const mudInfo = [];

    for (const mudName of connectedMuds) {
      const info = await redisService.get(`mud_info:${mudName}`);
      if (info) {
        mudInfo.push(JSON.parse(info));
      }
    }

    res.json({
      muds: mudInfo,
      count: mudInfo.length
    });
  } catch (error) {
    logger.error('Error fetching MUD list:', error);
    res.status(500).json({ error: 'Failed to fetch MUD list' });
  }
});

router.post('/muds/:name/who', authenticate, mudRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.params;
    const users = await userService.getOnlineUsersFromRedis(name);
    
    res.json({
      mud: name,
      users,
      count: users.length
    });
  } catch (error) {
    logger.error(`Error fetching who list for ${req.params.name}:`, error);
    res.status(500).json({ error: 'Failed to fetch who list' });
  }
});

// Statistics endpoints
router.get('/stats', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const stats = userService.getStats();
    const totalMuds = (await redisService.smembers('connected_muds')).length;
    const activeChannels = channelService.getChannels().length;
    const activeSessions = authService.getActiveSessionCount();

    res.json({
      users: stats,
      muds: {
        total: totalMuds,
        connected: totalMuds
      },
      channels: {
        active: activeChannels
      },
      sessions: {
        active: activeSessions
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    redis: redisService.isConnected()
  });
});

export default router;