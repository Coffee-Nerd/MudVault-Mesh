import logger from '../utils/logger';
import redisService from './redis';
import banService from './bans';
import { normalizeMudName } from '../utils/validation';

const ACCESS_KEY = 'channel_access:v1';

// Restricted until an admin names the MUDs allowed in. Safe for a fresh gateway.
const DEFAULT_RESTRICTED = ['admin'];

/**
 * Restricted channels reach, and accept posts from, only the MUDs on their list.
 * Every other channel stays open to the whole mesh.
 */
export class ChannelAccessService {
  private rules: Map<string, Set<string>> = new Map(DEFAULT_RESTRICTED.map(name => [name, new Set<string>()]));

  async load(): Promise<void> {
    const stored = await redisService.get(ACCESS_KEY);
    if (stored) {
      const rules = JSON.parse(stored) as Record<string, string[]>;
      this.rules = new Map(Object.entries(rules).map(([name, muds]) => [name, new Set(muds)]));
    }
    logger.info(`Loaded access rules for ${this.rules.size} restricted channels`);
  }

  /** Returns the allowed MUDs, or undefined when the channel is open to everyone. */
  allowed(channel: string): ReadonlySet<string> | undefined {
    return this.rules.size === 0 ? undefined : this.rules.get(channel.toLowerCase());
  }

  list(): Record<string, string[]> {
    return Object.fromEntries(Array.from(this.rules, ([name, muds]) => [name, Array.from(muds).sort()]));
  }

  private async persist(): Promise<boolean> {
    try {
      await redisService.set(ACCESS_KEY, JSON.stringify(this.list()));
      return true;
    } catch {
      logger.error('Channel access change applied in memory but could not be saved to Redis');
      return false;
    }
  }

  async restrict(channel: string, muds: string[], by: string, source: string): Promise<{ muds: string[]; saved: boolean }> {
    const name = channel.toLowerCase();
    const allowed = new Set(muds.map(normalizeMudName).filter(mud => mud.length >= 3));
    this.rules.set(name, allowed);
    const saved = await this.persist();
    await banService.audit('channel.restrict', by, source, { channel: name, muds: Array.from(allowed) });
    return { muds: Array.from(allowed).sort(), saved };
  }

  async open(channel: string, by: string, source: string): Promise<{ removed: boolean; saved: boolean }> {
    const name = channel.toLowerCase();
    if (!this.rules.delete(name)) {
      return { removed: false, saved: true };
    }
    const saved = await this.persist();
    await banService.audit('channel.open', by, source, { channel: name });
    return { removed: true, saved };
  }
}

export default new ChannelAccessService();
