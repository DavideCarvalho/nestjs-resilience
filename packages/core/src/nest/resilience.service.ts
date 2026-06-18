import { Inject, Injectable } from '@nestjs/common';
import type { ResilienceStore } from '../breaker/store';
import type { CircuitSnapshot } from '../breaker/types';
import { diagnosticsSink } from '../integration/diagnostics';
import { type EventSink, noopSink } from '../events';
import { type FailoverOptions, failover } from '../policies/failover';
import type { Operation, Policy } from '../policy';
import { RESILIENCE_OPTIONS, RESILIENCE_STORE } from './tokens';
import type { ResilienceModuleOptions } from './resilience.module';

@Injectable()
export class ResilienceService {
  readonly sink: EventSink;
  private readonly policies: Record<string, () => Policy>;

  constructor(
    @Inject(RESILIENCE_STORE) private readonly store: ResilienceStore,
    @Inject(RESILIENCE_OPTIONS) options: ResilienceModuleOptions,
  ) {
    this.sink = options.emit === false ? noopSink : diagnosticsSink();
    this.policies = options.policies ?? {};
  }

  execute<T>(policy: string | Policy, op: Operation<T>): Promise<T> {
    const resolved = typeof policy === 'string' ? this.resolve(policy) : policy;
    return resolved.execute(op);
  }

  failover<TTarget, R>(opts: FailoverOptions<TTarget, R>): Promise<R> {
    return failover({ onEvent: this.sink, ...opts });
  }

  circuit(key: string) {
    const store = this.store;
    return {
      snapshot: (): Promise<CircuitSnapshot> => store.snapshot(key),
      reset: async (): Promise<void> => {
        await store.record(key, { threshold: 1, cooldownMs: 0 }, true, false);
      },
    };
  }

  private resolve(name: string): Policy {
    const factory = this.policies[name];
    if (!factory) throw new Error(`Unknown resilience policy "${name}".`);
    return factory();
  }
}
