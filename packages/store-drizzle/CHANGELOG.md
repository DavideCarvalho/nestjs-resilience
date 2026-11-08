# @dudousxd/nestjs-resilience-store-drizzle

## 0.2.1

### Patch Changes

- 7863c0d: Deprecated: use NestJS's own [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience). This is the last release; it carries only the deprecation notice and the migration guide. The distributed circuit-breaker state (the store packages) has no official equivalent: the official breaker keeps its state in each process.

## 0.2.0

### Minor Changes

- 1e7b629: Initial release: a Drizzle (SQLite / better-sqlite3) ResilienceStore for @dudousxd/nestjs-resilience. Circuit state persists in a single `resilience_circuits` table; each admit/record runs in a synchronous transaction reusing core's shared state machine. Validated against the core ResilienceStore contract suite.
