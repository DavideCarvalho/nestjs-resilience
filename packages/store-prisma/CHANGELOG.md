# @dudousxd/nestjs-resilience-store-prisma

## 0.2.0

### Minor Changes

- 1d989d8: Initial release: a Prisma (Postgres) ResilienceStore for @dudousxd/nestjs-resilience. Mutations run in atomic SELECT FOR UPDATE via $transaction + raw SQL, reuses core's shared state machine, contract-validated over real Postgres via testcontainers.
