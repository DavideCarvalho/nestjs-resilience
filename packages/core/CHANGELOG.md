# @dudousxd/nestjs-resilience

## 0.3.2

### Patch Changes

- 890d708: Adiciona `license`, `description` e `author` ao package.json.

  O pacote estava publicado sem campo `license`, o que legalmente significa
  "todos os direitos reservados" e não MIT — ausência de licença é o oposto de
  permissivo. Isso trava due diligence jurídica de qualquer empresa avaliando o
  ecossistema, e era o único pacote do monorepo sem os campos: os seis
  adapters irmãos já declaravam MIT.

## 0.3.1

### Patch Changes

- 0c51115: Add NestJS 12 to the supported peer range.

  `@nestjs/common` and `@nestjs/core` now peer `^10 || ^11 || ^12`, and the dev/test
  matrix runs on `@nestjs/*@12.0.1`. No source changes were needed — build, typecheck
  and the unit suite pass unchanged on v12.

  The dev dependencies pin `^12.0.1` rather than `^12`: `@nestjs/core@12.0.0` shipped
  with its peer ranges still declaring `@nestjs/common@^11.0.0`, so resolving to
  12.0.0 produces spurious unmet-peer warnings. 12.0.1 corrects them.

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
