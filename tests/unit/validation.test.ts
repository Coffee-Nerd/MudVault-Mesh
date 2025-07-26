import { validateMessage, validateMudName, normalizeMudName } from '../../src/utils/validation';
import { MudVaultMessage } from '../../src/types';

describe('validateMessage', () => {
  const createValidMessage = (overrides: Partial<MudVaultMessage> = {}): any => ({
    version: '1.0',
    id: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: '2025-01-26T12:34:56.789Z',
    type: 'tell',
    from: { mud: 'TestMUD' },
    to: { mud: 'TargetMUD' },
    payload: { message: 'Hello world' },
    metadata: {
      priority: 5,
      ttl: 300,
      encoding: 'utf-8',
      language: 'en'
    },
    ...overrides
  });

  describe('valid messages', () => {
    test('should validate a correct tell message', () => {
      const message = createValidMessage();
      const result = validateMessage(message);
      
      expect(result.error).toBeUndefined();
      expect(result.value).toBeDefined();
      expect(result.value?.type).toBe('tell');
    });

    test('should validate a channel message', () => {
      const message = createValidMessage({
        type: 'channel',
        to: { mud: '*', channel: 'ooc' },
        payload: {
          channel: 'ooc',
          message: 'Hello channel',
          action: 'message'
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toBeUndefined();
    });

    test('should validate a who request', () => {
      const message = createValidMessage({
        type: 'who',
        to: { mud: 'Gateway' },
        payload: {
          request: true,
          sort: 'alpha',
          format: 'long'
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toBeUndefined();
    });

    test('should validate ping message', () => {
      const message = createValidMessage({
        type: 'ping',
        to: { mud: 'Gateway' },
        payload: {
          timestamp: 1706271296789
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toBeUndefined();
    });
  });

  describe('invalid messages', () => {
    test('should reject message without version', () => {
      const message = createValidMessage();
      delete message.version;
      
      const result = validateMessage(message);
      expect(result.error).toContain('version');
    });

    test('should reject message with invalid version', () => {
      const message = createValidMessage({ version: '2.0' });
      
      const result = validateMessage(message);
      expect(result.error).toContain('version');
    });

    test('should reject message without ID', () => {
      const message = createValidMessage();
      delete message.id;
      
      const result = validateMessage(message);
      expect(result.error).toContain('id');
    });

    test('should reject message with invalid UUID', () => {
      const message = createValidMessage({ id: 'not-a-uuid' });
      
      const result = validateMessage(message);
      expect(result.error).toContain('id');
    });

    test('should reject message with invalid timestamp', () => {
      const message = createValidMessage({ timestamp: 'not-iso-date' });
      
      const result = validateMessage(message);
      expect(result.error).toContain('timestamp');
    });

    test('should reject message with unknown type', () => {
      const message = createValidMessage({ type: 'unknown' });
      
      const result = validateMessage(message);
      expect(result.error).toContain('type');
    });

    test('should reject message without from field', () => {
      const message = createValidMessage();
      delete message.from;
      
      const result = validateMessage(message);
      expect(result.error).toContain('from');
    });

    test('should reject message without to field', () => {
      const message = createValidMessage();
      delete message.to;
      
      const result = validateMessage(message);
      expect(result.error).toContain('to');
    });

    test('should reject tell message without message in payload', () => {
      const message = createValidMessage({
        payload: {}
      });
      
      const result = validateMessage(message);
      expect(result.error).toContain('message');
    });

    test('should reject message with invalid priority', () => {
      const message = createValidMessage({
        metadata: {
          priority: 15, // Too high
          ttl: 300,
          encoding: 'utf-8',
          language: 'en'
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toContain('priority');
    });
  });

  describe('payload validation', () => {
    test('should validate channel payload', () => {
      const message = createValidMessage({
        type: 'channel',
        payload: {
          channel: 'ooc',
          message: 'Hello',
          action: 'message'
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toBeUndefined();
    });

    test('should reject channel payload without channel', () => {
      const message = createValidMessage({
        type: 'channel',
        payload: {
          message: 'Hello',
          action: 'message'
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toContain('channel');
    });

    test('should validate emote payload', () => {
      const message = createValidMessage({
        type: 'emote',
        payload: {
          action: 'waves hello'
        }
      });
      
      const result = validateMessage(message);
      expect(result.error).toBeUndefined();
    });

    test('should reject emote payload without action', () => {
      const message = createValidMessage({
        type: 'emote',
        payload: {}
      });
      
      const result = validateMessage(message);
      expect(result.error).toContain('action');
    });
  });
});

describe('validateMudName', () => {
  test('should accept valid MUD names', () => {
    expect(validateMudName('TestMUD')).toBe(true);
    expect(validateMudName('Dark-Wizardry')).toBe(true);
    expect(validateMudName('MUD_123')).toBe(true);
    expect(validateMudName('a')).toBe(false); // Too short
    expect(validateMudName('ab')).toBe(false); // Too short
    expect(validateMudName('abc')).toBe(true); // Minimum length
  });

  test('should reject invalid MUD names', () => {
    expect(validateMudName('Invalid MUD')).toBe(false); // Spaces
    expect(validateMudName('MUD@123')).toBe(false); // Special chars
    expect(validateMudName('MUD#Test')).toBe(false); // Hash
    expect(validateMudName('MUD.Test')).toBe(false); // Dot
    expect(validateMudName('')).toBe(false); // Empty
    expect(validateMudName('a'.repeat(33))).toBe(false); // Too long
  });
});

describe('normalizeMudName', () => {
  test('should normalize MUD names correctly', () => {
    expect(normalizeMudName('Test MUD')).toBe('Test-MUD');
    expect(normalizeMudName('Dark  Wizardry')).toBe('Dark-Wizardry');
    expect(normalizeMudName('MUD@#$Test')).toBe('MUDTest');
    expect(normalizeMudName('  MUD  Test  ')).toBe('MUD-Test');
    expect(normalizeMudName('MUD---Test')).toBe('MUD-Test');
  });

  test('should handle edge cases', () => {
    expect(normalizeMudName('')).toBe('');
    expect(normalizeMudName('   ')).toBe('');
    expect(normalizeMudName('a'.repeat(40))).toBe('a'.repeat(32));
    expect(normalizeMudName('---test---')).toBe('test');
  });
});