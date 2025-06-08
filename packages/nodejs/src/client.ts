import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { 
  MeshMessage, 
  MessageEndpoint, 
  UserInfo, 
  ConnectionState, 
  MeshClientOptions 
} from './types';
import { 
  createMessage, 
  createTellMessage, 
  createChannelMessage, 
  createWhoRequestMessage,
  createFingerRequestMessage,
  createLocateRequestMessage,
  createPingMessage,
  createPongMessage
} from './utils';

export class MeshClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: Required<MeshClientOptions>;
  private state: ConnectionState = {
    connected: false,
    authenticated: false,
    reconnectAttempts: 0
  };
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private gatewayUrl: string = '';

  constructor(options: MeshClientOptions) {
    super();
    
    this.options = {
      mudName: options.mudName,
      autoReconnect: options.autoReconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 5000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      timeout: options.timeout ?? 10000
    };

    if (!this.options.mudName || typeof this.options.mudName !== 'string') {
      throw new Error('MUD name is required and must be a string');
    }
  }

  public async connect(gatewayUrl: string = 'wss://mesh.mudvault.org', apiKey?: string): Promise<void> {
    if (this.state.connected) {
      throw new Error('Already connected');
    }

    this.gatewayUrl = gatewayUrl;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(gatewayUrl);

        const connectTimeout = setTimeout(() => {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }, this.options.timeout);

        this.ws.on('open', () => {
          clearTimeout(connectTimeout);
          this.state.connected = true;
          this.state.reconnectAttempts = 0;
          
          this.emit('connected');
          this.authenticate(apiKey).then(() => {
            resolve();
          }).catch(reject);
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          this.handleDisconnection(code, reason.toString());
        });

        this.ws.on('error', (error) => {
          clearTimeout(connectTimeout);
          this.emit('error', error);
          
          if (!this.state.connected) {
            reject(error);
          }
        });

        this.ws.on('pong', () => {
          this.state.lastPong = Date.now();
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  public disconnect(): void {
    this.options.autoReconnect = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state.connected = false;
    this.state.authenticated = false;
  }

  private async authenticate(apiKey?: string): Promise<void> {
    const authMessage = createMessage(
      'auth',
      { mud: this.options.mudName },
      { mud: 'Gateway' },
      {
        mudName: this.options.mudName,
        token: apiKey
      }
    );

    this.sendMessage(authMessage);
    this.startHeartbeat();
    
    // Authentication success is implied if no error is received
    setTimeout(() => {
      this.state.authenticated = true;
      this.emit('authenticated');
    }, 1000);
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const messageText = data.toString();
      const messageData = JSON.parse(messageText);
      
      // Basic validation
      if (!messageData.type || !messageData.from || !messageData.to) {
        this.emit('error', new Error('Invalid message received: missing required fields'));
        return;
      }

      const message = messageData as MeshMessage;
      
      // Handle special message types
      switch (message.type) {
        case 'ping':
          this.handlePing(message);
          break;
        case 'pong':
          this.handlePong(message);
          break;
        case 'error':
          this.emit('error', new Error(`Server error: ${(message.payload as any).message}`));
          break;
        default:
          this.emit('message', message);
          this.emit(message.type, message);
      }

    } catch (error: any) {
      this.emit('error', new Error(`Failed to parse message: ${error.message}`));
    }
  }

  private handlePing(message: MeshMessage): void {
    const pongMessage = createPongMessage(
      { mud: this.options.mudName },
      { mud: 'Gateway' },
      (message.payload as any).timestamp
    );
    
    this.sendMessage(pongMessage);
  }

  private handlePong(message: MeshMessage): void {
    this.state.lastPong = Date.now();
    const latency = this.state.lastPong - (message.payload as any).timestamp;
    this.emit('pong', { latency });
  }

  private handleDisconnection(code: number, reason: string): void {
    this.state.connected = false;
    this.state.authenticated = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.emit('disconnected', { code, reason });

    if (this.options.autoReconnect && this.state.reconnectAttempts < this.options.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    const delay = this.options.reconnectInterval * Math.pow(2, this.state.reconnectAttempts);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.state.reconnectAttempts++;
      
      this.emit('reconnecting', { attempt: this.state.reconnectAttempts });
      
      this.connect(this.gatewayUrl).catch((error) => {
        this.emit('reconnectFailed', { attempt: this.state.reconnectAttempts, error });
        
        if (this.state.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this.emit('reconnectGiveUp');
        }
      });
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.state.connected || !this.ws) {
        return;
      }

      const now = Date.now();
      
      // Check if we've missed too many pongs
      if (this.state.lastPong && (now - this.state.lastPong) > (this.options.heartbeatInterval * 2)) {
        this.ws.close();
        return;
      }

      // Send ping
      this.state.lastPing = now;
      const pingMessage = createPingMessage(
        { mud: this.options.mudName },
        { mud: 'Gateway' }
      );
      
      this.sendMessage(pingMessage);
    }, this.options.heartbeatInterval);
  }

  private sendMessage(message: MeshMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    this.ws.send(JSON.stringify(message));
  }

  // Public API methods
  public sendTell(to: MessageEndpoint, message: string): void {
    const tellMessage = createTellMessage(
      { mud: this.options.mudName, user: 'System' },
      to,
      message
    );
    
    this.sendMessage(tellMessage);
  }

  public sendChannelMessage(channel: string, message: string, user?: string): void {
    const channelMessage = createChannelMessage(
      { mud: this.options.mudName, user: user || 'System' },
      channel,
      message
    );
    
    this.sendMessage(channelMessage);
  }

  public joinChannel(channel: string, user?: string): void {
    const joinMessage = createChannelMessage(
      { mud: this.options.mudName, user: user || 'System' },
      channel,
      '',
      'join'
    );
    
    this.sendMessage(joinMessage);
  }

  public leaveChannel(channel: string, user?: string): void {
    const leaveMessage = createChannelMessage(
      { mud: this.options.mudName, user: user || 'System' },
      channel,
      '',
      'leave'
    );
    
    this.sendMessage(leaveMessage);
  }

  public requestWho(targetMud: string): void {
    const whoMessage = createWhoRequestMessage(
      { mud: this.options.mudName },
      targetMud
    );
    
    this.sendMessage(whoMessage);
  }

  public requestFinger(targetMud: string, targetUser: string): void {
    const fingerMessage = createFingerRequestMessage(
      { mud: this.options.mudName },
      targetMud,
      targetUser
    );
    
    this.sendMessage(fingerMessage);
  }

  public requestLocate(targetUser: string): void {
    const locateMessage = createLocateRequestMessage(
      { mud: this.options.mudName },
      targetUser
    );
    
    this.sendMessage(locateMessage);
  }

  public setUserOnline(userInfo: UserInfo): void {
    const presenceMessage = createMessage(
      'presence',
      { mud: this.options.mudName, user: userInfo.username },
      { mud: 'Gateway' },
      {
        status: 'online',
        activity: userInfo.location,
        location: userInfo.location
      }
    );
    
    this.sendMessage(presenceMessage);
  }

  public setUserOffline(username: string): void {
    const presenceMessage = createMessage(
      'presence',
      { mud: this.options.mudName, user: username },
      { mud: 'Gateway' },
      {
        status: 'offline'
      }
    );
    
    this.sendMessage(presenceMessage);
  }

  // Getters
  public isConnected(): boolean {
    return this.state.connected;
  }

  public isAuthenticated(): boolean {
    return this.state.authenticated;
  }

  public getConnectionState(): ConnectionState {
    return { ...this.state };
  }

  public getMudName(): string {
    return this.options.mudName;
  }

  // Event handler convenience methods
  public onTell(handler: (message: MeshMessage) => void): this {
    return this.on('tell', handler);
  }

  public onChannel(handler: (message: MeshMessage) => void): this {
    return this.on('channel', handler);
  }

  public onWho(handler: (message: MeshMessage) => void): this {
    return this.on('who', handler);
  }

  public onFinger(handler: (message: MeshMessage) => void): this {
    return this.on('finger', handler);
  }

  public onLocate(handler: (message: MeshMessage) => void): this {
    return this.on('locate', handler);
  }

  public onEmote(handler: (message: MeshMessage) => void): this {
    return this.on('emote', handler);
  }

  public onEmoteTo(handler: (message: MeshMessage) => void): this {
    return this.on('emoteto', handler);
  }
}