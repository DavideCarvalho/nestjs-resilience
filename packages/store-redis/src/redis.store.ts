import type {
  Admission,
  BreakerConfig,
  CircuitSnapshot,
  CircuitStatus,
  Clock,
  ResilienceStore,
} from '@dudousxd/nestjs-resilience';
import { systemClock } from '@dudousxd/nestjs-resilience';
import type { Redis } from 'ioredis';
import { ADMIT_LUA, RECORD_LUA } from './lua';

export interface RedisResilienceStoreOptions {
  clock?: Clock;
  keyPrefix?: string;
  /**
   * Skip the `record` round-trip for a success when this store's latest `admit` for the key saw a
   * clean circuit (closed, no failures) and this store has not recorded a failure for the key since.
   * Such a success would not change the hash, so the skip saves one script call per healthy call.
   *
   * It never skips a failure or a half-open probe outcome, and `admit` still reads Redis on every
   * call, so a circuit opened by another instance is seen on the next call. A skipped `record`
   * resolves to `'closed'`, the status its `admit` saw, not a fresh read of Redis.
   *
   * The store keeps one small entry in memory per circuit key it has seen, with no eviction; with
   * very many distinct keys, leave it off. Default `false` (every outcome is sent to Redis, as before
   * 0.3.0); set `true` to opt in.
   */
  successFastPath?: boolean;
}

/** ioredis client augmented with our two registered Lua commands. */
type WithCommands = Redis & {
  cbAdmit(key: string, now: number, max: number): Promise<[number, number, string, number?]>;
  cbRecord(
    key: string,
    ok: number,
    probe: number,
    now: number,
    threshold: number,
    cooldownMs: number,
  ): Promise<string>;
};

/** What this store last learned about a circuit, for the success fast path. */
interface LocalHealth {
  /** The newest applied `admit` saw a clean closed circuit, and no failure was recorded since. */
  clean: boolean;
  /** Sequence number of the newest `admit` whose reply was applied. */
  seen: number;
  /** Bumped before every failure is sent, so an `admit` already in flight cannot mark it clean. */
  failures: number;
}

export class RedisResilienceStore implements ResilienceStore {
  private readonly redis: WithCommands;
  private readonly clock: Clock;
  private readonly prefix: string;
  private readonly fastPath: boolean;
  private readonly health = new Map<string, LocalHealth>();
  private seq = 0;

  constructor(redis: Redis, opts: RedisResilienceStoreOptions = {}) {
    this.redis = redis as WithCommands;
    this.clock = opts.clock ?? systemClock;
    this.prefix = opts.keyPrefix ?? 'resilience:cb:';
    this.fastPath = opts.successFastPath ?? false;
    // Register the scripts once per client (idempotent: skip if already defined).
    if (typeof this.redis.cbAdmit !== 'function') {
      this.redis.defineCommand('cbAdmit', { numberOfKeys: 1, lua: ADMIT_LUA });
    }
    if (typeof this.redis.cbRecord !== 'function') {
      this.redis.defineCommand('cbRecord', { numberOfKeys: 1, lua: RECORD_LUA });
    }
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  private local(key: string): LocalHealth {
    let h = this.health.get(key);
    if (!h) {
      h = { clean: false, seen: 0, failures: 0 };
      this.health.set(key, h);
    }
    return h;
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const max = cfg.halfOpenMax ?? 1;
    const h = this.fastPath ? this.local(key) : undefined;
    const seq = ++this.seq;
    const failuresAtSend = h?.failures ?? 0;
    const [allow, probe, status, clean] = await this.redis.cbAdmit(
      this.k(key),
      this.clock.now(),
      max,
    );
    // Apply only the newest reply, and only if no failure was sent while this admit was in flight:
    // otherwise a stale "clean" read could mask a failure this store has already recorded.
    if (h && seq > h.seen && h.failures === failuresAtSend) {
      h.seen = seq;
      h.clean = clean === 1;
    }
    return { allow: allow === 1, probe: probe === 1, status: status as CircuitStatus };
  }

  async record(
    key: string,
    cfg: BreakerConfig,
    ok: boolean,
    probe: boolean,
  ): Promise<CircuitStatus> {
    if (this.fastPath) {
      const h = this.local(key);
      if (ok && !probe && h.clean) {
        // The circuit was clean at a point inside this call (its admit or a later one), and a
        // success on a clean circuit writes nothing, so the script would be a no-op there. The
        // returned status is the one admit saw; another instance may have changed it since.
        return 'closed';
      }
      if (!ok) {
        h.failures++;
        h.clean = false;
      }
    }
    const status = await this.redis.cbRecord(
      this.k(key),
      ok ? 1 : 0,
      probe ? 1 : 0,
      this.clock.now(),
      cfg.threshold,
      cfg.cooldownMs,
    );
    return status as CircuitStatus;
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const [status, failures, openUntil] = await this.redis.hmget(
      this.k(key),
      'status',
      'failures',
      'openUntil',
    );
    const ou = openUntil ? Number(openUntil) : 0;
    return {
      status: (status as CircuitStatus) ?? 'closed',
      failures: failures ? Number(failures) : 0,
      ...(ou > 0 ? { openUntil: ou } : {}),
    };
  }
}
