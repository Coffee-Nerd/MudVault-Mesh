import net from 'net';
import logger from '../utils/logger';
import redisService from './redis';
import { normalizeMudName } from '../utils/validation';

export type BanType = 'ip' | 'mud';

export interface Ban {
  type: BanType;
  value: string;
  reason: string;
  by: string;
  created: string;
  expires: string | null;
}

export interface AuditEntry {
  at: string;
  action: string;
  by: string;
  source: string;
  detail: Record<string, unknown>;
}

const BANS_KEY = 'bans:v1';
const AUDIT_KEY = 'audit:v1';
const AUDIT_CAP = 5000;

/** Returns the canonical form of an IP or CIDR, or null if it is invalid. */
export function parseIpRule(value: string): { address: string; prefix: number | null; family: 'ipv4' | 'ipv6' } | null {
  const [rawAddress, rawPrefix, extra] = value.trim().split('/');
  if (extra !== undefined) {
    return null;
  }
  const address = rawAddress.toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  const version = net.isIP(address);
  if (version === 0) {
    return null;
  }
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (rawPrefix === undefined) {
    return { address, prefix: null, family };
  }
  if (!/^\d{1,3}$/.test(rawPrefix)) {
    return null;
  }
  const prefix = Number(rawPrefix);
  // Refuse rules so wide they would lock out most of the internet by mistake.
  const narrowest = version === 4 ? 32 : 128;
  const widest = version === 4 ? 8 : 32;
  return prefix >= widest && prefix <= narrowest ? { address, prefix, family } : null;
}

export class BanService {
  private bans: Map<string, Ban> = new Map();
  private mudBans: Set<string> = new Set();
  private ipRules: net.BlockList = new net.BlockList();
  private nextExpiry = Infinity;

  async load(): Promise<void> {
    const stored = await redisService.get(BANS_KEY);
    this.bans.clear();
    if (stored) {
      for (const ban of JSON.parse(stored) as Ban[]) {
        this.bans.set(`${ban.type}:${ban.value}`, ban);
      }
    }
    this.rebuild();
    logger.info(`Loaded ${this.bans.size} bans`);
  }

  /** Bans are read on every login, so lookups are compiled and changes pay the cost. */
  private rebuild(now = Date.now()): void {
    const rules = new net.BlockList();
    const muds = new Set<string>();
    let nextExpiry = Infinity;
    for (const [key, ban] of this.bans) {
      const expires = ban.expires ? Date.parse(ban.expires) : Infinity;
      if (expires <= now) {
        this.bans.delete(key);
        continue;
      }
      nextExpiry = Math.min(nextExpiry, expires);
      if (ban.type === 'mud') {
        muds.add(ban.value);
        continue;
      }
      const rule = parseIpRule(ban.value);
      if (rule?.prefix === null) {
        rules.addAddress(rule.address, rule.family);
      } else if (rule) {
        rules.addSubnet(rule.address, rule.prefix as number, rule.family);
      }
    }
    this.ipRules = rules;
    this.mudBans = muds;
    this.nextExpiry = nextExpiry;
  }

  private refresh(): void {
    const now = Date.now();
    if (now >= this.nextExpiry) {
      this.rebuild(now);
    }
  }

  isIpBanned(ip: string): boolean {
    this.refresh();
    if (this.bans.size === 0) {
      return false;
    }
    const address = ip.replace(/^::ffff:(?=\d+\.)/, '');
    const version = net.isIP(address);
    return version !== 0 && this.ipRules.check(address, version === 4 ? 'ipv4' : 'ipv6');
  }

  isMudBanned(name: string): boolean {
    this.refresh();
    return this.mudBans.has(normalizeMudName(name));
  }

  canonicalValue(type: BanType, value: string): string | null {
    if (type === 'mud') {
      const name = normalizeMudName(value);
      return name.length >= 3 ? name : null;
    }
    const rule = parseIpRule(value);
    if (!rule) {
      return null;
    }
    return rule.prefix === null ? rule.address : `${rule.address}/${rule.prefix}`;
  }

  list(): Ban[] {
    this.refresh();
    return Array.from(this.bans.values());
  }

  /** Applies immediately in memory. Returns false if it could not be saved. */
  private async persist(): Promise<boolean> {
    try {
      await redisService.set(BANS_KEY, JSON.stringify(Array.from(this.bans.values())));
      return true;
    } catch {
      logger.error('Ban change applied in memory but could not be saved to Redis');
      return false;
    }
  }

  async add(type: BanType, value: string, reason: string, by: string, source: string, minutes?: number): Promise<{ ban: Ban; saved: boolean }> {
    const now = new Date();
    const ban: Ban = {
      type,
      value,
      reason,
      by,
      created: now.toISOString(),
      expires: minutes ? new Date(now.getTime() + minutes * 60000).toISOString() : null
    };
    this.bans.set(`${type}:${value}`, ban);
    this.rebuild();
    const saved = await this.persist();
    await this.audit('ban.add', by, source, { type, value, reason, expires: ban.expires });
    return { ban, saved };
  }

  async remove(type: BanType, value: string, by: string, source: string): Promise<{ removed: boolean; saved: boolean }> {
    const removed = this.bans.delete(`${type}:${value}`);
    if (!removed) {
      return { removed, saved: true };
    }
    this.rebuild();
    const saved = await this.persist();
    await this.audit('ban.remove', by, source, { type, value });
    return { removed, saved };
  }

  async audit(action: string, by: string, source: string, detail: Record<string, unknown>): Promise<void> {
    const entry: AuditEntry = { at: new Date().toISOString(), action, by, source, detail };
    logger.warn(`AUDIT ${action}`, { by, source, ...detail });
    try {
      await redisService.pushCapped(AUDIT_KEY, [JSON.stringify(entry)], AUDIT_CAP);
    } catch {
      logger.error('Audit entry could not be saved to Redis');
    }
  }

  async auditLog(limit: number): Promise<AuditEntry[]> {
    const rows = await redisService.lrange(AUDIT_KEY, 0, limit - 1);
    return rows.map(row => JSON.parse(row) as AuditEntry);
  }
}

export default new BanService();
