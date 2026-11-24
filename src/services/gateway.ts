import crypto from 'crypto';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { MudVaultMessage, ConnectionInfo, MudInfo, ErrorCodes, WhoUser, MessageType } from '../types';
import { validateMessage, validateMudName, normalizeMudName } from '../utils/validation';
import { createErrorMessage, createPongMessage, createMessage } from '../utils/message';
import logger from '../utils/logger';
import redisService from './redis';
import banService from './bans';
import channelAccess from './channelAccess';
import { authService } from '../middleware/auth';

const MAX_CONNECTIONS = 500;
const MAX_CONNECTIONS_PER_IP = 10;
const MAX_CONNECT_ATTEMPTS_PER_MINUTE = 30;
const MAX_MESSAGES_PER_MINUTE = 300;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PREAUTH_BYTES = 8 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const AUTH_TIMEOUT_MS = 10000;
const PING_INTERVAL_MS = 30000;
const IDLE_TIMEOUT_MS = 60000;
const SWEEP_INTERVAL_MS = 1000;
const HISTORY_FLUSH_MS = 250;
const HISTORY_CAP = 1000;
const HISTORY_KEY = 'message_history:channel';

const CLOSE_AUTH_FAILED = 4401;
const CLOSE_BANNED = 4403;
const CLOSE_AUTH_TIMEOUT = 4408;
const CLOSE_REPLACED = 4409;
const CLOSE_TOO_MANY = 4429;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const BROADCASTABLE: ReadonlySet<MessageType> = new Set<MessageType>(['channel', 'locate', 'presence']);
// These only ever come from the gateway, so a MUD must not be able to forge them.
const NEVER_FORWARDED: ReadonlySet<MessageType> = new Set<MessageType>(['auth', 'error', 'pong', 'mudlist', 'channels']);

const CHANNELS = [
  { name: 'ooc', description: 'Out of Character chat', memberCount: 0, flags: ['public'] },
  { name: 'chat', description: 'General chat channel', memberCount: 0, flags: ['public'] },
  { name: 'gossip', description: 'Gossip and rumors', memberCount: 0, flags: ['public'] },
  { name: 'newbie', description: 'Help for new players', memberCount: 0, flags: ['public'] },
  { name: 'admin', description: 'Administrative channel', memberCount: 0, flags: ['private', 'admin'] }
];

export interface InternalClient {
  mudName: string;
  token: string;
}

interface Connection {
  id: string;
  ws: WebSocket;
  host: string;
  mudName: string;
  authenticated: boolean;
  connectedAt: number;
  lastSeenAt: number;
  nextPingAt: number;
  authDeadline: number;
  messageCount: number;
  version: string;
  tokens: number;
  tokensAt: number;
  limited: boolean;
}

const payloadOf = (message: MudVaultMessage) => message.payload as any;

export class Gateway extends EventEmitter {
  private connections: Map<string, Connection> = new Map();
  private byMud: Map<string, Connection> = new Map();
  private perIp: Map<string, number> = new Map();
  private connectAttempts: Map<string, { start: number; count: number }> = new Map();
  private server: WebSocket.Server;
  private sweepTimer: NodeJS.Timeout;
  private nextConnectionId = 0;
  private lastAttemptSweep = Date.now();
  private historyBatch: string[] = [];
  private historyTimer: NodeJS.Timeout | null = null;

