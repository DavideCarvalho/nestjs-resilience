import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './types';

export interface ResilienceStore {
  /** Decide whether a call may proceed; atomically flip open→half-open after cooldown and hand the
   *  probe slot to one caller. */
  admit(key: string, cfg: BreakerConfig): Promise<Admission>;
  /** Record an outcome; atomically update counters/state and return the resulting status. */
  record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus>;
  /** Read-only snapshot. */
  snapshot(key: string): Promise<CircuitSnapshot>;
}
