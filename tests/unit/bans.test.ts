import { BanService, parseIpRule } from '../../src/services/bans';
import redisService from '../../src/services/redis';

describe('bans', () => {
  beforeEach(() => {
    jest.spyOn(redisService, 'set').mockResolvedValue();
    jest.spyOn(redisService, 'pushCapped').mockResolvedValue();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test.each([
    ['1.2.3.4', '1.2.3.4', null],
    ['::ffff:1.2.3.4', '1.2.3.4', null],
    ['10.0.0.0/8', '10.0.0.0', 8],
    ['2001:DB8::1', '2001:db8::1', null],
    ['2001:db8::/48', '2001:db8::', 48]
  ])('parses %s', (input, address, prefix) => {
    expect(parseIpRule(input)).toMatchObject({ address, prefix });
  });

  test.each(['', 'nope', '1.2.3', '1.2.3.4/33', '0.0.0.0/0', '1.2.3.4/7', '::/0', '2001:db8::/31', '1.2.3.4/8/8', '1.2.3.4/x'])(
    'refuses %s', input => expect(parseIpRule(input)).toBeNull()
  );

  test('matches addresses, subnets and IPv4-mapped forms', async () => {
    const bans = new BanService();
    await bans.add('ip', '203.0.113.7', 'spam', 'admin', 'test');
    await bans.add('ip', '198.51.100.0/24', 'spam', 'admin', 'test');
    await bans.add('ip', '2001:db8:1::/48', 'spam', 'admin', 'test');
    expect(bans.isIpBanned('203.0.113.7')).toBe(true);
    expect(bans.isIpBanned('::ffff:203.0.113.7')).toBe(true);
    expect(bans.isIpBanned('198.51.100.200')).toBe(true);
    expect(bans.isIpBanned('198.51.101.1')).toBe(false);
    expect(bans.isIpBanned('2001:db8:1:ffff::1')).toBe(true);
    expect(bans.isIpBanned('2001:db8:2::1')).toBe(false);
    expect(bans.isIpBanned('not-an-ip')).toBe(false);
  });

  test('MUD bans ignore case and removal takes effect', async () => {
    const bans = new BanService();
    await bans.add('mud', 'bad-mud', 'abuse', 'admin', 'test');
    expect(bans.isMudBanned('Bad-MUD')).toBe(true);
    await bans.remove('mud', 'bad-mud', 'admin', 'test');
    expect(bans.isMudBanned('bad-mud')).toBe(false);
  });

  test('temporary bans expire on their own', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const bans = new BanService();
    await bans.add('ip', '203.0.113.9', 'cooldown', 'admin', 'test', 5);
    expect(bans.isIpBanned('203.0.113.9')).toBe(true);
    jest.setSystemTime(1_000_000 + 5 * 60000);
    expect(bans.isIpBanned('203.0.113.9')).toBe(false);
    expect(bans.list()).toHaveLength(0);
  });

  test('records changes in the audit log', async () => {
    const bans = new BanService();
    await bans.add('mud', 'bad-mud', 'abuse', 'owner', '127.0.0.1');
    const entry = JSON.parse((redisService.pushCapped as jest.Mock).mock.lastCall[1][0]);
    expect(entry).toMatchObject({ action: 'ban.add', by: 'owner', detail: { type: 'mud', value: 'bad-mud', reason: 'abuse' } });
  });
});
