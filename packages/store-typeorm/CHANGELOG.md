# @dudousxd/nestjs-resilience-store-typeorm

## 0.2.1

### Patch Changes

- aad0fb6: Keep healthy circuits off the lock. The SQL store now answers `admit` from a plain read unless the decision changes the circuit (open to half-open, or granting a probe), and records a non-probe success as one conditional `UPDATE` that writes nothing when the circuit is already closed with no failures; failures and probe outcomes still run under `SELECT … FOR UPDATE`. A wrapped call on a closed circuit drops from two locking transactions (ten round trips) to two plain statements. `SqlDriver` gains an optional `run()` for that non-transactional write (falls back to a one-statement transaction when absent). The Redis record script skips its `HSET` when the circuit is already clean. `delay()` on both clocks removes its abort listener when the delay elapses, so `retry` no longer leaves one listener per attempt on the caller's signal.

## 0.2.0

### Minor Changes

- ab31548: Initial release: a TypeORM (Postgres) ResilienceStore for @dudousxd/nestjs-resilience. Mutations run inside a single TypeORM transaction with atomic SELECT FOR UPDATE, reuses core's shared state machine, contract-validated over real Postgres via testcontainers.
