import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { Gateway } from '../../src/services/gateway';
import { authService } from '../../src/middleware/auth';

const TEST_PORT = 8999;
const URL = `ws://127.0.0.1:${TEST_PORT}`;

type Message = { type: string; from: any; to: any; payload: any };

const envelope = (type: string, from: any, to: any, payload: any) => ({
  version: '1.0',
  id: uuidv4(),
  timestamp: new Date().toISOString(),
  type,
  from,
  to,
  payload,
  metadata: { priority: 5, ttl: 300, encoding: 'utf-8', language: 'en' }
});

class Client {
  private queue: Message[] = [];
  private waiters: Array<(message: Message) => void> = [];
  private closed: Promise<number>;

  constructor(readonly ws: WebSocket) {
    ws.on('message', data => {
      const message = JSON.parse(data.toString()) as Message;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        this.queue.push(message);
      }
    });
    this.closed = new Promise(resolve => ws.on('close', code => resolve(code)));
  }

  static open(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL);
      const client = new Client(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  next(): Promise<Message> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise(resolve => this.waiters.push(resolve));
  }

  whenClosed(): Promise<number> {
    return this.closed;
  }

  shut(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

describe('Gateway', () => {
  let gateway: Gateway;
  const open: Client[] = [];

  const connect = async () => {
    const client = await Client.open();
    open.push(client);
    return client;
  };

  const login = async (name: string) => {
    const client = await connect();
    client.send(envelope('auth', { mud: name }, { mud: 'Gateway' }, { mudName: name, token: authService.generateJWT(name) }));
    const reply = await client.next();
    expect(reply.type).toBe('auth');
    return { client, name: reply.payload.mudName as string };
  };

  const expectRejected = async (name: string, token?: string) => {
    const client = await connect();
    const payload = token === undefined ? { mudName: name } : { mudName: name, token };
    client.send(envelope('auth', { mud: name }, { mud: 'Gateway' }, payload));
    const reply = await client.next();
    expect(reply.type).toBe('error');
    expect(reply.payload.code).toBe(1001);
    expect(await client.whenClosed()).toBe(4401);
  };

  beforeAll(() => {
    gateway = new Gateway(TEST_PORT, { mudName: 'Bridge-Client', token: 'bridge-test-token' });
  });

  afterEach(() => {
    open.splice(0).forEach(client => client.shut());
  });

  afterAll(async () => {
    await gateway.close();
  });

  describe('login', () => {
    test('rejects a login with no token', () => expectRejected('Victim-Mud'));

    test('rejects a forged token', () => expectRejected('Victim-Mud', 'a.b.c'));

    test("rejects another MUD's token", () => expectRejected('Victim-Mud', authService.generateJWT('Attacker-Mud')));

    test('rejects a false claim to the bridge name', () => expectRejected('Bridge-Client', 'wrong'));

    test('accepts the bridge credential', async () => {
      const client = await connect();
      client.send(envelope('auth', { mud: 'Bridge-Client' }, { mud: 'Gateway' }, { mudName: 'Bridge-Client', token: 'bridge-test-token' }));
      expect((await client.next()).type).toBe('auth');
    });

    test('accepts a valid token and lowercases the name', async () => {
      const { name } = await login('Valid-Mud');
      expect(name).toBe('valid-mud');
    });

    test('closes a connection that sends data before login', async () => {
      const client = await connect();
      client.send(envelope('ping', { mud: 'Nobody' }, { mud: 'Gateway' }, { timestamp: 1 }));
      expect((await client.next()).payload.code).toBe(1002);
      expect(await client.whenClosed()).toBe(4401);
    });

    test('a newer login replaces the older connection', async () => {
      const first = await login('Same-Mud');
      const second = await login('Same-Mud');
      expect(await first.client.whenClosed()).toBe(4409);

      const sender = await login('Sender-Mud');
      sender.client.send(envelope('tell', { mud: sender.name, user: 'alice' }, { mud: second.name, user: 'bob' }, { message: 'still here' }));
      expect((await second.client.next()).payload.message).toBe('still here');
    });
  });

  describe('routing', () => {
    test('delivers a tell and stamps the verified sender', async () => {
      const a = await login('Route-A');
      const b = await login('Route-B');
      a.client.send(envelope('tell', { mud: 'spoofed-mud', user: 'alice' }, { mud: b.name, user: 'bob' }, { message: 'hello' }));
      const received = await b.client.next();
      expect(received.type).toBe('tell');
      expect(received.from.mud).toBe(a.name);
      expect(received.payload.message).toBe('hello');
    });

    test('broadcasts channels to others and not to the sender', async () => {
      const a = await login('Chan-A');
      const b = await login('Chan-B');
      a.client.send(envelope('channel', { mud: a.name, user: 'alice' }, { mud: '*', channel: 'ooc' }, { channel: 'ooc', message: 'hi', action: 'message' }));
      expect((await b.client.next()).payload.message).toBe('hi');

      a.client.send(envelope('ping', { mud: a.name }, { mud: 'Gateway' }, { timestamp: 7 }));
      expect((await a.client.next()).type).toBe('pong');
    });

    test('reports an unknown MUD', async () => {
      const a = await login('Lonely-Mud');
      a.client.send(envelope('tell', { mud: a.name }, { mud: 'No-Such-Mud', user: 'x' }, { message: 'x' }));
      expect((await a.client.next()).payload.code).toBe(1003);
    });

    test('does not expose MUD addresses in the who reply', async () => {
      const a = await login('Private-Mud');
      a.client.send(envelope('who', { mud: a.name }, { mud: 'Gateway' }, { request: true }));
      const reply = await a.client.next();
      expect(reply.type).toBe('who');
      expect(JSON.stringify(reply)).not.toContain('127.0.0.1');
    });
  });
});
