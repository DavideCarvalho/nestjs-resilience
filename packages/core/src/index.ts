export const VERSION = '0.2.0';

export type { Clock } from './clock';
export { FakeClock, SystemClock, systemClock } from './clock';
export { BrokenCircuitError, TimeoutError } from './errors';
export type { EventSink, ResilienceEvent, ResilienceEventType } from './events';
export { combineSinks } from './events';
export { eventEmitterSink, resilienceEventName } from './integration/event-emitter';
export type { EventEmitterLike } from './integration/event-emitter';
export type { Operation, Policy, PolicyContext } from './policy';
export { rootContext } from './policy';
export { timeout } from './policies/timeout';
export { type Backoff, exponential, retry } from './policies/retry';
export { wrap } from './policies/wrap';
export { type CircuitBreakerOptions, circuitBreaker } from './policies/circuit-breaker';
export { type FailoverOptions, failover } from './policies/failover';
export type { ResilienceStore } from './breaker/store';
export type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './breaker/types';
export { InMemoryResilienceStore } from './breaker/in-memory.store';
export { diagnosticsSink } from './integration/diagnostics';
export { tenantSuffix } from './integration/context';
export { ResilienceModule } from './nest/resilience.module';
export type {
  ResilienceModuleOptions,
  ResilienceModuleAsyncOptions,
} from './nest/resilience.module';
export { ResilienceService } from './nest/resilience.service';
export { RESILIENCE_STORE, RESILIENCE_OPTIONS } from './nest/tokens';
export { CircuitBreaker, Retry, Timeout } from './nest/decorators';
export { INITIAL_CIRCUIT_STATE, computeAdmit, computeRecord } from './breaker/state-machine';
export type { CircuitState } from './breaker/state-machine';
export { CIRCUITS_DDL, SqlResilienceStore } from './breaker/sql';
export type {
  SqlDriver,
  SqlPlaceholderStyle,
  SqlResilienceStoreOptions,
  SqlTx,
} from './breaker/sql';
