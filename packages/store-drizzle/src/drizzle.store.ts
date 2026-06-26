import type {
  Admission,
  BreakerConfig,
  CircuitSnapshot,
  CircuitState,
  CircuitStatus,
  Clock,
  ResilienceStore,
} from '@dudousxd/nestjs-resilience';
import {
  INITIAL_CIRCUIT_STATE,
  computeAdmit,
  computeRecord,
  systemClock,
} from '@dudousxd/nestjs-resilience';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { circuits, type resilienceSchema } from './schema';

export interface DrizzleResilienceStoreOptions {
  clock?: Clock;
}

type DB = BetterSQLite3Database<typeof resilienceSchema>;

export class DrizzleResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(
    private readonly db: DB,
    opts: DrizzleResilienceStoreOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
  }

  private load(key: string): CircuitState {
    const row = this.db.select().from(circuits).where(eq(circuits.key, key)).get();
    if (!row) return { ...INITIAL_CIRCUIT_STATE };
    return {
      status: row.status as CircuitStatus,
      failures: row.failures,
      openUntil: row.openUntil,
      probes: row.probes,
    };
  }

  private persist(key: string, s: CircuitState): void {
    this.db
      .insert(circuits)
      .values({
        key,
        status: s.status,
        failures: s.failures,
        openUntil: s.openUntil,
        probes: s.probes,
      })
      .onConflictDoUpdate({
        target: circuits.key,
        set: { status: s.status, failures: s.failures, openUntil: s.openUntil, probes: s.probes },
      })
      .run();
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    // better-sqlite3 is synchronous: this transaction runs to completion atomically.
    return this.db.transaction((): Admission => {
      const { state, admission } = computeAdmit(this.load(key), cfg, this.clock.now());
      this.persist(key, state);
      return admission;
    });
  }

  async record(
    key: string,
    cfg: BreakerConfig,
    ok: boolean,
    probe: boolean,
  ): Promise<CircuitStatus> {
    return this.db.transaction((): CircuitStatus => {
      const { state, status } = computeRecord(this.load(key), cfg, ok, probe, this.clock.now());
      this.persist(key, state);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const s = this.load(key);
    return {
      status: s.status,
      failures: s.failures,
      ...(s.openUntil ? { openUntil: s.openUntil } : {}),
    };
  }
}
