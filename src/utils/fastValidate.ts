import { MudVaultMessage } from '../types';

/**
 * Fast path for the envelopes MUDs actually send. It only ever accepts a strict
 * subset of what the Joi schema accepts, and returns null for anything else so
 * Joi stays the single authority on errors and unusual messages.
 * tests/unit/fastValidate.test.ts checks that subset property by fuzzing.
 */

const HEX = new Uint8Array(256);
for (const c of '0123456789abcdefABCDEF') {
  HEX[c.charCodeAt(0)] = 1;
}
const NAME = new Uint8Array(256);
for (const c of '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_') {
  NAME[c.charCodeAt(0)] = 1;
}
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isUuid(s: unknown): boolean {
  if (typeof s !== 'string' || s.length !== 36) {
    return false;
  }
  for (let i = 0; i < 36; i++) {
    const c = s.charCodeAt(i);
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (c !== 45) {
        return false;
      }
    } else if (c > 255 || HEX[c] === 0) {
      return false;
    }
  }
  const version = s.charCodeAt(14) - 48;
  const variant = s.charCodeAt(19) | 32;
  return version >= 1 && version <= 5 && (variant === 56 || variant === 57 || variant === 97 || variant === 98);
}

function digits(s: string, at: number, count: number): number {
  let n = 0;
  for (let i = at; i < at + count; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) {
      return -1;
    }
    n = n * 10 + d;
  }
  return n;
}

/** Accepts only the exact YYYY-MM-DDTHH:mm:ss.sssZ form, which Joi leaves unchanged. */
function isCanonicalTimestamp(s: unknown): boolean {
  if (typeof s !== 'string' || s.length !== 24 || s[4] !== '-' || s[7] !== '-' || s[10] !== 'T' ||
      s[13] !== ':' || s[16] !== ':' || s[19] !== '.' || s[23] !== 'Z') {
    return false;
  }
  const year = digits(s, 0, 4);
  const month = digits(s, 5, 2);
  const day = digits(s, 8, 2);
  if (year < 1970 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (day > DAYS[month - 1] + (leap ? 1 : 0)) {
    return false;
  }
  const hour = digits(s, 11, 2);
  const minute = digits(s, 14, 2);
  const second = digits(s, 17, 2);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60 && digits(s, 20, 3) >= 0;
}

function isChannelName(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > 32) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 255 || NAME[c] === 0) {
      return false;
    }
  }
  return true;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isEndpoint(v: unknown): boolean {
  if (!isObject(v) || !isText(v.mud)) {
    return false;
  }
  for (const key in v) {
    if (key === 'mud') {
      continue;
    }
    if (key === 'user' || key === 'displayName') {
      if (!isText(v[key])) {
        return false;
      }
    } else if (key !== 'channel' || !isChannelName(v.channel)) {
      return false;
    }
  }
  return true;
}

function isMetadata(v: unknown): boolean {
  if (!isObject(v) || Object.keys(v).length !== 4) {
    return false;
  }
  const { priority, ttl, encoding, language } = v;
  return Number.isInteger(priority) && (priority as number) >= 1 && (priority as number) <= 10 &&
    Number.isInteger(ttl) && (ttl as number) >= 1 && (ttl as number) <= 3600 &&
    isText(encoding) && isText(language);
}

function isPayload(type: unknown, p: unknown): boolean {
  if (!isObject(p)) {
    return false;
  }
  const fields = Object.keys(p).length;
  switch (type) {
    case 'tell':
      return fields === 1 && typeof p.message === 'string' && p.message.length <= 4096;
    case 'channel':
      return fields === 3 && isChannelName(p.channel) && typeof p.message === 'string' &&
        p.message.length <= 4096 && p.action === 'message';
    case 'ping':
      return fields === 1 && Number.isSafeInteger(p.timestamp);
    default:
      return false;
  }
}

export function fastValidate(m: any): MudVaultMessage | null {
  if (!isObject(m) || Object.keys(m).length !== 8 || m.version !== '1.0') {
    return null;
  }
  return isPayload(m.type, m.payload) && isUuid(m.id) && isCanonicalTimestamp(m.timestamp) &&
    isEndpoint(m.from) && isEndpoint(m.to) && isMetadata(m.metadata)
    ? (m as unknown as MudVaultMessage)
    : null;
}
