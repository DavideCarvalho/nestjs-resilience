# @dudousxd/nestjs-resilience

## 0.2.0

### Minor Changes

- 49d731b: Initial release: composable resilience policies (timeout, retry, circuit-breaker, failover) with a programmatic API, NestJS decorators + explorer, an injectable ResilienceService, a pluggable ResilienceStore (in-memory in core), and optional diagnostics/context/event-emitter integration. The store-contract test suite (`runResilienceStoreContract`) for adapter authors is exposed under the `@dudousxd/nestjs-resilience/testing` subpath to keep the main barrel production-safe (no vitest import).
- 20479f6: Add an optional @nestjs/event-emitter mirror: pass an EventEmitter2-style `eventEmitter` to `ResilienceModule` (or use the exported `eventEmitterSink`/`combineSinks`) to receive resilience events as `resilience.<type>` (e.g. `resilience.circuit.opened`) alongside the diagnostics channel. Core does not import @nestjs/event-emitter — the emitter is structurally typed.
