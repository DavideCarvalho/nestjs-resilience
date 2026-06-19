# @dudousxd/nestjs-resilience-store-mikro-orm

## 0.2.0

### Minor Changes

- 897f0a9: Initial release: a MikroORM (Postgres) ResilienceStore for @dudousxd/nestjs-resilience. Mutations run inside a single MikroORM transaction with atomic SELECT FOR UPDATE, reuses core's shared state machine, contract-validated over real Postgres via testcontainers.
