import { MudVaultClient } from '../../src/clients/nodejs';

describe('MudVaultClient - Basic Tests', () => {
  describe('constructor', () => {
    test('should create client with required options', () => {
      const client = new MudVaultClient({ mudName: 'TestMUD' });
      
      expect(client.getMudName()).toBe('TestMUD');
      expect(client.isConnected()).toBe(false);
      expect(client.isAuthenticated()).toBe(false);
    });

    test('should throw error for missing mud name', () => {
      expect(() => {
        new MudVaultClient({ mudName: '' });
      }).toThrow('MUD name is required and must be a string');
    });

    test('should throw error for non-string mud name', () => {
      expect(() => {
        new MudVaultClient({ mudName: 123 as any });
      }).toThrow('MUD name is required and must be a string');
    });

    test('should set default options correctly', () => {
      const client = new MudVaultClient({ mudName: 'TestMUD' });
      const state = client.getConnectionState();
      
      expect(state.connected).toBe(false);
      expect(state.authenticated).toBe(false);
      expect(state.reconnectAttempts).toBe(0);
    });

    test('should accept custom options', () => {
      const client = new MudVaultClient({
        mudName: 'TestMUD',
        autoReconnect: false,
        reconnectInterval: 10000,
        maxReconnectAttempts: 5,
        heartbeatInterval: 60000,
        timeout: 20000
      });
      
      expect(client.getMudName()).toBe('TestMUD');
    });
  });

  describe('public methods when disconnected', () => {
    let client: MudVaultClient;

    beforeEach(() => {
      client = new MudVaultClient({ mudName: 'TestMUD' });
    });

    test('should throw error for sendTell when not connected', () => {
      expect(() => {
        client.sendTell({ mud: 'TargetMUD', user: 'user' }, 'Hello');
      }).toThrow('Not connected to gateway');
    });

    test('should throw error for sendChannelMessage when not connected', () => {
      expect(() => {
        client.sendChannelMessage('gossip', 'Hello');
      }).toThrow('Not connected to gateway');
    });

    test('should throw error for joinChannel when not connected', () => {
      expect(() => {
        client.joinChannel('gossip');
      }).toThrow('Not connected to gateway');
    });

    test('should throw error for requestWho when not connected', () => {
      expect(() => {
        client.requestWho('TargetMUD');
      }).toThrow('Not connected to gateway');
    });
  });

  describe('event handlers', () => {
    let client: MudVaultClient;

    beforeEach(() => {
      client = new MudVaultClient({ mudName: 'TestMUD' });
    });

    test('should register event handlers', () => {
      const tellHandler = jest.fn();
      const channelHandler = jest.fn();
      
      const clientWithTell = client.onTell(tellHandler);
      const clientWithChannel = client.onChannel(channelHandler);
      
      expect(clientWithTell).toBe(client);
      expect(clientWithChannel).toBe(client);
    });

    test('should register all event handler types', () => {
      const handlers = {
        tell: jest.fn(),
        channel: jest.fn(),
        who: jest.fn(),
        finger: jest.fn(),
        locate: jest.fn(),
        emote: jest.fn(),
        emoteto: jest.fn()
      };

      client.onTell(handlers.tell);
      client.onChannel(handlers.channel);
      client.onWho(handlers.who);
      client.onFinger(handlers.finger);
      client.onLocate(handlers.locate);
      client.onEmote(handlers.emote);
      client.onEmoteTo(handlers.emoteto);

      // If we get here without errors, all handlers registered successfully
      expect(true).toBe(true);
    });
  });

  describe('disconnect', () => {
    test('should handle disconnect when not connected', () => {
      const client = new MudVaultClient({ mudName: 'TestMUD' });
      
      // Should not throw error
      client.disconnect();
      
      expect(client.isConnected()).toBe(false);
      expect(client.isAuthenticated()).toBe(false);
    });
  });
});