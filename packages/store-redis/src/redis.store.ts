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
}

/** ioredis client augmented with our two registered Lua commands. */
type WithCommands = Redis & {
  cbAdmit(key: string, now: number, max: number): Promise<[number, number, string]>;
  cbRecord(
    key: string,
    ok: number,
    probe: number,
    now: number,
    threshold: number,
    cooldownMs: number,
  ): Promise<string>;
};

export class RedisResilienceStore implements ResilienceStore {
  private readonly redis: WithCommands;
  private readonly clock: Clock;
  private readonly prefix: string;

  constructor(redis: Redis, opts: RedisResilienceStoreOptions = {}) {
    this.redis = redis as WithCommands;
    this.clock = opts.clock ?? systemClock;
    this.prefix = opts.keyPrefix ?? 'resilience:cb:';
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

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const max = cfg.halfOpenMax ?? 1;
    const [allow, probe, status] = await this.redis.cbAdmit(this.k(key), this.clock.now(), max);
    return { allow: allow === 1, probe: probe === 1, status: status as CircuitStatus };
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
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
