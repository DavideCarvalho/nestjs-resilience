export const VERSION = '0.3.4';

export { InMemoryResilienceStore } from './breaker/in-memory.store';
export type {
  SqlDriver,
  SqlPlaceholderStyle,
  SqlResilienceStoreOptions,
  SqlTx,
} from './breaker/sql';
export { CIRCUITS_DDL, SqlResilienceStore } from './breaker/sql';
export type { CircuitState } from './breaker/state-machine';
export { computeAdmit, computeRecord, INITIAL_CIRCUIT_STATE } from './breaker/state-machine';
export type { ResilienceStore } from './breaker/store';
export type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './breaker/types';
export type { Clock } from './clock';
export { FakeClock, SystemClock, systemClock } from './clock';
export { BrokenCircuitError, TimeoutError } from './errors';
export type { EventSink, ResilienceEvent, ResilienceEventType } from './events';
export { combineSinks } from './events';
export { tenantSuffix } from './integration/context';
export { diagnosticsSink } from './integration/diagnostics';
export type { EventEmitterLike } from './integration/event-emitter';
export { eventEmitterSink, resilienceEventName } from './integration/event-emitter';
export { CircuitBreaker, Retry, Timeout } from './nest/decorators';
export type {
  ResilienceModuleAsyncOptions,
  ResilienceModuleOptions,
} from './nest/resilience.module';
export { ResilienceModule } from './nest/resilience.module';
export { ResilienceService } from './nest/resilience.service';
export { RESILIENCE_OPTIONS, RESILIENCE_STORE } from './nest/tokens';
export { type CircuitBreakerOptions, circuitBreaker } from './policies/circuit-breaker';
export { type FailoverOptions, failover } from './policies/failover';
export { type Backoff, exponential, retry } from './policies/retry';
export { timeout } from './policies/timeout';
export { wrap } from './policies/wrap';
export type { Operation, Policy, PolicyContext } from './policy';
export { rootContext } from './policy';
