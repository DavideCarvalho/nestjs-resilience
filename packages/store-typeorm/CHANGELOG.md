# @dudousxd/nestjs-resilience-store-typeorm

## 0.2.0

### Minor Changes

- ab31548: Initial release: a TypeORM (Postgres) ResilienceStore for @dudousxd/nestjs-resilience. Mutations run inside a single TypeORM transaction with atomic SELECT FOR UPDATE, reuses core's shared state machine, contract-validated over real Postgres via testcontainers.
