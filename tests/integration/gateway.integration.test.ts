import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { Gateway } from '../../src/services/gateway';
import { authService } from '../../src/middleware/auth';
import banService from '../../src/services/bans';
import channelAccess from '../../src/services/channelAccess';
import net from 'net';

const TEST_PORT = 8999;
const URL = `ws://127.0.0.1:${TEST_PORT}`;

type Message = { type: string; from: any; to: any; payload: any };

const envelope = (type: string, from: any, to: any, payload: any) => ({
  version: '1.0',
  id: randomUUID(),
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
    gateway = new Gateway(TEST_PORT, { mudName: 'Bridge-Client', token: 'bridge-test-token' }, 1000);
  });

  afterEach(async () => {
    const closing = open.splice(0);
    closing.forEach(client => client.shut());
    await Promise.all(closing.map(client => client.whenClosed()));
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

  describe('hardening', () => {
    test('survives a malformed frame on a refused connection', async () => {
      const held = await Promise.all(Array.from({ length: 10 }, () => connect()));
      const raw = net.connect(TEST_PORT, '127.0.0.1');
      await new Promise<void>(resolve => raw.once('connect', () => resolve()));
      raw.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      await new Promise(resolve => raw.once('data', resolve));
      raw.write(Buffer.from([0xff, 0xff, 0xff, 0xff]));
      await new Promise(resolve => setTimeout(resolve, 100));
      raw.destroy();
      held.forEach(client => client.shut());
      await Promise.all(held.map(client => client.whenClosed()));
      const { name } = await login('Still-Alive');
      expect(name).toBe('still-alive');
    });

    test('tells a client when its clock makes a login expire', async () => {
      const client = await connect();
      const message = envelope('auth', { mud: 'Old-Clock' }, { mud: 'Gateway' }, { mudName: 'Old-Clock', token: authService.generateJWT('Old-Clock') });
      message.timestamp = new Date(Date.now() - 3600 * 1000).toISOString();
      client.send(message);
      expect((await client.next()).payload.message).toContain('clock');
      expect(await client.whenClosed()).toBe(4401);
    });

    test('refuses forged gateway messages and broadcast tells', async () => {
      const a = await login('Forge-A');
      const b = await login('Forge-B');
      a.client.send(envelope('error', { mud: a.name }, { mud: b.name }, { code: 1, message: 'forged' }));
      expect((await a.client.next()).payload.code).toBe(1008);
      a.client.send(envelope('tell', { mud: a.name }, { mud: '*', user: 'x' }, { message: 'spam' }));
      expect((await a.client.next()).payload.code).toBe(1008);
    });

    test('keeps the channel fields consistent', async () => {
      const a = await login('Field-A');
      const b = await login('Field-B');
      a.client.send(envelope('channel', { mud: a.name, user: 'x' }, { mud: '*', channel: 'admin' }, { channel: 'ooc', message: 'hi', action: 'message' }));
      expect((await b.client.next()).to.channel).toBe('ooc');
    });

    test('a ban disconnects a live MUD and blocks its next login', async () => {
      const victim = await login('Banned-Mud');
      await banService.add('mud', 'banned-mud', 'test', 'test', 'test');
      expect(gateway.enforceBans()).toBe(1);
      expect(await victim.client.whenClosed()).toBe(4403);

      const again = await connect();
      again.send(envelope('auth', { mud: 'Banned-Mud' }, { mud: 'Gateway' }, { mudName: 'Banned-Mud', token: authService.generateJWT('Banned-Mud') }));
      expect((await again.next()).payload.message).toContain('banned');
      expect(await again.whenClosed()).toBe(4403);
      await banService.remove('mud', 'banned-mud', 'test', 'test');
    });
  });

  describe('restricted channels', () => {
    const post = (from: { client: Client; name: string }, channel: string, text: string) =>
      from.client.send(envelope('channel', { mud: from.name, user: 'x' }, { mud: '*', channel }, { channel, message: text, action: 'message' }));

    test('only listed MUDs can read or post', async () => {
      const staffA = await login('Staff-A');
      const staffB = await login('Staff-B');
      const outsider = await login('Outsider');
      await channelAccess.restrict('admin', ['staff-a', 'Staff-B'], 'test', 'test');

      post(staffA, 'ADMIN', 'staff only');
      expect((await staffB.client.next()).payload.message).toBe('staff only');

      post(outsider, 'admin', 'let me in');
      expect((await outsider.client.next()).payload.code).toBe(1002);

      // The outsider received nothing from the staff post: its next message is this public one.
      post(staffA, 'ooc', 'public');
      expect((await outsider.client.next()).payload.message).toBe('public');
    });

    test('revoking a MUD disconnects it', async () => {
      const victim = await login('Revoked-Mud');
      expect(gateway.disconnectMud('Revoked-Mud')).toBe(true);
      // Out of routing immediately, before the socket finishes closing.
      expect(gateway.getMudInfo().some(mud => mud.name === 'revoked-mud')).toBe(false);
      expect(gateway.disconnectMud('revoked-mud')).toBe(false);
      expect(await victim.client.whenClosed()).toBe(4401);
    });

    test('admin starts closed to everyone', async () => {
      const fresh = new (channelAccess.constructor as any)();
      expect(fresh.allowed('admin')?.size).toBe(0);
      expect(fresh.allowed('ooc')).toBeUndefined();
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
