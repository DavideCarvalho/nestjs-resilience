---
"@dudousxd/nestjs-resilience-store-prisma": minor
---

Initial release: a Prisma (Postgres) ResilienceStore for @dudousxd/nestjs-resilience. Mutations run in atomic SELECT FOR UPDATE via $transaction + raw SQL, reuses core's shared state machine, contract-validated over real Postgres via testcontainers.
