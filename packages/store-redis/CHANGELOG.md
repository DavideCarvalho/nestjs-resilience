# @dudousxd/nestjs-resilience-store-redis

## 0.2.1

### Patch Changes

- 6c6b859: Ship TanStack Intent agent skills (SKILL.md) inside the package.

## 0.2.0

### Minor Changes

- 248d896: Initial release: a distributed Redis-backed ResilienceStore for @dudousxd/nestjs-resilience. Circuit-breaker state (status, failure count, open-until, in-flight probes) is shared fleet-wide in a Redis hash, with `admit` and `record` implemented as atomic Lua scripts (exactly-one half-open probe, no lost updates). Validated against the core ResilienceStore contract suite over real Redis via testcontainers.
