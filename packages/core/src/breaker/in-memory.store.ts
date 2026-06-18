import { type Clock, systemClock } from '../clock';
import type { ResilienceStore } from './store';
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './types';

interface Entry {
  status: CircuitStatus;
  failures: number;
  openUntil: number;
  probes: number; // probes currently in flight (half-open)
}

export class InMemoryResilienceStore implements ResilienceStore {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly clock: Clock = systemClock) {}

  private entry(key: string): Entry {
    let e = this.map.get(key);
    if (!e) {
      e = { status: 'closed', failures: 0, openUntil: 0, probes: 0 };
      this.map.set(key, e);
    }
    return e;
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const e = this.entry(key);
    if (e.status === 'open' && this.clock.now() >= e.openUntil) {
      e.status = 'half-open';
      e.probes = 0;
    }
    if (e.status === 'closed') return { allow: true, probe: false, status: 'closed' };
    if (e.status === 'open') return { allow: false, probe: false, status: 'open' };
    // half-open: hand out up to halfOpenMax probes
    const max = cfg.halfOpenMax ?? 1;
    if (e.probes < max) {
      e.probes++;
      return { allow: true, probe: true, status: 'half-open' };
    }
    return { allow: false, probe: false, status: 'half-open' };
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    const e = this.entry(key);
    if (probe) e.probes = Math.max(0, e.probes - 1);
    if (ok) {
      e.status = 'closed';
      e.failures = 0;
      e.openUntil = 0;
      return 'closed';
    }
    // failure
    if (probe || e.status === 'half-open') {
      e.status = 'open';
      e.openUntil = this.clock.now() + cfg.cooldownMs;
      return 'open';
    }
    e.failures++;
    if (e.failures >= cfg.threshold) {
      e.status = 'open';
      e.openUntil = this.clock.now() + cfg.cooldownMs;
      return 'open';
    }
    return e.status;
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const e = this.entry(key);
    return { status: e.status, failures: e.failures, openUntil: e.openUntil || undefined };
  }
}
