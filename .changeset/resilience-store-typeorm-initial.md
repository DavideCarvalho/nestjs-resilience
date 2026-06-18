---
"@dudousxd/nestjs-resilience-store-typeorm": minor
---

Initial release: a TypeORM (Postgres) ResilienceStore for @dudousxd/nestjs-resilience. Mutations run inside a single TypeORM transaction with atomic SELECT FOR UPDATE, reuses core's shared state machine, contract-validated over real Postgres via testcontainers.
