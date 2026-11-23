import { randomUUID } from 'crypto';
import { fastValidate } from '../../src/utils/fastValidate';
import { validateMessageStrict } from '../../src/utils/validation';

// Small deterministic generator, so a failure always reproduces.
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number) => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x % n;
  };
}

const base = (type: string, payload: unknown) => ({
  version: '1.0',
  id: randomUUID(),
  timestamp: new Date().toISOString(),
  type,
  from: { mud: 'alpha', user: 'alice', displayName: 'Alice' },
  to: type === 'channel' ? { mud: '*', channel: 'ooc' } : { mud: 'beta', user: 'bob' },
  payload,
  metadata: { priority: 5, ttl: 300, encoding: 'utf-8', language: 'en' }
});

const seeds = [
  () => base('tell', { message: 'hello' }),
  () => base('channel', { channel: 'ooc', message: 'hi there', action: 'message' }),
  () => base('ping', { timestamp: 1700000000000 })
];

const odd: unknown[] = [
  '', ' ', 'x', 'a'.repeat(33), 'a'.repeat(4097), 0, -1, 1, 5, 10, 11, 3600, 3601, 1.5, 1e21,
  Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 2, true, false, null, [], {}, { a: 1 }, '5', 'true',
  '1.0', '2.0', 'message', 'join', 'bad channel', 'ch@n', 'é', '\u0000',
  '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF',
  'ffffffff-ffff-6fff-8fff-ffffffffffff', 'ffffffff-ffff-4fff-cfff-ffffffffffff', 'ffffffffffff4fff8fffffffffffffff',
  '2026-11-23T08:00:00.000Z', '2026-02-29T08:00:00.000Z', '2024-02-29T08:00:00.000Z', '2026-13-01T08:00:00.000Z',
  '2026-11-31T08:00:00.000Z', '2026-11-23T24:00:00.000Z', '2026-11-23T08:60:00.000Z', '2026-11-23T08:00:60.000Z',
  '2026-11-23T08:00:00Z', '2026-11-23', '1969-12-31T23:59:59.999Z', '0000-01-01T00:00:00.000Z'
];

const paths = [
  ['version'], ['id'], ['timestamp'], ['type'], ['from'], ['to'], ['payload'], ['metadata'], ['extra'],
  ['from', 'mud'], ['from', 'user'], ['from', 'displayName'], ['from', 'channel'], ['from', 'extra'],
  ['to', 'mud'], ['to', 'user'], ['to', 'channel'], ['to', 'extra'],
  ['payload', 'message'], ['payload', 'channel'], ['payload', 'action'], ['payload', 'timestamp'], ['payload', 'formatted'], ['payload', 'extra'],
  ['metadata', 'priority'], ['metadata', 'ttl'], ['metadata', 'encoding'], ['metadata', 'language'], ['metadata', 'retry'], ['metadata', 'extra']
];

function mutate(root: any, path: string[], value: unknown, remove: boolean) {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    node = node?.[path[i]];
    if (typeof node !== 'object' || node === null) {
      return;
    }
  }
  const key = path[path.length - 1];
  if (remove) {
    delete node[key];
  } else {
    node[key] = value;
  }
}

describe('fast message validator', () => {
  test.each(seeds.map((make, i) => [i, make]))('accepts common message %i exactly as Joi does', (_i, make) => {
    const message = (make as () => any)();
    expect(fastValidate(JSON.parse(JSON.stringify(message)))).not.toBeNull();
    expect(validateMessageStrict(JSON.parse(JSON.stringify(message))).value).toEqual(message);
  });

  test('never accepts what Joi rejects, and never changes the value', () => {
    const next = rng(0x5eed);
    let accepted = 0;
    for (let round = 0; round < 40000; round++) {
      const message: any = JSON.parse(JSON.stringify(seeds[next(seeds.length)]()));
      const edits = 1 + next(3);
      for (let e = 0; e < edits; e++) {
        mutate(message, paths[next(paths.length)], odd[next(odd.length)], next(5) === 0);
      }
      const snapshot = JSON.stringify(message);
      if (fastValidate(message)) {
        accepted++;
        const strict = validateMessageStrict(JSON.parse(snapshot));
        if (strict.error || JSON.stringify(strict.value) !== snapshot) {
          throw new Error(`fast path disagreed with Joi on ${snapshot}: ${strict.error}`);
        }
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });

  test('sends anything unusual to Joi', () => {
    const withExtra: any = base('tell', { message: 'x' });
    withExtra.signature = 'abc';
    expect(fastValidate(withExtra)).toBeNull();
    expect(fastValidate(base('who', { request: true }))).toBeNull();
    expect(fastValidate(null)).toBeNull();
    expect(fastValidate([])).toBeNull();
  });
});
