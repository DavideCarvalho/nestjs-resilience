import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus, Clock, ResilienceStore } from '@dudousxd/nestjs-resilience';
import { computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import type { MikroORM } from '@mikro-orm/core';
import { CIRCUITS_DDL, INSERT_INITIAL, SELECT_FOR_UPDATE, SELECT_PLAIN, UPDATE_STATE, rowToState } from './sql';

export interface MikroOrmResilienceStoreOptions { clock?: Clock }

export class MikroOrmResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly orm: MikroORM, opts: MikroOrmResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async ensureSchema(): Promise<void> {
    await this.orm.em.getConnection().execute(CIRCUITS_DDL);
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const em = this.orm.em.fork();
    return em.transactional(async (tx): Promise<Admission> => {
      const conn = tx.getConnection('write');
      const ctx = tx.getTransactionContext();
      if (!ctx) {
        throw new Error(
          'MikroOrmResilienceStore requires DB transactions for atomic circuit updates; do not set disableTransactions on the MikroORM instance.',
        );
      }
      await conn.execute(INSERT_INITIAL, [key], 'run', ctx);
      const rows = (await conn.execute(SELECT_FOR_UPDATE, [key], 'all', ctx)) as unknown[];
      const { state, admission } = computeAdmit(rowToState(rows[0] as Record<string, unknown> | undefined), cfg, this.clock.now());
      await conn.execute(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key], 'run', ctx);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    const em = this.orm.em.fork();
    return em.transactional(async (tx): Promise<CircuitStatus> => {
      const conn = tx.getConnection('write');
      const ctx = tx.getTransactionContext();
      if (!ctx) {
        throw new Error(
          'MikroOrmResilienceStore requires DB transactions for atomic circuit updates; do not set disableTransactions on the MikroORM instance.',
        );
      }
      await conn.execute(INSERT_INITIAL, [key], 'run', ctx);
      const rows = (await conn.execute(SELECT_FOR_UPDATE, [key], 'all', ctx)) as unknown[];
      const { state, status } = computeRecord(rowToState(rows[0] as Record<string, unknown> | undefined), cfg, ok, probe, this.clock.now());
      await conn.execute(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key], 'run', ctx);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const rows = (await this.orm.em.getConnection().execute(SELECT_PLAIN, [key], 'all')) as unknown[];
    const s = rowToState(rows[0] as Record<string, unknown> | undefined);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
