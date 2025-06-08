import { v4 as uuidv4 } from 'uuid';
import { MeshMessage, MessageType, MessageEndpoint, MessagePayload, MessageMetadata, ErrorCodes } from './types';

export function createMessage(
  type: MessageType,
  from: MessageEndpoint,
  to: MessageEndpoint,
  payload: MessagePayload,
  metadata?: Partial<MessageMetadata>
): MeshMessage {
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

export function createTellMessage(
  from: MessageEndpoint,
  to: MessageEndpoint,
  message: string
): MeshMessage {
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
): MeshMessage {
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

export function createWhoRequestMessage(from: MessageEndpoint, targetMud: string): MeshMessage {
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
): MeshMessage {
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
): MeshMessage {
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

export function createPingMessage(from: MessageEndpoint, to: MessageEndpoint): MeshMessage {
  return createMessage(
    'ping',
    from,
    to,
    {
      timestamp: Date.now()
    }
  );
}

export function createPongMessage(from: MessageEndpoint, to: MessageEndpoint, originalTimestamp: number): MeshMessage {
  return createMessage(
    'pong',
    from,
    to,
    {
      timestamp: originalTimestamp
    }
  );
}

export function createErrorMessage(
  from: MessageEndpoint,
  to: MessageEndpoint,
  code: number,
  message: string,
  details?: any
): MeshMessage {
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

export function isExpired(message: MeshMessage): boolean {
  const messageTime = new Date(message.timestamp).getTime();
  const now = Date.now();
  const ttlMs = message.metadata.ttl * 1000;
  
  return (now - messageTime) > ttlMs;
}

export function sanitizeMessage(message: string): string {
  return message
    .replace(/[^\x20-\x7E]/g, '')
    .substring(0, 4096)
    .trim();
}