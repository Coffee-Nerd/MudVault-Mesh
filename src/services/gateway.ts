import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { MudVaultMessage, ConnectionInfo, MudInfo, ErrorCodes } from '../types';
import { validateMessage } from '../utils/validation';
import { createErrorMessage, createPongMessage, isExpired } from '../utils/message';
import logger from '../utils/logger';
import redisService from './redis';

export class Gateway extends EventEmitter {
  private connections: Map<string, WebSocket> = new Map();
  private connectionInfo: Map<string, ConnectionInfo> = new Map();
  private mudInfo: Map<string, MudInfo> = new Map();
  private server: WebSocket.Server;

  constructor(port: number) {
    super();
    
    this.server = new WebSocket.Server({ 
      port,
      perMessageDeflate: false,
      maxPayload: 64 * 1024
    });

    this.server.on('connection', this.handleConnection.bind(this));
    this.server.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });

    logger.info(`WebSocket gateway listening on port ${port}`);
  }

  private handleConnection(ws: WebSocket, req: any): void {
    const connectionId = this.generateConnectionId();
    const remoteAddress = req.socket.remoteAddress;
    
    logger.info(`New connection ${connectionId} from ${remoteAddress}`);
    
    this.connections.set(connectionId, ws);
    this.connectionInfo.set(connectionId, {
      id: connectionId,
      mudName: '',
      host: remoteAddress,
      authenticated: false,
      connected: new Date(),
      lastSeen: new Date(),
      messageCount: 0,
      version: '1.0'
    });

    ws.on('message', (data) => {
      this.handleMessage(connectionId, data);
    });

    ws.on('close', (code, reason) => {
      this.handleDisconnection(connectionId, code, reason);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error for connection ${connectionId}:`, error);
    });

    ws.on('pong', () => {
      this.updateLastSeen(connectionId);
    });

    this.startHeartbeat(connectionId);
  }

  private async handleMessage(connectionId: string, data: WebSocket.Data): Promise<void> {
    try {
      const connection = this.connectionInfo.get(connectionId);
      if (!connection) {
        return;
      }

      connection.lastSeen = new Date();
      connection.messageCount++;

      const messageText = data.toString();
      let messageData: any;
      
      try {
        messageData = JSON.parse(messageText);
      } catch (error) {
        this.sendError(connectionId, ErrorCodes.INVALID_MESSAGE, 'Invalid JSON format');
        return;
      }

      const validation = validateMessage(messageData);
      if (validation.error) {
        this.sendError(connectionId, ErrorCodes.INVALID_MESSAGE, validation.error);
        return;
      }

      const message = validation.value!;

      if (isExpired(message)) {
        logger.warn(`Received expired message ${message.id} from ${connectionId}`);
        return;
      }

      if (message.type === 'auth') {
        await this.handleAuthentication(connectionId, message);
        return;
      }

      if (!connection.authenticated) {
        this.sendError(connectionId, ErrorCodes.UNAUTHORIZED, 'Authentication required');
        return;
      }

      if (message.type === 'ping') {
        this.handlePing(connectionId, message);
        return;
      }

      await this.routeMessage(connectionId, message);

    } catch (error) {
      logger.error(`Error handling message from ${connectionId}:`, error);
      this.sendError(connectionId, ErrorCodes.INTERNAL_ERROR, 'Internal server error');
    }
  }

  private async handleAuthentication(connectionId: string, message: MudVaultMessage): Promise<void> {
    const connection = this.connectionInfo.get(connectionId);
    if (!connection) {
      return;
    }

    const { mudName } = message.payload as any;
    if (!mudName || typeof mudName !== 'string') {
      this.sendError(connectionId, ErrorCodes.AUTHENTICATION_FAILED, 'Missing mud name');
      return;
    }

    connection.mudName = mudName;
    connection.authenticated = true;

    this.mudInfo.set(mudName, {
      name: mudName,
      host: connection.host,
      version: message.version,
      admin: '',
      email: '',
      time: new Date().toISOString(),
      uptime: 0,
      users: 0
    });

    await redisService.sadd('connected_muds', mudName);
    await redisService.set(`mud_info:${mudName}`, JSON.stringify(this.mudInfo.get(mudName)), 3600);

    logger.info(`MUD ${mudName} authenticated on connection ${connectionId}`);
    
    this.emit('mudConnected', { mudName, connectionId });
  }

  private handlePing(connectionId: string, message: MudVaultMessage): void {
    const connection = this.connectionInfo.get(connectionId);
    if (!connection) {
      return;
    }

    const pongMessage = createPongMessage(
      { mud: 'Gateway' },
      { mud: connection.mudName },
      (message.payload as any).timestamp
    );

    this.sendMessage(connectionId, pongMessage);
  }

  private async routeMessage(connectionId: string, message: MudVaultMessage): Promise<void> {
    const connection = this.connectionInfo.get(connectionId);
    if (!connection) {
      return;
    }

    message.from.mud = connection.mudName;

    if (message.to.mud === '*') {
      await this.broadcastMessage(message, connectionId);
    } else if (message.to.mud === 'Gateway') {
      await this.handleGatewayMessage(connectionId, message);
    } else {
      await this.forwardMessage(message, connectionId);
    }

    await this.storeMessage(message);
    this.emit('messageRouted', { message, fromConnection: connectionId });
  }

  private async broadcastMessage(message: MudVaultMessage, excludeConnection?: string): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const [connId, ws] of this.connections) {
      if (connId !== excludeConnection && ws.readyState === WebSocket.OPEN) {
        const connection = this.connectionInfo.get(connId);
        if (connection?.authenticated) {
          promises.push(this.sendMessage(connId, message));
        }
      }
    }

    await Promise.all(promises);
  }

  private async forwardMessage(message: MudVaultMessage, fromConnection: string): Promise<void> {
    const targetMud = message.to.mud;
    const targetConnection = this.findConnectionByMud(targetMud);

    if (!targetConnection) {
      this.sendError(fromConnection, ErrorCodes.MUD_NOT_FOUND, `MUD ${targetMud} not found`);
      return;
    }

    await this.sendMessage(targetConnection, message);
  }

  private async handleGatewayMessage(connectionId: string, message: MudVaultMessage): Promise<void> {
    switch (message.type) {
      case 'who':
        if ((message.payload as any).request) {
          await this.handleWhoRequest(connectionId, message);
        }
        break;
        
      case 'locate':
        if ((message.payload as any).request) {
          await this.handleLocateRequest(connectionId, message);
        }
        break;
        
      default:
        this.sendError(connectionId, ErrorCodes.UNSUPPORTED_VERSION, `Unsupported gateway message type: ${message.type}`);
    }
  }

  private async handleWhoRequest(connectionId: string, message: MudVaultMessage): Promise<void> {
    const connectedMuds = await redisService.smembers('connected_muds');
    
    await this.sendMessage(connectionId, {
      ...message,
      from: { mud: 'Gateway' },
      to: { mud: message.from.mud },
      payload: {
        users: connectedMuds.map(mud => ({ username: mud, displayName: mud }))
      }
    });
  }

  private async handleLocateRequest(connectionId: string, message: MudVaultMessage): Promise<void> {
    const { user } = message.payload as any;
    const locations: any[] = [];
    
    for (const [_connId, connection] of this.connectionInfo) {
      if (connection.authenticated) {
        locations.push({
          mud: connection.mudName,
          online: true
        });
      }
    }

    await this.sendMessage(connectionId, {
      ...message,
      from: { mud: 'Gateway' },
      to: { mud: message.from.mud },
      payload: {
        user,
        locations
      }
    });
  }

  private findConnectionByMud(mudName: string): string | null {
    for (const [connId, info] of this.connectionInfo) {
      if (info.mudName === mudName && info.authenticated) {
        return connId;
      }
    }
    return null;
  }

  private async sendMessage(connectionId: string, message: MudVaultMessage): Promise<void> {
    const ws = this.connections.get(connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error(`Error sending message to ${connectionId}:`, error);
    }
  }

  private sendError(connectionId: string, code: ErrorCodes, message: string): void {
    const connection = this.connectionInfo.get(connectionId);
    if (!connection) {
      return;
    }

    const errorMessage = createErrorMessage(
      { mud: 'Gateway' },
      { mud: connection.mudName || 'Unknown' },
      code,
      message
    );

    this.sendMessage(connectionId, errorMessage);
  }

  private async storeMessage(message: MudVaultMessage): Promise<void> {
    try {
      const key = `message_history:${message.type}`;
      await redisService.lpush(key, JSON.stringify(message));
      await redisService.ltrim(key, 0, 999); // Keep last 1000 messages
    } catch (error) {
      logger.error('Error storing message:', error);
    }
  }

  private handleDisconnection(connectionId: string, code: number, reason: Buffer): void {
    logger.info(`Connection ${connectionId} disconnected: ${code} ${reason.toString()}`);
    
    const connection = this.connectionInfo.get(connectionId);
    if (connection?.authenticated) {
      redisService.srem('connected_muds', connection.mudName);
      this.mudInfo.delete(connection.mudName);
      this.emit('mudDisconnected', { mudName: connection.mudName, connectionId });
    }

    this.connections.delete(connectionId);
    this.connectionInfo.delete(connectionId);
  }

  private startHeartbeat(connectionId: string): void {
    const interval = setInterval(() => {
      const ws = this.connections.get(connectionId);
      const connection = this.connectionInfo.get(connectionId);
      
      if (!ws || !connection || ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      const now = Date.now();
      const lastSeen = connection.lastSeen.getTime();
      
      if (now - lastSeen > 60000) { // 60 seconds timeout
        logger.warn(`Connection ${connectionId} timed out`);
        ws.terminate();
        clearInterval(interval);
        return;
      }

      ws.ping();
    }, 30000); // Ping every 30 seconds
  }

  private updateLastSeen(connectionId: string): void {
    const connection = this.connectionInfo.get(connectionId);
    if (connection) {
      connection.lastSeen = new Date();
    }
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public getConnections(): ConnectionInfo[] {
    return Array.from(this.connectionInfo.values());
  }

  public getMudInfo(): MudInfo[] {
    return Array.from(this.mudInfo.values());
  }

  public async close(): Promise<void> {
    logger.info('Shutting down gateway...');
    
    for (const ws of this.connections.values()) {
      ws.close();
    }

    this.server.close();
    await redisService.disconnect();
  }
}

export default Gateway;