import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus, Clock, ResilienceStore } from '@dudousxd/nestjs-resilience';
import { computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import { CIRCUITS_DDL, INSERT_INITIAL, SELECT_FOR_UPDATE, SELECT_PLAIN, UPDATE_STATE, rowToState } from './sql';

/** Structural subset of PrismaClient the adapter needs (avoids importing a generated client type). */
export interface PrismaLike {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<R>(fn: (tx: PrismaLike) => Promise<R>): Promise<R>;
}

export interface PrismaResilienceStoreOptions { clock?: Clock }

export class PrismaResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly prisma: PrismaLike, opts: PrismaResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async ensureSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(CIRCUITS_DDL);
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    return this.prisma.$transaction(async (tx): Promise<Admission> => {
      await tx.$executeRawUnsafe(INSERT_INITIAL, key);
      const rows = await tx.$queryRawUnsafe<unknown[]>(SELECT_FOR_UPDATE, key);
      const { state, admission } = computeAdmit(rowToState(rows[0] as never), cfg, this.clock.now());
      await tx.$executeRawUnsafe(UPDATE_STATE, state.status, state.failures, state.openUntil, state.probes, key);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    return this.prisma.$transaction(async (tx): Promise<CircuitStatus> => {
      await tx.$executeRawUnsafe(INSERT_INITIAL, key);
      const rows = await tx.$queryRawUnsafe<unknown[]>(SELECT_FOR_UPDATE, key);
      const { state, status } = computeRecord(rowToState(rows[0] as never), cfg, ok, probe, this.clock.now());
      await tx.$executeRawUnsafe(UPDATE_STATE, state.status, state.failures, state.openUntil, state.probes, key);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(SELECT_PLAIN, key);
    const s = rowToState(rows[0] as never);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
