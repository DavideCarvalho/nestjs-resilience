---
"@dudousxd/nestjs-resilience": minor
---

Initial release: composable resilience policies (timeout, retry, circuit-breaker, failover) with a programmatic API, NestJS decorators + explorer, an injectable ResilienceService, a pluggable ResilienceStore (in-memory in core), and optional diagnostics/context/event-emitter integration. The store-contract test suite (`runResilienceStoreContract`) for adapter authors is exposed under the `@dudousxd/nestjs-resilience/testing` subpath to keep the main barrel production-safe (no vitest import).
