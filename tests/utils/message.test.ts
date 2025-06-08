import {
  createMessage,
  createTellMessage,
  createChannelMessage,
  createWhoRequestMessage,
  createPingMessage,
  createPongMessage,
  createErrorMessage,
  isExpired
} from '../../src/utils/message';
import { ErrorCodes } from '../../src/types';

describe('Message Utilities', () => {
  describe('createMessage', () => {
    test('should create a basic message with required fields', () => {
      const message = createMessage(
        'tell',
        { mud: 'TestMUD', user: 'testuser' },
        { mud: 'TargetMUD', user: 'targetuser' },
        { message: 'Hello' }
      );

      expect(message.version).toBe('1.0');
      expect(message.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(message.timestamp).toBeDefined();
      expect(message.type).toBe('tell');
      expect(message.from).toEqual({ mud: 'TestMUD', user: 'testuser' });
      expect(message.to).toEqual({ mud: 'TargetMUD', user: 'targetuser' });
      expect(message.payload).toEqual({ message: 'Hello' });
      expect(message.metadata.priority).toBe(5);
      expect(message.metadata.ttl).toBe(300);
      expect(message.metadata.encoding).toBe('utf-8');
      expect(message.metadata.language).toBe('en');
    });

    test('should accept custom metadata', () => {
      const message = createMessage(
        'tell',
        { mud: 'TestMUD' },
        { mud: 'TargetMUD' },
        { message: 'Hello' },
        { priority: 1, ttl: 600, encoding: 'ascii', language: 'es' }
      );

      expect(message.metadata.priority).toBe(1);
      expect(message.metadata.ttl).toBe(600);
      expect(message.metadata.encoding).toBe('ascii');
      expect(message.metadata.language).toBe('es');
    });
  });

  describe('createTellMessage', () => {
    test('should create a tell message', () => {
      const message = createTellMessage(
        { mud: 'TestMUD', user: 'sender' },
        { mud: 'TargetMUD', user: 'recipient' },
        'Hello there!'
      );

      expect(message.type).toBe('tell');
      expect(message.from).toEqual({ mud: 'TestMUD', user: 'sender' });
      expect(message.to).toEqual({ mud: 'TargetMUD', user: 'recipient' });
      expect(message.payload).toEqual({
        message: 'Hello there!'
      });
    });

    test('should create a tell message with simple payload', () => {
      const message = createTellMessage(
        { mud: 'TestMUD', user: 'sender' },
        { mud: 'TargetMUD', user: 'recipient' },
        'Hello there!'
      );

      expect(message.payload).toEqual({
        message: 'Hello there!'
      });
    });
  });

  describe('createChannelMessage', () => {
    test('should create a channel message', () => {
      const message = createChannelMessage(
        { mud: 'TestMUD', user: 'sender' },
        'gossip',
        'Hello channel!'
      );

      expect(message.type).toBe('channel');
      expect(message.from).toEqual({ mud: 'TestMUD', user: 'sender' });
      expect(message.to).toEqual({ mud: '*', channel: 'gossip' });
      expect(message.payload).toEqual({
        channel: 'gossip',
        message: 'Hello channel!',
        action: 'message'
      });
    });

    test('should create a channel join message', () => {
      const message = createChannelMessage(
        { mud: 'TestMUD', user: 'sender' },
        'gossip',
        '',
        'join'
      );

      expect(message.payload).toEqual({
        channel: 'gossip',
        message: '',
        action: 'join'
      });
    });

    test('should create a channel leave message', () => {
      const message = createChannelMessage(
        { mud: 'TestMUD', user: 'sender' },
        'gossip',
        '',
        'leave'
      );

      expect(message.payload).toEqual({
        channel: 'gossip',
        message: '',
        action: 'leave'
      });
    });
  });

  describe('createWhoRequestMessage', () => {
    test('should create a who request message', () => {
      const message = createWhoRequestMessage(
        { mud: 'TestMUD' },
        'TargetMUD'
      );

      expect(message.type).toBe('who');
      expect(message.from).toEqual({ mud: 'TestMUD' });
      expect(message.to).toEqual({ mud: 'TargetMUD' });
      expect(message.payload).toEqual({ request: true });
    });
  });

  describe('createPingMessage', () => {
    test('should create a ping message', () => {
      const message = createPingMessage(
        { mud: 'TestMUD' },
        { mud: 'Gateway' }
      );

      expect(message.type).toBe('ping');
      expect(message.from).toEqual({ mud: 'TestMUD' });
      expect(message.to).toEqual({ mud: 'Gateway' });
      expect((message.payload as any).timestamp).toBeCloseTo(Date.now(), -2);
    });
  });

  describe('createPongMessage', () => {
    test('should create a pong message', () => {
      const originalTimestamp = Date.now() - 1000;
      const message = createPongMessage(
        { mud: 'Gateway' },
        { mud: 'TestMUD' },
        originalTimestamp
      );

      expect(message.type).toBe('pong');
      expect(message.from).toEqual({ mud: 'Gateway' });
      expect(message.to).toEqual({ mud: 'TestMUD' });
      expect((message.payload as any).timestamp).toBe(originalTimestamp);
    });
  });

  describe('createErrorMessage', () => {
    test('should create an error message', () => {
      const message = createErrorMessage(
        { mud: 'Gateway' },
        { mud: 'TestMUD' },
        ErrorCodes.AUTHENTICATION_FAILED,
        'Invalid API key'
      );

      expect(message.type).toBe('error');
      expect(message.from).toEqual({ mud: 'Gateway' });
      expect(message.to).toEqual({ mud: 'TestMUD' });
      expect(message.payload).toEqual({
        code: ErrorCodes.AUTHENTICATION_FAILED,
        message: 'Invalid API key'
      });
    });

    test('should create an error message with details', () => {
      const details = { field: 'apiKey', reason: 'missing' };
      const message = createErrorMessage(
        { mud: 'Gateway' },
        { mud: 'TestMUD' },
        ErrorCodes.INVALID_MESSAGE,
        'Validation failed',
        details
      );

      expect(message.payload).toEqual({
        code: ErrorCodes.INVALID_MESSAGE,
        message: 'Validation failed',
        details
      });
    });
  });

  describe('isExpired', () => {
    test('should return false for fresh message', () => {
      const message = createMessage(
        'tell',
        { mud: 'TestMUD' },
        { mud: 'TargetMUD' },
        { message: 'Hello' }
      );

      expect(isExpired(message)).toBe(false);
    });

    test('should return true for expired message', () => {
      const oldTimestamp = new Date(Date.now() - 400000).toISOString(); // 400 seconds ago
      const message = createMessage(
        'tell',
        { mud: 'TestMUD' },
        { mud: 'TargetMUD' },
        { message: 'Hello' },
        { priority: 5, ttl: 300, encoding: 'utf-8', language: 'en' }
      );
      
      // Manually set old timestamp
      message.timestamp = oldTimestamp;

      expect(isExpired(message)).toBe(true);
    });

    test('should handle message at TTL boundary', () => {
      const boundaryTimestamp = new Date(Date.now() - 299000).toISOString(); // 299 seconds ago
      const message = createMessage(
        'tell',
        { mud: 'TestMUD' },
        { mud: 'TargetMUD' },
        { message: 'Hello' },
        { priority: 5, ttl: 300, encoding: 'utf-8', language: 'en' }
      );
      
      message.timestamp = boundaryTimestamp;

      expect(isExpired(message)).toBe(false);
    });
  });
});