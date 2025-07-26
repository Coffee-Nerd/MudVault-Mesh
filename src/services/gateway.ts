import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { MudVaultMessage, ConnectionInfo, MudInfo, ErrorCodes, WhoUser } from '../types';
import { validateMessage, validateMudName, normalizeMudName } from '../utils/validation';
import { createErrorMessage, createPongMessage, createMessage, isExpired } from '../utils/message';
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
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const origin = req.headers.origin || 'Unknown';
    
    logger.info(`🔗 NEW CONNECTION: ${connectionId}`, {
      remoteAddress,
      userAgent,
      origin,
      timestamp: new Date().toISOString(),
      totalConnections: this.connections.size + 1,
      headers: {
        'user-agent': userAgent,
        'origin': origin,
        'sec-websocket-protocol': req.headers['sec-websocket-protocol'],
        'sec-websocket-version': req.headers['sec-websocket-version']
      }
    });
    
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
      const connInfo = this.connectionInfo.get(connectionId);
      logger.error(`❌ WEBSOCKET ERROR: ${connectionId}`, {
        error: error.message,
        mudName: connInfo?.mudName || 'Unknown',
        authenticated: connInfo?.authenticated || false,
        remoteAddress: connInfo?.host || 'Unknown',
        messageCount: connInfo?.messageCount || 0,
        connectionDuration: connInfo ? Date.now() - connInfo.connected.getTime() : 0
      });
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
        logger.warn(`📦 MESSAGE IGNORED: Connection ${connectionId} not found`);
        return;
      }

      connection.lastSeen = new Date();
      connection.messageCount++;

      const messageText = data.toString();
      const messageSize = Buffer.byteLength(messageText, 'utf8');
      
      logger.debug(`📨 INCOMING MESSAGE: ${connectionId}`, {
        mudName: connection.mudName || 'Unauthenticated',
        authenticated: connection.authenticated,
        messageSize,
        messageCount: connection.messageCount,
        rawLength: messageText.length,
        preview: messageText.substring(0, 200) + (messageText.length > 200 ? '...' : '')
      });

      let messageData: any;
      
      try {
        messageData = JSON.parse(messageText);
      } catch (error) {
        logger.error(`❌ JSON PARSE ERROR: ${connectionId}`, {
          mudName: connection.mudName || 'Unauthenticated',
          error: error instanceof Error ? error.message : 'Unknown error',
          rawData: messageText.substring(0, 500)
        });
        this.sendError(connectionId, ErrorCodes.INVALID_MESSAGE, 'Invalid JSON format');
        return;
      }

      const validation = validateMessage(messageData);
      if (validation.error) {
        logger.error(`❌ VALIDATION ERROR: ${connectionId}`, {
          mudName: connection.mudName || 'Unauthenticated',
          error: validation.error,
          messageType: messageData.type || 'Unknown',
          messageId: messageData.id || 'No ID',
          messageSize: messageText.length,
          rawMessage: messageText.substring(0, 1000),
          parsedData: JSON.stringify(messageData, null, 2).substring(0, 1000)
        });
        this.sendError(connectionId, ErrorCodes.INVALID_MESSAGE, validation.error);
        return;
      }

      const message = validation.value!;

      logger.info(`✅ VALID MESSAGE: ${connectionId}`, {
        mudName: connection.mudName || 'Unauthenticated',
        messageType: message.type,
        messageId: message.id,
        from: `${message.from.user || 'No user'}@${message.from.mud}`,
        to: message.to.user ? `${message.to.user}@${message.to.mud}` : `channel:${message.to.channel}` || message.to.mud,
        priority: message.metadata.priority,
        ttl: message.metadata.ttl
      });

      if (isExpired(message)) {
        logger.warn(`⏰ EXPIRED MESSAGE: ${connectionId}`, {
          messageId: message.id,
          mudName: connection.mudName || 'Unauthenticated',
          timestamp: message.timestamp,
          age: Date.now() - new Date(message.timestamp).getTime()
        });
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
      logger.warn(`🔐 AUTH ATTEMPT: Connection ${connectionId} not found`);
      return;
    }

    const { mudName } = message.payload as any;
    
    logger.info(`🔐 AUTHENTICATION ATTEMPT: ${connectionId}`, {
      attemptedMudName: mudName,
      remoteAddress: connection.host,
      messageId: message.id,
      timestamp: message.timestamp,
      connectionDuration: `${Math.round((Date.now() - connection.connected.getTime()) / 1000)}s`
    });

    if (!mudName || typeof mudName !== 'string') {
      logger.error(`❌ AUTH FAILED - Missing MUD name: ${connectionId}`, {
        remoteAddress: connection.host,
        providedMudName: mudName,
        mudNameType: typeof mudName
      });
      this.sendError(connectionId, ErrorCodes.AUTHENTICATION_FAILED, 'Missing mud name');
      return;
    }

    // Reject MUD names with spaces or invalid characters
    if (!validateMudName(mudName)) {
      const suggestedName = normalizeMudName(mudName);
      logger.error(`❌ AUTH FAILED - Invalid MUD name: ${connectionId}`, {
        providedName: mudName,
        suggestedName: suggestedName,
        remoteAddress: connection.host,
        reason: 'MUD names cannot contain spaces or special characters'
      });
      
      this.sendError(connectionId, ErrorCodes.AUTHENTICATION_FAILED, 
        `Invalid MUD name "${mudName}". MUD names can only contain letters, numbers, dashes, and underscores (no spaces). Suggested name: "${suggestedName}". This ensures proper parsing of intermud commands like: tell user@${suggestedName} message`);
      return;
    }

    const finalMudName = mudName;

    // Check if MUD name is already connected
    const existingMud = Array.from(this.connectionInfo.values()).find(
      conn => conn.authenticated && conn.mudName === finalMudName && conn.id !== connectionId
    );

    if (existingMud) {
      logger.warn(`⚠️ MUD ALREADY CONNECTED: ${finalMudName}`, {
        newConnectionId: connectionId,
        existingConnectionId: existingMud.id,
        newRemoteAddress: connection.host,
        existingRemoteAddress: existingMud.host
      });
    }

    connection.mudName = finalMudName;
    connection.authenticated = true;

    const mudInfo = {
      name: finalMudName,
      host: connection.host,
      version: message.version,
      admin: '',
      email: '',
      time: new Date().toISOString(),
      uptime: 0,
      users: 0
    };

    this.mudInfo.set(finalMudName, mudInfo);

    await redisService.sadd('connected_muds', finalMudName);
    await redisService.set(`mud_info:${finalMudName}`, JSON.stringify(mudInfo), 3600);

    logger.info(`✅ MUD AUTHENTICATED: ${finalMudName}`, {
      connectionId,
      remoteAddress: connection.host,
      version: message.version,
      messageId: message.id,
      totalConnectedMuds: this.mudInfo.size,
      authenticationTime: `${Math.round((Date.now() - connection.connected.getTime()) / 1000)}s`
    });

    // Send authentication success response
    const authSuccessMessage = createMessage(
      'auth',
      { mud: 'Gateway' },
      { mud: finalMudName },
      {
        mudName: finalMudName,
        response: 'Authentication successful'
      },
      { priority: 10 }
    );

    await this.sendMessage(connectionId, authSuccessMessage);
    
    this.emit('mudConnected', { mudName: finalMudName, connectionId });
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
      logger.warn(`📤 ROUTING FAILED: Connection ${connectionId} not found`);
      return;
    }

    message.from.mud = connection.mudName;

    logger.info(`📤 ROUTING MESSAGE: ${message.id}`, {
      from: `${message.from.user || 'System'}@${message.from.mud}`,
      to: message.to.user ? `${message.to.user}@${message.to.mud}` : `${message.to.channel ? `#${message.to.channel}` : message.to.mud}`,
      type: message.type,
      priority: message.metadata.priority,
      routingMode: message.to.mud === '*' ? 'BROADCAST' : message.to.mud === 'Gateway' ? 'GATEWAY' : 'FORWARD',
      messageSize: JSON.stringify(message).length
    });

    try {
      if (message.to.mud === '*') {
        await this.broadcastMessage(message, connectionId);
      } else if (message.to.mud === 'Gateway') {
        await this.handleGatewayMessage(connectionId, message);
      } else {
        await this.forwardMessage(message, connectionId);
      }

      await this.storeMessage(message);
      this.emit('messageRouted', { message, fromConnection: connectionId });
      
      logger.debug(`✅ MESSAGE ROUTED SUCCESSFULLY: ${message.id}`);
    } catch (error) {
      logger.error(`❌ MESSAGE ROUTING FAILED: ${message.id}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageType: message.type,
        from: message.from.mud,
        to: message.to.mud
      });
    }
  }

  private async broadcastMessage(message: MudVaultMessage, excludeConnection?: string): Promise<void> {
    const promises: Promise<void>[] = [];
    const targetMuds: string[] = [];
    
    for (const [connId, ws] of this.connections) {
      if (connId !== excludeConnection && ws.readyState === WebSocket.OPEN) {
        const connection = this.connectionInfo.get(connId);
        if (connection?.authenticated) {
          promises.push(this.sendMessage(connId, message));
          targetMuds.push(connection.mudName);
        }
      }
    }

    logger.info(`📡 BROADCASTING MESSAGE: ${message.id}`, {
      from: `${message.from.user || 'System'}@${message.from.mud}`,
      type: message.type,
      targetCount: targetMuds.length,
      targetMuds: targetMuds.join(', '),
      excludedConnection: excludeConnection || 'None'
    });

    await Promise.all(promises);
  }

  private async forwardMessage(message: MudVaultMessage, fromConnection: string): Promise<void> {
    const targetMud = message.to.mud;
    const targetConnection = this.findConnectionByMud(targetMud);

    if (!targetConnection) {
      logger.warn(`❌ FORWARD FAILED - Target MUD not found: ${message.id}`, {
        from: `${message.from.user || 'System'}@${message.from.mud}`,
        targetMud,
        type: message.type,
        availableMuds: Array.from(this.mudInfo.keys()).join(', ') || 'None'
      });
      this.sendError(fromConnection, ErrorCodes.MUD_NOT_FOUND, `MUD ${targetMud} not found`);
      return;
    }

    const targetInfo = this.connectionInfo.get(targetConnection);
    logger.info(`➡️ FORWARDING MESSAGE: ${message.id}`, {
      from: `${message.from.user || 'System'}@${message.from.mud}`,
      to: message.to.user ? `${message.to.user}@${targetMud}` : targetMud,
      type: message.type,
      targetConnection,
      targetRemoteAddress: targetInfo?.host || 'Unknown'
    });

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

      case 'mudlist':
        if ((message.payload as any).request) {
          await this.handleMudListRequest(connectionId, message);
        }
        break;

      case 'channels':
        if ((message.payload as any).request) {
          await this.handleChannelsRequest(connectionId, message);
        }
        break;
        
      default:
        this.sendError(connectionId, ErrorCodes.UNSUPPORTED_VERSION, `Unsupported gateway message type: ${message.type}`);
    }
  }

  private async handleWhoRequest(connectionId: string, message: MudVaultMessage): Promise<void> {
    const payload = message.payload as any;
    
    logger.info(`🔍 WHO REQUEST: ${connectionId}`, {
      mudName: message.from.mud,
      requestParameters: {
        sort: payload.sort || 'none',
        format: payload.format || 'long',
        filter: payload.filter || 'none'
      }
    });

    // For gateway who requests, we show connected MUDs as "users"
    const connectedMuds = await redisService.smembers('connected_muds');
    const mudUsers: WhoUser[] = [];

    for (const mudName of connectedMuds) {
      const connection = Array.from(this.connectionInfo.values())
        .find(conn => conn.authenticated && conn.mudName === mudName);
      
      if (connection) {
        const idleSeconds = Math.floor((Date.now() - connection.lastSeen.getTime()) / 1000);
        const uptimeSeconds = Math.floor((Date.now() - connection.connected.getTime()) / 1000);
        
        mudUsers.push({
          username: mudName,
          displayName: mudName,
          title: 'MUD Server',
          level: 'System',
          idle: idleSeconds,
          location: connection.host,
          flags: ['mud', 'system'],
          realName: `${mudName} (Connected ${uptimeSeconds}s ago)`
        });
      }
    }

    // Apply sorting if requested
    if (payload.sort) {
      mudUsers.sort((a, b) => {
        switch (payload.sort) {
          case 'alpha':
            return a.username.localeCompare(b.username);
          case 'idle':
            return a.idle - b.idle;
          case 'level':
            return (a.level || '').localeCompare(b.level || '');
          case 'random':
            return Math.random() - 0.5;
          default:
            return 0;
        }
      });
    }

    const whoResponse = createMessage(
      'who',
      { mud: 'Gateway' },
      { mud: message.from.mud },
      { 
        users: mudUsers,
        request: false // This is a response, not a request
      },
      { priority: message.metadata.priority }
    );

    logger.info(`📊 WHO RESPONSE: ${connectionId}`, {
      mudName: message.from.mud,
      userCount: mudUsers.length,
      responseSize: JSON.stringify(whoResponse).length
    });

    await this.sendMessage(connectionId, whoResponse);
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

  private async handleMudListRequest(connectionId: string, message: MudVaultMessage): Promise<void> {
    logger.info(`📋 MUDLIST REQUEST: ${connectionId}`, {
      mudName: message.from.mud,
      messageId: message.id
    });

    const connectedMuds = await redisService.smembers('connected_muds');
    const mudList = [];

    for (const mudName of connectedMuds) {
      const connection = Array.from(this.connectionInfo.values())
        .find(conn => conn.authenticated && conn.mudName === mudName);
      
      if (connection) {
        const uptimeSeconds = Math.floor((Date.now() - connection.connected.getTime()) / 1000);
        
        mudList.push({
          name: mudName,
          host: connection.host,
          version: connection.version,
          admin: '', // Could be populated from MUD info
          email: '', // Could be populated from MUD info
          uptime: uptimeSeconds,
          users: 0, // Could be populated from who queries
          description: `${mudName} MUD Server`
        });
      }
    }

    const response = createMessage(
      'mudlist',
      { mud: 'Gateway' },
      { mud: message.from.mud },
      { 
        muds: mudList,
        request: false
      },
      { priority: message.metadata.priority }
    );

    logger.info(`📋 MUDLIST RESPONSE: ${connectionId}`, {
      mudName: message.from.mud,
      mudCount: mudList.length,
      muds: mudList.map(m => m.name).join(', ')
    });

    await this.sendMessage(connectionId, response);
  }

  private async handleChannelsRequest(connectionId: string, message: MudVaultMessage): Promise<void> {
    logger.info(`📺 CHANNELS REQUEST: ${connectionId}`, {
      mudName: message.from.mud,
      messageId: message.id
    });

    // For now, return hardcoded channels - could be made dynamic later
    const channels = [
      { name: 'ooc', description: 'Out of Character chat', memberCount: 0, flags: ['public'] },
      { name: 'chat', description: 'General chat channel', memberCount: 0, flags: ['public'] },
      { name: 'gossip', description: 'Gossip and rumors', memberCount: 0, flags: ['public'] },
      { name: 'newbie', description: 'Help for new players', memberCount: 0, flags: ['public'] },
      { name: 'admin', description: 'Administrative channel', memberCount: 0, flags: ['private', 'admin'] }
    ];

    const response = createMessage(
      'channels',
      { mud: 'Gateway' },
      { mud: message.from.mud },
      { 
        channels: channels,
        request: false
      },
      { priority: message.metadata.priority }
    );

    logger.info(`📺 CHANNELS RESPONSE: ${connectionId}`, {
      mudName: message.from.mud,
      channelCount: channels.length,
      channels: channels.map(c => c.name).join(', ')
    });

    await this.sendMessage(connectionId, response);
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
    const connection = this.connectionInfo.get(connectionId);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn(`⚠️ CANNOT SEND - Connection not ready: ${connectionId}`, {
        hasWebSocket: !!ws,
        readyState: ws?.readyState,
        mudName: connection?.mudName || 'Unknown'
      });
      return;
    }

    try {
      const messageJson = JSON.stringify(message);
      const messageSize = Buffer.byteLength(messageJson, 'utf8');
      
      logger.debug(`📤 OUTGOING MESSAGE: ${connectionId}`, {
        mudName: connection?.mudName || 'Unknown',
        messageType: message.type,
        messageId: message.id,
        messageSize,
        to: message.to.user ? `${message.to.user}@${message.to.mud}` : message.to.mud,
        isError: message.type === 'error'
      });

      ws.send(messageJson);
    } catch (error) {
      logger.error(`❌ SEND ERROR: ${connectionId}`, {
        mudName: connection?.mudName || 'Unknown',
        messageType: message.type,
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private sendError(connectionId: string, code: ErrorCodes, message: string): void {
    const connection = this.connectionInfo.get(connectionId);
    if (!connection) {
      logger.warn(`⚠️ CANNOT SEND ERROR - Connection not found: ${connectionId}`);
      return;
    }

    logger.warn(`🚨 SENDING ERROR: ${connectionId}`, {
      mudName: connection.mudName || 'Unauthenticated',
      errorCode: code,
      errorMessage: message,
      remoteAddress: connection.host
    });

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
    const connection = this.connectionInfo.get(connectionId);
    const connectionDuration = connection ? Date.now() - connection.connected.getTime() : 0;
    const reasonText = reason.toString() || 'No reason provided';
    
    logger.info(`🔌 DISCONNECTION: ${connectionId}`, {
      disconnectCode: code,
      reason: reasonText,
      mudName: connection?.mudName || 'Unauthenticated',
      authenticated: connection?.authenticated || false,
      remoteAddress: connection?.host || 'Unknown',
      messageCount: connection?.messageCount || 0,
      connectionDuration: `${Math.round(connectionDuration / 1000)}s`,
      remainingConnections: this.connections.size - 1,
      wasAuthenticatedMud: connection?.authenticated && connection?.mudName ? true : false
    });
    
    if (connection?.authenticated && connection?.mudName) {
      logger.info(`🏠 MUD DISCONNECTED: ${connection.mudName}`, {
        connectionId,
        totalMessagesProcessed: connection.messageCount,
        sessionDuration: `${Math.round(connectionDuration / 1000)}s`,
        lastSeen: connection.lastSeen.toISOString()
      });
      
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