  constructor(
    port: number,
    private internalClient?: InternalClient,
    private maxConnectAttemptsPerMinute: number = MAX_CONNECT_ATTEMPTS_PER_MINUTE
  ) {
    super();

    this.server = new WebSocket.Server({
      port,
      perMessageDeflate: false,
      maxPayload: MAX_PAYLOAD_BYTES
    });

    this.server.on('connection', this.handleConnection.bind(this));
    this.server.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });

    // One timer for every socket, instead of two per socket.
    this.sweepTimer = setInterval(() => this.sweep(Date.now()), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();

    redisService.onReady(() => this.syncRegistry());

    logger.info(`WebSocket gateway listening on port ${port}`);
  }

  private syncRegistry(): void {
    const names = Array.from(this.byMud.keys());
    redisService.del('connected_muds')
      .then(() => Promise.all(names.map(name => redisService.sadd('connected_muds', name))))
      .catch(() => undefined);
  }

  private clientAddress(req: any): string {
    // Behind nginx the socket is loopback, and nginx sets X-Real-IP itself.
    const socketAddress: string = req.socket.remoteAddress ?? 'unknown';
    const forwarded = req.headers['x-real-ip'];
    const behindProxy = process.env.TRUST_PROXY === 'true' && LOOPBACK.has(socketAddress);
    return behindProxy && typeof forwarded === 'string' && forwarded ? forwarded : socketAddress;
  }

  private handleConnection(ws: WebSocket, req: any): void {
    // Must be attached first. A bad frame on a socket with no listener kills the process.
    ws.on('error', (error) => {
      logger.debug(`WebSocket error: ${error.message}`);
      ws.terminate();
    });

    const host = this.clientAddress(req);
    if (banService.isIpBanned(host)) {
      this.closeSoon(ws, CLOSE_BANNED, 'Banned');
      return;
    }
    if (!this.admitConnection(host)) {
      this.closeSoon(ws, CLOSE_TOO_MANY, 'Too many connections');
      return;
    }

    const now = Date.now();
    const connection: Connection = {
      id: `c${++this.nextConnectionId}`,
      ws,
      host,
      mudName: '',
      authenticated: false,
      connectedAt: now,
      lastSeenAt: now,
      nextPingAt: now + PING_INTERVAL_MS,
      authDeadline: now + AUTH_TIMEOUT_MS,
      messageCount: 0,
      version: '1.0',
      tokens: MAX_MESSAGES_PER_MINUTE,
      tokensAt: now,
      limited: false
    };
    this.connections.set(connection.id, connection);
    this.perIp.set(host, (this.perIp.get(host) ?? 0) + 1);

    ws.on('message', (data) => this.handleMessage(connection, data));
    ws.on('close', (code) => this.handleDisconnection(connection, code));
    ws.on('pong', () => {
      connection.lastSeenAt = Date.now();
    });
  }

  private admitConnection(ip: string): boolean {
    const now = Date.now();
    let attempts = this.connectAttempts.get(ip);
    if (!attempts || now - attempts.start >= 60000) {
      attempts = { start: now, count: 0 };
      this.connectAttempts.set(ip, attempts);
    }
    attempts.count++;
    return attempts.count <= this.maxConnectAttemptsPerMinute &&
      this.connections.size < MAX_CONNECTIONS &&
      (this.perIp.get(ip) ?? 0) < MAX_CONNECTIONS_PER_IP;
  }

  private sweep(now: number): void {
    for (const connection of this.connections.values()) {
      const { ws } = connection;
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (!connection.authenticated && now >= connection.authDeadline) {
        this.closeSoon(ws, CLOSE_AUTH_TIMEOUT, 'Authentication timeout');
      } else if (now - connection.lastSeenAt > IDLE_TIMEOUT_MS) {
        logger.warn(`Connection ${connection.id} timed out`);
        ws.terminate();
      } else if (now >= connection.nextPingAt) {
        connection.nextPingAt = now + PING_INTERVAL_MS;
        ws.ping();
      }
    }
    if (now - this.lastAttemptSweep >= 60000) {
      this.lastAttemptSweep = now;
      for (const [ip, entry] of this.connectAttempts) {
        if (now - entry.start >= 60000) {
          this.connectAttempts.delete(ip);
        }
      }
    }
  }

  private closeSoon(ws: WebSocket, code: number, reason: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(code, reason);
    }
    setTimeout(() => ws.terminate(), 2000).unref();
  }

  private rejectUnauthenticated(connection: Connection): void {
    if (!connection.authenticated) {
      this.closeSoon(connection.ws, CLOSE_AUTH_FAILED, 'Authentication failed');
    }
  }

  /** Token bucket: the same sustained rate as before, without a double burst at window edges. */
  private overMessageLimit(connection: Connection, now: number): boolean {
    const refill = (now - connection.tokensAt) * (MAX_MESSAGES_PER_MINUTE / 60000);
    connection.tokens = Math.min(MAX_MESSAGES_PER_MINUTE, connection.tokens + refill);
    connection.tokensAt = now;
    if (connection.tokens >= 1) {
      connection.tokens -= 1;
      connection.limited = false;
      return false;
    }
    if (!connection.limited) {
      connection.limited = true;
      this.sendError(connection, ErrorCodes.RATE_LIMITED, 'Too many messages. Slow down.');
    }
    return true;
  }

  private tokenAllowed(token: unknown, finalMudName: string, host: string): boolean {
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      return false;
    }
    const internal = this.internalClient;
    if (internal && normalizeMudName(internal.mudName) === finalMudName) {
      const a = crypto.createHash('sha256').update(token).digest();
      const b = crypto.createHash('sha256').update(internal.token).digest();
      return LOOPBACK.has(host) && crypto.timingSafeEqual(a, b);
    }
    const payload = authService.verifyJWT(token);
    return !!payload && normalizeMudName(payload.mudName) === finalMudName;
  }

  private handleMessage(connection: Connection, data: WebSocket.RawData): void {
    try {
      const now = Date.now();
      connection.lastSeenAt = now;
      connection.messageCount++;
      if (this.overMessageLimit(connection, now)) {
        return;
      }

      const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      if (!connection.authenticated && buffer.length > MAX_PREAUTH_BYTES) {
        this.sendError(connection, ErrorCodes.MESSAGE_TOO_LARGE, 'Login message is too large');
        this.rejectUnauthenticated(connection);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.toString('utf8'));
      } catch {
        this.sendError(connection, ErrorCodes.INVALID_MESSAGE, 'Invalid JSON format');
        this.rejectUnauthenticated(connection);
        return;
      }

      const validation = validateMessage(parsed);
      if (validation.error || !validation.value) {
        this.sendError(connection, ErrorCodes.INVALID_MESSAGE, validation.error ?? 'Invalid message');
        this.rejectUnauthenticated(connection);
        return;
      }
      const message = validation.value;

      if (now - Date.parse(message.timestamp) > message.metadata.ttl * 1000) {
        this.sendError(connection, ErrorCodes.INVALID_MESSAGE, 'Message expired. Check that the server clock is correct.');
        this.rejectUnauthenticated(connection);
        return;
      }

      if (message.type === 'auth') {
        this.handleAuthentication(connection, message);
      } else if (!connection.authenticated) {
        this.sendError(connection, ErrorCodes.UNAUTHORIZED, 'Authentication required');
        this.rejectUnauthenticated(connection);
      } else if (message.type === 'ping') {
        this.send(connection, createPongMessage({ mud: 'Gateway' }, { mud: connection.mudName }, payloadOf(message).timestamp));
      } else {
        this.routeMessage(connection, message);
      }
    } catch (error) {
      logger.error(`Error handling message from ${connection.id}:`, error);
      this.sendError(connection, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
    }
  }

  private handleAuthentication(connection: Connection, message: MudVaultMessage): void {
    if (connection.authenticated) {
      this.sendError(connection, ErrorCodes.PROTOCOL_ERROR, 'Already authenticated');
      return;
    }

    const { mudName, token } = payloadOf(message);
    if (!mudName || typeof mudName !== 'string') {
      this.sendError(connection, ErrorCodes.AUTHENTICATION_FAILED, 'Missing mud name');
      this.rejectUnauthenticated(connection);
      return;
    }

    if (!validateMudName(mudName)) {
      const suggestedName = normalizeMudName(mudName);
      this.sendError(connection, ErrorCodes.AUTHENTICATION_FAILED,
        `Invalid MUD name. MUD names can only contain letters, numbers, dashes, and underscores (no spaces). Suggested name: "${suggestedName}".`);
      this.rejectUnauthenticated(connection);
      return;
    }

    const finalMudName = normalizeMudName(mudName);
    if (!this.tokenAllowed(token, finalMudName, connection.host)) {
      logger.warn(`Login refused: ${finalMudName}`, { connection: connection.id });
      this.sendError(connection, ErrorCodes.AUTHENTICATION_FAILED, 'Invalid or expired token. Log in again.');
      this.rejectUnauthenticated(connection);
      return;
    }

    if (banService.isMudBanned(finalMudName)) {
      this.sendError(connection, ErrorCodes.AUTHENTICATION_FAILED, 'This MUD is banned from the mesh.');
      this.closeSoon(connection.ws, CLOSE_BANNED, 'Banned');
      return;
    }

    // The token proved ownership, so the newest connection wins.
    const previous = this.byMud.get(finalMudName);
    if (previous && previous !== connection) {
      previous.authenticated = false;
      this.closeSoon(previous.ws, CLOSE_REPLACED, 'Replaced by a newer connection');
    }

    connection.mudName = finalMudName;
    connection.authenticated = true;
    connection.version = message.version;
    this.byMud.set(finalMudName, connection);

    if (redisService.isConnected()) {
      redisService.sadd('connected_muds', finalMudName).catch(() => undefined);
    }

    logger.info(`MUD authenticated: ${finalMudName}`, { connection: connection.id, muds: this.byMud.size });

    this.send(connection, createMessage(
      'auth',
      { mud: 'Gateway' },
      { mud: finalMudName },
      { mudName: finalMudName, response: 'Authentication successful' },
      { priority: 10 }
    ));

    this.emit('mudConnected', { mudName: finalMudName, connectionId: connection.id });
  }

  private routeMessage(connection: Connection, message: MudVaultMessage): void {
    message.from.mud = connection.mudName;
    if (message.type === 'channel') {
      // Clients read either field, so they must never disagree.
      message.to.channel = payloadOf(message).channel;
    }

    const target = message.to.mud;
    if (target === '*') {
      if (!BROADCASTABLE.has(message.type)) {
        this.sendError(connection, ErrorCodes.PROTOCOL_ERROR, `${message.type} cannot be broadcast`);
        return;
      }
      if (message.type === 'channel') {
        const allowed = channelAccess.allowed(payloadOf(message).channel);
        if (allowed && !allowed.has(connection.mudName)) {
          this.sendError(connection, ErrorCodes.UNAUTHORIZED, `This MUD does not have access to #${payloadOf(message).channel}`);
          return;
        }
        this.broadcast(connection, message, allowed);
        return;
      }
      this.broadcast(connection, message);
    } else if (target === 'Gateway' || target.toLowerCase() === 'gateway') {
      this.handleGatewayMessage(connection, message);
    } else {
      if (NEVER_FORWARDED.has(message.type)) {
        this.sendError(connection, ErrorCodes.PROTOCOL_ERROR, `${message.type} cannot be sent to a MUD`);
        return;
      }
      const destination = this.byMud.get(target) ?? this.byMud.get(normalizeMudName(target));
      if (!destination) {
        this.sendError(connection, ErrorCodes.MUD_NOT_FOUND, `MUD ${target} not found`);
        return;
      }
      this.send(destination, message);
    }
  }

  private broadcast(sender: Connection, message: MudVaultMessage, allowed?: ReadonlySet<string>): void {
    // Serialize once and share one buffer between every recipient.
    const text = JSON.stringify(message);
    const frame = Buffer.from(text);
    if (allowed) {
      for (const name of allowed) {
        const connection = this.byMud.get(name);
        if (connection && connection !== sender) {
          this.sendFrame(connection, frame);
        }
      }
      // Restricted traffic never enters the history that every MUD can read.
      return;
    }
    for (const connection of this.byMud.values()) {
      if (connection !== sender) {
        this.sendFrame(connection, frame);
      }
    }
    if (message.type === 'channel' && payloadOf(message).action === 'message') {
      this.queueHistory(text);
    }
  }

  private queueHistory(text: string): void {
    this.historyBatch.push(text);
    if (this.historyBatch.length > HISTORY_CAP) {
      this.historyBatch.shift();
    }
    if (!this.historyTimer) {
      this.historyTimer = setTimeout(() => this.flushHistory(), HISTORY_FLUSH_MS);
      this.historyTimer.unref();
    }
  }

  private flushHistory(): Promise<void> {
    if (this.historyTimer) {
      clearTimeout(this.historyTimer);
      this.historyTimer = null;
    }
    const batch = this.historyBatch;
    if (batch.length === 0 || !redisService.isConnected()) {
      this.historyBatch = [];
      return Promise.resolve();
    }
    this.historyBatch = [];
    return redisService.pushCapped(HISTORY_KEY, batch, HISTORY_CAP).catch(() => undefined);
  }

  private handleGatewayMessage(connection: Connection, message: MudVaultMessage): void {
    if (!payloadOf(message).request) {
      return;
    }
    switch (message.type) {
      case 'who':
        this.handleWhoRequest(connection, message);
        break;
      case 'locate':
        this.reply(connection, message, { user: payloadOf(message).user, request: false, locations: [] });
        break;
      case 'mudlist':
        this.reply(connection, message, { muds: this.listMuds(), request: false });
        break;
      case 'channels':
        this.reply(connection, message, { channels: CHANNELS, request: false });
        break;
      case 'finger': {
        const { user } = payloadOf(message);
        this.reply(connection, message, {
          user,
          request: false,
          info: {
            username: user,
            realName: 'MudVault Mesh Gateway User',
            email: 'noreply@mudvault.org',
            lastLogin: new Date().toISOString(),
            plan: 'Connected to MudVault Mesh inter-MUD communication network',
            level: 'System',
            location: 'Gateway Server',
            idle: 0
          }
        });
        break;
      }
      default:
        this.sendError(connection, ErrorCodes.PROTOCOL_ERROR, `Unsupported gateway message type: ${message.type}`);
    }
  }

  private reply(connection: Connection, message: MudVaultMessage, payload: unknown): void {
    this.send(connection, createMessage(
      message.type,
      { mud: 'Gateway' },
      { mud: connection.mudName },
      payload as any,
      { priority: message.metadata.priority }
    ));
  }

  private handleWhoRequest(connection: Connection, message: MudVaultMessage): void {
    const now = Date.now();
    const users: WhoUser[] = [];
    for (const [name, mud] of this.byMud) {
      users.push({
        username: name,
        displayName: name,
        title: 'MUD Server',
        level: 'System',
        idle: Math.floor((now - mud.lastSeenAt) / 1000),
        location: 'MudVault Mesh',
        flags: ['mud', 'system'],
        realName: `${name} (Connected ${Math.floor((now - mud.connectedAt) / 1000)}s ago)`
      });
    }

    switch (payloadOf(message).sort) {
      case 'alpha':
      case 'level':
        users.sort((a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
        break;
      case 'idle':
        users.sort((a, b) => a.idle - b.idle);
        break;
      case 'random':
        for (let i = users.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [users[i], users[j]] = [users[j], users[i]];
        }
        break;
    }

    this.reply(connection, message, { users, request: false });
  }

  private send(connection: Connection, message: MudVaultMessage): void {
    this.sendFrame(connection, Buffer.from(JSON.stringify(message)));
  }

  private sendFrame(connection: Connection, frame: Buffer): void {
    const { ws } = connection;
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    // A client that stops reading must not be able to grow our memory without limit.
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      logger.warn(`Dropping slow connection ${connection.id}`, { mudName: connection.mudName });
      ws.terminate();
      return;
    }
    ws.send(frame, { binary: false });
  }

  private sendError(connection: Connection, code: ErrorCodes, message: string): void {
    this.send(connection, createErrorMessage(
      { mud: 'Gateway' },
      { mud: connection.mudName || 'Unknown' },
      code,
      message
    ));
  }

  private handleDisconnection(connection: Connection, code: number): void {
    this.connections.delete(connection.id);
    const fromIp = (this.perIp.get(connection.host) ?? 1) - 1;
    if (fromIp > 0) {
      this.perIp.set(connection.host, fromIp);
    } else {
      this.perIp.delete(connection.host);
    }

    if (connection.mudName && this.byMud.get(connection.mudName) === connection) {
      this.byMud.delete(connection.mudName);
      if (redisService.isConnected()) {
        redisService.srem('connected_muds', connection.mudName).catch(() => undefined);
      }
      logger.info(`MUD disconnected: ${connection.mudName}`, { code, muds: this.byMud.size });
      this.emit('mudDisconnected', { mudName: connection.mudName, connectionId: connection.id });
    }
  }

  /** Closes every live connection that a new ban now covers. */
  public enforceBans(): number {
    let closed = 0;
    for (const connection of this.connections.values()) {
      if (banService.isIpBanned(connection.host) || (connection.mudName && banService.isMudBanned(connection.mudName))) {
        connection.authenticated = false;
        this.closeSoon(connection.ws, CLOSE_BANNED, 'Banned');
        closed++;
      }
    }
    return closed;
  }

  private listMuds() {
    const now = Date.now();
    const muds = [];
    for (const [name, mud] of this.byMud) {
      muds.push({
        name,
        version: mud.version,
        admin: '',
        email: '',
        uptime: Math.floor((now - mud.connectedAt) / 1000),
        users: 0,
        description: `${name} MUD Server`
      });
    }
    return muds;
  }

  public getConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values(), c => ({
      id: c.id,
      mudName: c.mudName,
      host: c.host,
      authenticated: c.authenticated,
      connected: new Date(c.connectedAt),
      lastSeen: new Date(c.lastSeenAt),
      messageCount: c.messageCount,
      version: c.version
    }));
  }

  /** Public view of connected MUDs. Never includes addresses. */
  public getMudInfo(): MudInfo[] {
    return this.listMuds();
  }

  public async close(): Promise<void> {
    logger.info('Shutting down gateway...');
    clearInterval(this.sweepTimer);
    await this.flushHistory();
    for (const connection of this.connections.values()) {
      connection.ws.close(1001, 'Gateway shutting down');
    }
    this.server.close();
  }
}

export default Gateway;
