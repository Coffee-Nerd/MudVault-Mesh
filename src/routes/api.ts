import express from 'express';
import { authenticate, authService, AuthenticatedRequest } from '../middleware/auth';
import { apiRateLimit, mudRateLimit, authRateLimit } from '../middleware/rateLimiter';
import { validateMudName } from '../utils/validation';
import channelService from '../services/channel';
import userService from '../services/user';
import redisService from '../services/redis';
import logger from '../utils/logger';
import banService, { BanType } from '../services/bans';
import channelAccess from '../services/channelAccess';
import { validateChannelName } from '../utils/validation';
import type { Gateway } from '../services/gateway';

const router = express.Router();

// Authentication endpoints
router.post('/auth/register', authRateLimit, async (req, res) => {
  try {
    const { mudName, adminSecret, rotate } = req.body;

    if (typeof mudName !== 'string' || !validateMudName(mudName)) {
      return res.status(400).json({ error: 'A valid MUD name is required' });
    }

    const apiKey = await authService.generateApiKey(mudName, adminSecret, rotate === true);

    res.json({
      message: 'MUD registered successfully',
      mudName,
      apiKey,
      warning: 'Store this API key securely. It cannot be recovered.'
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Registration is closed' });
    }
    if (reason === 'RESERVED') {
      return res.status(400).json({ error: 'That MUD name is reserved' });
    }
    if (reason === 'EXISTS') {
      return res.status(409).json({ error: 'That MUD name is already registered' });
    }
    logger.error('Error registering MUD:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/auth/login', authRateLimit, async (req, res) => {
  try {
    const { mudName, apiKey } = req.body;

    if (!mudName || !apiKey) {
      return res.status(400).json({ error: 'MUD name and API key are required' });
    }

    if (typeof mudName !== 'string' || typeof apiKey !== 'string') {
      return res.status(400).json({ error: 'MUD name and API key must be text' });
    }

    if (banService.isIpBanned(req.ip ?? '') || banService.isMudBanned(mudName)) {
      return res.status(403).json({ error: 'Access to the mesh has been suspended' });
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
router.post('/messages/send', authenticate, (_req, res) => {
  res.status(410).json({ error: 'Send messages over the WebSocket connection' });
});

router.get('/messages/history/:type', authenticate, apiRateLimit, async (req: AuthenticatedRequest, res) => {
  try {
    const { type } = req.params;
    // Only public channel traffic is readable. Tells and the rest are private.
    if (type !== 'channel') {
      return res.status(403).json({ error: 'Only channel history is available' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

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
router.post('/tell', authenticate, (_req, res) => {
  res.status(410).json({ error: 'Send tells over the WebSocket connection' });
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
    const gateway = req.app.locals.gateway as Gateway | undefined;
    const mudInfo = gateway?.getMudInfo() ?? [];

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
    const totalMuds = (req.app.locals.gateway as Gateway | undefined)?.getMudInfo().length ?? 0;
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

// Admin endpoints
const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (!authService.adminSecretValid(req.headers['x-admin-secret'])) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

const banType = (value: unknown): value is BanType => value === 'ip' || value === 'mud';

router.get('/admin/bans', authRateLimit, requireAdmin, (_req, res) => {
  res.json({ bans: banService.list() });
});

router.post('/admin/bans', authRateLimit, requireAdmin, async (req, res) => {
  try {
    const { type, value, reason, by, minutes } = req.body;
    if (!banType(type) || typeof value !== 'string') {
      return res.status(400).json({ error: 'type must be ip or mud, and value is required' });
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      return res.status(400).json({ error: 'A reason of up to 500 characters is required' });
    }
    if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600)) {
      return res.status(400).json({ error: 'minutes must be a whole number from 1 to 525600' });
    }
    const canonical = banService.canonicalValue(type, value);
    if (!canonical) {
      return res.status(400).json({ error: type === 'ip' ? 'Use one IP address, or a CIDR no wider than /8 (IPv4) or /32 (IPv6)' : 'Invalid MUD name' });
    }
    const actor = typeof by === 'string' && by.trim() ? by.trim().slice(0, 64) : 'admin';
    const { ban, saved } = await banService.add(type, canonical, reason.trim(), actor, req.ip ?? 'unknown', minutes);
    if (type === 'mud') {
      authService.dropSessions(canonical);
    }
    const disconnected = (req.app.locals.gateway as Gateway | undefined)?.enforceBans() ?? 0;
    res.status(201).json({ ban, disconnected, saved });
  } catch (error) {
    logger.error('Error adding ban:', error);
    res.status(500).json({ error: 'Failed to add ban' });
  }
});

router.delete('/admin/bans/:type/:value', authRateLimit, requireAdmin, async (req, res) => {
  try {
    const { type, value } = req.params;
    if (!banType(type)) {
      return res.status(400).json({ error: 'type must be ip or mud' });
    }
    const canonical = banService.canonicalValue(type, value);
    if (!canonical) {
      return res.status(400).json({ error: 'Invalid value' });
    }
    const by = req.get('x-admin-name')?.slice(0, 64) || 'admin';
    const { removed, saved } = await banService.remove(type, canonical, by, req.ip ?? 'unknown');
    if (!removed) {
      return res.status(404).json({ error: 'No such ban' });
    }
    res.json({ removed: true, saved });
  } catch (error) {
    logger.error('Error removing ban:', error);
    res.status(500).json({ error: 'Failed to remove ban' });
  }
});

router.get('/admin/audit', authRateLimit, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 1000);
    res.json({ entries: await banService.auditLog(limit) });
  } catch (error) {
    logger.error('Error reading audit log:', error);
    res.status(500).json({ error: 'Failed to read audit log' });
  }
});

router.delete('/admin/muds/:name', authRateLimit, requireAdmin, async (req, res) => {
  try {
    const registered = await authService.registeredName(req.params.name);
    if (!registered) {
      return res.status(404).json({ error: 'No MUD is registered with that name' });
    }
    await authService.revokeApiKey(registered);
    const disconnected = (req.app.locals.gateway as Gateway | undefined)?.disconnectMud(registered) ?? false;
    const by = req.get('x-admin-name')?.slice(0, 64) || 'admin';
    await banService.audit('mud.revoke', by, req.ip ?? 'unknown', { mud: registered, disconnected });
    res.json({ revoked: registered, disconnected });
  } catch (error) {
    logger.error('Error revoking MUD:', error);
    res.status(500).json({ error: 'Failed to revoke MUD' });
  }
});

router.get('/admin/channels', authRateLimit, requireAdmin, (_req, res) => {
  res.json({ restricted: channelAccess.list() });
});

router.put('/admin/channels/:name', authRateLimit, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params;
    const { muds, by } = req.body;
    if (!validateChannelName(name)) {
      return res.status(400).json({ error: 'Invalid channel name' });
    }
    if (!Array.isArray(muds) || muds.length > 500 || !muds.every(mud => typeof mud === 'string')) {
      return res.status(400).json({ error: 'muds must be a list of MUD names' });
    }
    const actor = typeof by === 'string' && by.trim() ? by.trim().slice(0, 64) : 'admin';
    const result = await channelAccess.restrict(name, muds, actor, req.ip ?? 'unknown');
    res.json({ channel: name.toLowerCase(), ...result });
  } catch (error) {
    logger.error('Error restricting channel:', error);
    res.status(500).json({ error: 'Failed to restrict channel' });
  }
});

router.delete('/admin/channels/:name', authRateLimit, requireAdmin, async (req, res) => {
  try {
    const by = req.get('x-admin-name')?.slice(0, 64) || 'admin';
    const { removed, saved } = await channelAccess.open(req.params.name, by, req.ip ?? 'unknown');
    if (!removed) {
      return res.status(404).json({ error: 'That channel is not restricted' });
    }
    res.json({ opened: true, saved });
  } catch (error) {
    logger.error('Error opening channel:', error);
    res.status(500).json({ error: 'Failed to open channel' });
  }
});

// Health check endpoint
router.get('/health', (_req, res) => {
  const redis = redisService.isConnected();
  res.status(redis ? 200 : 503).json({
    status: redis ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    redis
  });
});

export default router;