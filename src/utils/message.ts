import { v4 as uuidv4 } from 'uuid';
import { OpenIMCMessage, MessageType, MessageEndpoint, MessagePayload, MessageMetadata } from '../types';

export function createMessage(
  type: MessageType,
  from: MessageEndpoint,
  to: MessageEndpoint,
  payload: MessagePayload,
  metadata?: Partial<MessageMetadata>
): OpenIMCMessage {
  const defaultMetadata: MessageMetadata = {
    priority: 5,
    ttl: 300,
    encoding: 'utf-8',
    language: 'en',
    ...metadata
  };

  return {
    version: '1.0',
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type,
    from,
    to,
    payload,
    metadata: defaultMetadata
  };
}

export function createErrorMessage(
  from: MessageEndpoint,
  to: MessageEndpoint,
  code: number,
  message: string,
  details?: any
): OpenIMCMessage {
  return createMessage(
    'error',
    from,
    to,
    {
      code,
      message,
      details
    }
  );
}

export function createPingMessage(from: MessageEndpoint, to: MessageEndpoint): OpenIMCMessage {
  return createMessage(
    'ping',
    from,
    to,
    {
      timestamp: Date.now()
    }
  );
}

export function createPongMessage(from: MessageEndpoint, to: MessageEndpoint, originalTimestamp: number): OpenIMCMessage {
  return createMessage(
    'pong',
    from,
    to,
    {
      timestamp: originalTimestamp
    }
  );
}

export function createTellMessage(
  from: MessageEndpoint,
  to: MessageEndpoint,
  message: string
): OpenIMCMessage {
  return createMessage(
    'tell',
    from,
    to,
    {
      message
    }
  );
}

export function createChannelMessage(
  from: MessageEndpoint,
  channel: string,
  message: string,
  action: 'join' | 'leave' | 'message' | 'list' = 'message'
): OpenIMCMessage {
  return createMessage(
    'channel',
    from,
    { mud: '*', channel },
    {
      channel,
      message,
      action
    }
  );
}

export function createWhoRequestMessage(from: MessageEndpoint, targetMud: string): OpenIMCMessage {
  return createMessage(
    'who',
    from,
    { mud: targetMud },
    {
      request: true
    }
  );
}

export function createFingerRequestMessage(
  from: MessageEndpoint,
  targetMud: string,
  targetUser: string
): OpenIMCMessage {
  return createMessage(
    'finger',
    from,
    { mud: targetMud, user: targetUser },
    {
      user: targetUser,
      request: true
    }
  );
}

export function createLocateRequestMessage(
  from: MessageEndpoint,
  targetUser: string
): OpenIMCMessage {
  return createMessage(
    'locate',
    from,
    { mud: '*' },
    {
      user: targetUser,
      request: true
    }
  );
}

export function isExpired(message: OpenIMCMessage): boolean {
  const messageTime = new Date(message.timestamp).getTime();
  const now = Date.now();
  const ttlMs = message.metadata.ttl * 1000;
  
  return (now - messageTime) > ttlMs;
}

export function shouldRetry(message: OpenIMCMessage, attempts: number = 0): boolean {
  if (!message.metadata.retry) {
    return false;
  }
  
  const maxRetries = Math.max(1, Math.floor(message.metadata.priority / 2));
  return attempts < maxRetries && !isExpired(message);
}

export function formatMessageForDisplay(message: OpenIMCMessage): string {
  switch (message.type) {
    case 'tell':
      return `${message.from.user}@${message.from.mud} tells you: ${(message.payload as any).message}`;
    
    case 'emote':
      return `${message.from.user}@${message.from.mud} ${(message.payload as any).action}`;
    
    case 'emoteto':
      return `${message.from.user}@${message.from.mud} ${(message.payload as any).action} ${(message.payload as any).target}`;
    
    case 'channel':
      if ((message.payload as any).action === 'join') {
        return `${message.from.user}@${message.from.mud} has joined channel ${(message.payload as any).channel}`;
      } else if ((message.payload as any).action === 'leave') {
        return `${message.from.user}@${message.from.mud} has left channel ${(message.payload as any).channel}`;
      } else {
        return `[${(message.payload as any).channel}] ${message.from.user}@${message.from.mud}: ${(message.payload as any).message}`;
      }
    
    case 'error':
      return `Error ${(message.payload as any).code}: ${(message.payload as any).message}`;
    
    default:
      return JSON.stringify(message);
  }
}

export function sanitizeMessage(message: string): string {
  return message
    .replace(/[^\x20-\x7E]/g, '')
    .substring(0, 4096)
    .trim();
}