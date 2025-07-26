import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { Gateway } from '../../src/services/gateway';
import redisService from '../../src/services/redis';

describe('Gateway Integration Tests', () => {
  let gateway: Gateway;
  let wsClient1: WebSocket;
  let wsClient2: WebSocket;
  const TEST_PORT = 8999;
  const TEST_MUD_1 = 'TestMUD-1';
  const TEST_MUD_2 = 'TestMUD-2';

  beforeAll(async () => {
    // Start gateway
    gateway = new Gateway();
    await gateway.start(TEST_PORT);
    
    // Connect to Redis
    await redisService.connect();
  });

  afterAll(async () => {
    // Close connections
    if (wsClient1?.readyState === WebSocket.OPEN) {
      wsClient1.close();
    }
    if (wsClient2?.readyState === WebSocket.OPEN) {
      wsClient2.close();
    }
    
    // Stop gateway
    gateway.stop();
    
    // Disconnect Redis
    await redisService.disconnect();
  });

  beforeEach(() => {
    // Create fresh WebSocket clients
    wsClient1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    wsClient2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
  });

  afterEach(() => {
    // Clean up clients
    if (wsClient1?.readyState === WebSocket.OPEN) {
      wsClient1.close();
    }
    if (wsClient2?.readyState === WebSocket.OPEN) {
      wsClient2.close();
    }
  });

  const createMessage = (type: string, from: any, to: any, payload: any, metadata: any = {}) => {
    return {
      version: '1.0',
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type,
      from,
      to,
      payload,
      metadata: {
        priority: metadata.priority || 5,
        ttl: metadata.ttl || 300,
        encoding: 'utf-8',
        language: 'en',
        ...metadata
      }
    };
  };

  const waitForMessage = (ws: WebSocket): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for message'));
      }, 5000);

      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (error) {
          reject(error);
        }
      });
    });
  };

  const authenticate = async (ws: WebSocket, mudName: string): Promise<boolean> => {
    const authMessage = createMessage(
      'auth',
      { mud: mudName },
      { mud: 'Gateway' },
      { mudName },
      { priority: 10 }
    );

    ws.send(JSON.stringify(authMessage));
    const response = await waitForMessage(ws);
    
    return response.type === 'auth' && response.payload.response?.includes('successful');
  };

  test('should handle authentication correctly', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    
    const authMessage = createMessage(
      'auth',
      { mud: TEST_MUD_1 },
      { mud: 'Gateway' },
      { mudName: TEST_MUD_1 },
      { priority: 10 }
    );

    wsClient1.send(JSON.stringify(authMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('auth');
    expect(response.payload.response).toContain('successful');
  });

  test('should reject invalid MUD names with spaces', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    
    const authMessage = createMessage(
      'auth',
      { mud: 'Invalid MUD Name' },
      { mud: 'Gateway' },
      { mudName: 'Invalid MUD Name' },
      { priority: 10 }
    );

    wsClient1.send(JSON.stringify(authMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('error');
    expect(response.payload.code).toBe(1001);
    expect(response.payload.message).toContain('space');
  });

  test('should handle ping/pong correctly', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    await authenticate(wsClient1, TEST_MUD_1);

    const pingMessage = createMessage(
      'ping',
      { mud: TEST_MUD_1 },
      { mud: 'Gateway' },
      { timestamp: Date.now() },
      { priority: 1, ttl: 60 }
    );

    wsClient1.send(JSON.stringify(pingMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('pong');
    expect(response.payload.timestamp).toBe(pingMessage.payload.timestamp);
  });

  test('should route tell messages between MUDs', async () => {
    // Connect and authenticate both clients
    await Promise.all([
      new Promise(resolve => wsClient1.on('open', resolve)),
      new Promise(resolve => wsClient2.on('open', resolve))
    ]);

    await authenticate(wsClient1, TEST_MUD_1);
    await authenticate(wsClient2, TEST_MUD_2);

    // Set up message handler for client 2
    const messagePromise = waitForMessage(wsClient2);

    // Send tell from client 1 to client 2
    const tellMessage = createMessage(
      'tell',
      { mud: TEST_MUD_1, user: 'User1' },
      { mud: TEST_MUD_2, user: 'User2' },
      { 
        message: 'Hello from integration test!',
        formatted: 'Hello from integration test!'
      }
    );

    wsClient1.send(JSON.stringify(tellMessage));
    const received = await messagePromise;

    expect(received.type).toBe('tell');
    expect(received.payload.message).toBe('Hello from integration test!');
    expect(received.from.mud).toBe(TEST_MUD_1);
    expect(received.from.user).toBe('User1');
  });

  test('should handle mudlist requests', async () => {
    // Connect and authenticate both clients
    await Promise.all([
      new Promise(resolve => wsClient1.on('open', resolve)),
      new Promise(resolve => wsClient2.on('open', resolve))
    ]);

    await authenticate(wsClient1, TEST_MUD_1);
    await authenticate(wsClient2, TEST_MUD_2);

    const mudlistMessage = createMessage(
      'mudlist',
      { mud: TEST_MUD_1 },
      { mud: 'Gateway' },
      { request: true }
    );

    wsClient1.send(JSON.stringify(mudlistMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('mudlist');
    expect(response.payload.muds).toBeInstanceOf(Array);
    expect(response.payload.muds.length).toBeGreaterThanOrEqual(2);
    
    const mudNames = response.payload.muds.map((m: any) => m.name);
    expect(mudNames).toContain(TEST_MUD_1);
    expect(mudNames).toContain(TEST_MUD_2);
  });

  test('should handle locate requests', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    await authenticate(wsClient1, TEST_MUD_1);

    const locateMessage = createMessage(
      'locate',
      { mud: TEST_MUD_1, user: 'User1' },
      { mud: 'Gateway' },
      { user: 'testuser', request: true }
    );

    wsClient1.send(JSON.stringify(locateMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('locate');
    expect(response.payload.locations).toBeInstanceOf(Array);
    expect(response.payload.user).toBe('testuser');
  });

  test('should handle finger requests', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    await authenticate(wsClient1, TEST_MUD_1);

    const fingerMessage = createMessage(
      'finger',
      { mud: TEST_MUD_1, user: 'User1' },
      { mud: 'Gateway' },
      { user: 'testuser', request: true }
    );

    wsClient1.send(JSON.stringify(fingerMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('finger');
    expect(response.payload.user).toBe('testuser');
    expect(response.payload.info).toBeDefined();
    expect(response.payload.info.idle).toBeDefined();
  });

  test('should reject invalid message types', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    await authenticate(wsClient1, TEST_MUD_1);

    const invalidMessage = createMessage(
      'invalid_type',
      { mud: TEST_MUD_1 },
      { mud: 'Gateway' },
      { test: 'data' }
    );

    wsClient1.send(JSON.stringify(invalidMessage));
    const response = await waitForMessage(wsClient1);

    expect(response.type).toBe('error');
    expect(response.payload.code).toBe(1000);
    expect(response.payload.message).toContain('must be one of');
  });

  test('should handle channel broadcast messages', async () => {
    // Connect and authenticate multiple clients
    await Promise.all([
      new Promise(resolve => wsClient1.on('open', resolve)),
      new Promise(resolve => wsClient2.on('open', resolve))
    ]);

    await authenticate(wsClient1, TEST_MUD_1);
    await authenticate(wsClient2, TEST_MUD_2);

    // Set up message handler for client 2
    const messagePromise = waitForMessage(wsClient2);

    // Send channel message from client 1
    const channelMessage = createMessage(
      'channel',
      { mud: TEST_MUD_1, user: 'User1' },
      { mud: '*', channel: 'ooc' },
      {
        channel: 'ooc',
        message: 'Hello everyone!',
        action: 'message',
        formatted: 'Hello everyone!'
      }
    );

    wsClient1.send(JSON.stringify(channelMessage));
    const received = await messagePromise;

    expect(received.type).toBe('channel');
    expect(received.payload.channel).toBe('ooc');
    expect(received.payload.message).toBe('Hello everyone!');
    expect(received.from.mud).toBe(TEST_MUD_1);
  });

  test('should handle disconnection and cleanup', async () => {
    await new Promise(resolve => wsClient1.on('open', resolve));
    await authenticate(wsClient1, TEST_MUD_1);

    // Get initial mudlist
    const mudlistBefore = createMessage(
      'mudlist',
      { mud: TEST_MUD_1 },
      { mud: 'Gateway' },
      { request: true }
    );

    wsClient1.send(JSON.stringify(mudlistBefore));
    const beforeResponse = await waitForMessage(wsClient1);
    const mudCountBefore = beforeResponse.payload.muds.length;

    // Disconnect
    wsClient1.close();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Connect new client and check mudlist
    const wsClient3 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise(resolve => wsClient3.on('open', resolve));
    await authenticate(wsClient3, 'TestMUD-3');

    const mudlistAfter = createMessage(
      'mudlist',
      { mud: 'TestMUD-3' },
      { mud: 'Gateway' },
      { request: true }
    );

    wsClient3.send(JSON.stringify(mudlistAfter));
    const afterResponse = await waitForMessage(wsClient3);
    
    // Should have one less MUD after disconnection
    expect(afterResponse.payload.muds.length).toBeLessThan(mudCountBefore);
    
    wsClient3.close();
  });
});