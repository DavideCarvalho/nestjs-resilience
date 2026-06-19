# @dudousxd/nestjs-resilience-store-drizzle

## 0.2.0

### Minor Changes

- 1e7b629: Initial release: a Drizzle (SQLite / better-sqlite3) ResilienceStore for @dudousxd/nestjs-resilience. Circuit state persists in a single `resilience_circuits` table; each admit/record runs in a synchronous transaction reusing core's shared state machine. Validated against the core ResilienceStore contract suite.
