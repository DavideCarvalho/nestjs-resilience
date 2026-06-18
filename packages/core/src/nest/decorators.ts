import type { Backoff } from '../policies/retry';

export const RESILIENCE_META = Symbol('resilience:meta');

export interface TimeoutMeta { kind: 'timeout'; ms: number }
export interface RetryMeta { kind: 'retry'; attempts: number; backoff?: Backoff }
export interface CircuitMeta { kind: 'circuit'; threshold: number; cooldownMs: number; key?: string; halfOpenMax?: number }
export type PolicyMeta = TimeoutMeta | RetryMeta | CircuitMeta;

function push(target: object, propertyKey: string | symbol, meta: PolicyMeta): void {
  const existing: PolicyMeta[] = Reflect.getMetadata(RESILIENCE_META, target, propertyKey) ?? [];
  // Decorators apply bottom-up; unshift so source order = outer→inner.
  Reflect.defineMetadata(RESILIENCE_META, [meta, ...existing], target, propertyKey);
}

export function Timeout(ms: number): MethodDecorator {
  return (target, key) => push(target, key, { kind: 'timeout', ms });
}
export function Retry(opts: { attempts: number; backoff?: Backoff }): MethodDecorator {
  return (target, key) => push(target, key, { kind: 'retry', ...opts });
}
export function CircuitBreaker(
  opts: { threshold: number; cooldownMs: number; key?: string; halfOpenMax?: number },
): MethodDecorator {
  return (target, key) => push(target, key, { kind: 'circuit', ...opts });
}
