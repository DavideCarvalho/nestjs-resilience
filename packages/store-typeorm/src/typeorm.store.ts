import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus, Clock, ResilienceStore } from '@dudousxd/nestjs-resilience';
import { computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import type { DataSource } from 'typeorm';
import { CIRCUITS_DDL, INSERT_INITIAL, SELECT_FOR_UPDATE, SELECT_PLAIN, UPDATE_STATE, rowToState } from './sql';

export interface TypeOrmResilienceStoreOptions { clock?: Clock }

export class TypeOrmResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly ds: DataSource, opts: TypeOrmResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async ensureSchema(): Promise<void> {
    await this.ds.query(CIRCUITS_DDL);
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    return this.ds.transaction(async (em): Promise<Admission> => {
      await em.query(INSERT_INITIAL, [key]);
      const rows = (await em.query(SELECT_FOR_UPDATE, [key])) as unknown[];
      const { state, admission } = computeAdmit(rowToState(rows[0] as never), cfg, this.clock.now());
      await em.query(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    return this.ds.transaction(async (em): Promise<CircuitStatus> => {
      await em.query(INSERT_INITIAL, [key]);
      const rows = (await em.query(SELECT_FOR_UPDATE, [key])) as unknown[];
      const { state, status } = computeRecord(rowToState(rows[0] as never), cfg, ok, probe, this.clock.now());
      await em.query(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const rows = (await this.ds.query(SELECT_PLAIN, [key])) as unknown[];
    const s = rowToState(rows[0] as never);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
