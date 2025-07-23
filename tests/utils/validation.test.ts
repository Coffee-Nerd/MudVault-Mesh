import { validateMessage } from '../../src/utils/validation';
import { MudVaultMessage } from '../../src/types';

describe('Message Validation', () => {
  const validMessage: MudVaultMessage = {
    version: '1.0',
    id: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: new Date().toISOString(),
    type: 'tell',
    from: { mud: 'TestMUD', user: 'testuser' },
    to: { mud: 'TargetMUD', user: 'targetuser' },
    payload: { message: 'Hello world' },
    metadata: {
      priority: 5,
      ttl: 300,
      encoding: 'utf-8',
      language: 'en'
    }
  };

  test('should validate a correct message', () => {
    const result = validateMessage(validMessage);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(validMessage);
  });

  test('should reject message without version', () => {
    const invalidMessage = { ...validMessage };
    delete (invalidMessage as any).version;
    
    const result = validateMessage(invalidMessage);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('version');
  });

  test('should reject message with invalid UUID', () => {
    const invalidMessage = { ...validMessage, id: 'invalid-uuid' };
    
    const result = validateMessage(invalidMessage);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('id');
  });

  test('should reject message with invalid timestamp', () => {
    const invalidMessage = { ...validMessage, timestamp: 'invalid-date' };
    
    const result = validateMessage(invalidMessage);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('timestamp');
  });

  test('should reject message with invalid type', () => {
    const invalidMessage = { ...validMessage, type: 'invalid-type' as any };
    
    const result = validateMessage(invalidMessage);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('type');
  });

  test('should reject message without from field', () => {
    const invalidMessage = { ...validMessage };
    delete (invalidMessage as any).from;
    
    const result = validateMessage(invalidMessage);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('from');
  });

  test('should reject message without to field', () => {
    const invalidMessage = { ...validMessage };
    delete (invalidMessage as any).to;
    
    const result = validateMessage(invalidMessage);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('to');
  });

  test('should validate channel message', () => {
    const channelMessage: MudVaultMessage = {
      ...validMessage,
      type: 'channel',
      to: { mud: '*', channel: 'gossip' },
      payload: {
        channel: 'gossip',
        message: 'Hello channel!',
        action: 'message'
      }
    };
    
    const result = validateMessage(channelMessage);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(channelMessage);
  });

  test('should validate who request message', () => {
    const whoMessage: MudVaultMessage = {
      ...validMessage,
      type: 'who',
      to: { mud: 'TargetMUD' },
      payload: { request: true }
    };
    
    const result = validateMessage(whoMessage);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(whoMessage);
  });

  test('should validate auth message', () => {
    const authMessage: MudVaultMessage = {
      ...validMessage,
      type: 'auth',
      to: { mud: 'Gateway' },
      payload: {
        mudName: 'TestMUD',
        token: 'api-key-123'
      }
    };
    
    const result = validateMessage(authMessage);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(authMessage);
  });

  test('should validate ping message', () => {
    const pingMessage: MudVaultMessage = {
      ...validMessage,
      type: 'ping',
      to: { mud: 'Gateway' },
      payload: { timestamp: Date.now() }
    };
    
    const result = validateMessage(pingMessage);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(pingMessage);
  });

  test('should validate error message', () => {
    const errorMessage: MudVaultMessage = {
      ...validMessage,
      type: 'error',
      from: { mud: 'Gateway' },
      payload: {
        code: 1001,
        message: 'Authentication failed',
        details: { reason: 'Invalid API key' }
      }
    };
    
    const result = validateMessage(errorMessage);
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(errorMessage);
  });
});