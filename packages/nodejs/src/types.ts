export interface MeshMessage {
  version: string;
  id: string;
  timestamp: string;
  type: MessageType;
  from: MessageEndpoint;
  to: MessageEndpoint;
  payload: MessagePayload;
  signature?: string;
  metadata: MessageMetadata;
}

export interface MessageEndpoint {
  mud: string;
  user?: string;
  displayName?: string;
  channel?: string;
}

export interface MessageMetadata {
  priority: number;
  ttl: number;
  encoding: string;
  language: string;
  retry?: boolean;
}

export type MessageType = 
  | 'tell' 
  | 'emote' 
  | 'emoteto'
  | 'channel' 
  | 'who' 
  | 'finger' 
  | 'locate'
  | 'presence'
  | 'auth'
  | 'ping'
  | 'pong'
  | 'error';

export type MessagePayload = 
  | TellPayload 
  | EmotePayload 
  | ChannelPayload 
  | WhoPayload 
  | FingerPayload 
  | LocatePayload
  | PresencePayload
  | AuthPayload
  | PingPayload
  | ErrorPayload;

export interface TellPayload {
  message: string;
  formatted?: string;
}

export interface EmotePayload {
  action: string;
  target?: string;
  formatted?: string;
}

export interface ChannelPayload {
  channel: string;
  message: string;
  action?: 'join' | 'leave' | 'message' | 'list';
  formatted?: string;
}

export interface WhoPayload {
  users?: UserInfo[];
  request?: boolean;
}

export interface FingerPayload {
  user: string;
  info?: UserInfo;
  request?: boolean;
}

export interface LocatePayload {
  user: string;
  locations?: UserLocation[];
  request?: boolean;
}

export interface PresencePayload {
  status: 'online' | 'offline' | 'away' | 'busy';
  activity?: string;
  location?: string;
}

export interface AuthPayload {
  token?: string;
  mudName?: string;
  challenge?: string;
  response?: string;
}

export interface PingPayload {
  timestamp: number;
}

export interface ErrorPayload {
  code: number;
  message: string;
  details?: any;
}

export interface UserInfo {
  username: string;
  displayName?: string;
  idleTime?: number;
  location?: string;
  level?: number;
  race?: string;
  class?: string;
  guild?: string;
  lastLogin?: string;
  email?: string;
  realName?: string;
  plan?: string;
}

export interface UserLocation {
  mud: string;
  room?: string;
  area?: string;
  online: boolean;
}

export interface ConnectionState {
  connected: boolean;
  authenticated: boolean;
  reconnectAttempts: number;
  lastPing?: number;
  lastPong?: number;
}

export interface MeshClientOptions {
  mudName: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  timeout?: number;
}

export enum ErrorCodes {
  INVALID_MESSAGE = 1000,
  AUTHENTICATION_FAILED = 1001,
  UNAUTHORIZED = 1002,
  MUD_NOT_FOUND = 1003,
  USER_NOT_FOUND = 1004,
  CHANNEL_NOT_FOUND = 1005,
  RATE_LIMITED = 1006,
  INTERNAL_ERROR = 1007,
  PROTOCOL_ERROR = 1008,
  UNSUPPORTED_VERSION = 1009,
  MESSAGE_TOO_LARGE = 1010
}