---
"@dudousxd/nestjs-resilience-store-redis": minor
---

Initial release: a distributed Redis-backed ResilienceStore for @dudousxd/nestjs-resilience. Circuit-breaker state (status, failure count, open-until, in-flight probes) is shared fleet-wide in a Redis hash, with `admit` and `record` implemented as atomic Lua scripts (exactly-one half-open probe, no lost updates). Validated against the core ResilienceStore contract suite over real Redis via testcontainers.
