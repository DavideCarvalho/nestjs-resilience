import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { ResilienceStore } from '../breaker/store';
import { circuitBreaker } from '../policies/circuit-breaker';
import { retry } from '../policies/retry';
import { timeout } from '../policies/timeout';
import { wrap } from '../policies/wrap';
import type { Policy } from '../policy';
import { type PolicyMeta, RESILIENCE_META } from './decorators';
import { ResilienceService } from './resilience.service';
import { RESILIENCE_STORE } from './tokens';

@Injectable()
export class ResilienceExplorer implements OnModuleInit {
  private readonly wrapped = new WeakSet<object>();

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(ResilienceService) private readonly service: ResilienceService,
    @Inject(RESILIENCE_STORE) private readonly store: ResilienceStore,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      if (this.wrapped.has(instance)) continue;
      this.wrapped.add(instance);
      const proto = Object.getPrototypeOf(instance);
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const metas: PolicyMeta[] | undefined = Reflect.getMetadata(RESILIENCE_META, proto, methodName);
        if (!metas?.length) continue;
        const className = wrapper.metatype?.name ?? 'Provider';
        const policy = this.buildPolicy(metas, `${className}.${methodName}`);
        const original = instance[methodName] as (...args: unknown[]) => Promise<unknown>;
        instance[methodName] = (...args: unknown[]) => policy.execute(() => original.apply(instance, args));
      }
    }
  }

  private buildPolicy(metas: PolicyMeta[], defaultKey: string): Policy {
    const policies: Policy[] = metas.map((m) => {
      if (m.kind === 'timeout') return timeout(m.ms);
      if (m.kind === 'retry') {
        return retry({
          attempts: m.attempts,
          ...(m.backoff !== undefined ? { backoff: m.backoff } : {}),
        });
      }
      return circuitBreaker({
        key: m.key ?? defaultKey,
        store: this.store,
        threshold: m.threshold,
        cooldownMs: m.cooldownMs,
        ...(m.halfOpenMax !== undefined ? { halfOpenMax: m.halfOpenMax } : {}),
        onEvent: this.service.sink,
      });
    });
    return wrap(...policies);
  }
}
