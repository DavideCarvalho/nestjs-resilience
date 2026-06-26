# @dudousxd/nestjs-resilience

## 0.3.0

### Minor Changes

- 2681d46: Drop the dead `'timeout'` and `'retry'` members from the public `ResilienceEventType`
  union — no policy ever emitted them (only `circuit-opened`/`circuit-closed`/`circuit-half-open`/
  `short-circuited` and `failover` are emitted), so the type now reflects reality. `timeout` and
  `retry` remain valid _policy_ names; only the dead event-type members are removed.

  Also sync the exported `VERSION` const with `package.json` (was stale at `0.1.0`). A new
  `scripts/sync-version.mjs` is chained into the `version` (`changeset version`) script so future
  release bumps keep `src/index.ts` and `package.json` in lockstep; it also doubles as a `--check`
  drift guard.

### Patch Changes

- 6c6b859: Ship TanStack Intent agent skills (SKILL.md) inside the package.

## 0.2.0

### Minor Changes

- 49d731b: Initial release: composable resilience policies (timeout, retry, circuit-breaker, failover) with a programmatic API, NestJS decorators + explorer, an injectable ResilienceService, a pluggable ResilienceStore (in-memory in core), and optional diagnostics/context/event-emitter integration. The store-contract test suite (`runResilienceStoreContract`) for adapter authors is exposed under the `@dudousxd/nestjs-resilience/testing` subpath to keep the main barrel production-safe (no vitest import).
- 20479f6: Add an optional @nestjs/event-emitter mirror: pass an EventEmitter2-style `eventEmitter` to `ResilienceModule` (or use the exported `eventEmitterSink`/`combineSinks`) to receive resilience events as `resilience.<type>` (e.g. `resilience.circuit.opened`) alongside the diagnostics channel. Core does not import @nestjs/event-emitter — the emitter is structurally typed.
