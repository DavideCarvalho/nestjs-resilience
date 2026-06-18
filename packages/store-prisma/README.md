# @dudousxd/nestjs-resilience-store-prisma

A Prisma (Postgres) `ResilienceStore` for `@dudousxd/nestjs-resilience`. Circuit-breaker state — status, failure count, open-until timestamp, and in-flight half-open probes — is stored in a Postgres table via Prisma raw SQL. The store reuses the core's pure state machine (`computeAdmit`, `computeRecord`) so behavior is identical to the in-memory implementation. Mutations (`admit` and `record`) run in Prisma transactions with pessimistic `SELECT … FOR UPDATE` locking, serializing concurrent callers and guaranteeing exactly-one half-open probe with no lost updates.

## Install

```bash
pnpm add @dudousxd/nestjs-resilience-store-prisma @prisma/client
```

## Usage

Pass any `PrismaClient` instance to `PrismaResilienceStore`, create the schema, and pass the store to `ResilienceModule`:

```ts
import { PrismaClient } from '@prisma/client';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';
import { PrismaResilienceStore } from '@dudousxd/nestjs-resilience-store-prisma';

const prisma = new PrismaClient();

const store = new PrismaResilienceStore(prisma);
await store.ensureSchema();

ResilienceModule.forRoot({ store });
```

### Options

The constructor accepts an optional second argument:

```ts
new PrismaResilienceStore(prisma, { clock })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `clock` | `Clock` | `systemClock` | Clock used for time comparisons. Override in tests with a `FakeClock`. |

## Schema

This adapter uses raw SQL — **no model is needed in your `schema.prisma`**. Call `ensureSchema()` once on startup to create the table (it runs `CREATE TABLE IF NOT EXISTS` — idempotent and safe to call repeatedly). The raw DDL is also exported as `CIRCUITS_DDL` for use with a migration tool.

Each circuit is stored as a single row in the `resilience_circuits` table:

| Column | Type | Description |
|---|---|---|
| `key` | TEXT (primary key) | Circuit identifier. |
| `status` | TEXT | Circuit status: `closed`, `open`, or `half-open`. |
| `failures` | INTEGER | Consecutive failure count. |
| `open_until` | BIGINT | Unix-ms timestamp after which a half-open probe is allowed. |
| `probes` | INTEGER | Number of in-flight half-open probes currently admitted. |

> This adapter is Postgres-only. It uses `$executeRawUnsafe` / `$queryRawUnsafe` with `$1`-style positional placeholders.

## Testing

The store is validated against the core `runResilienceStoreContract` suite (imported from `@dudousxd/nestjs-resilience/testing`) over a real Postgres database spun up with testcontainers — including the concurrency case that proves `FOR UPDATE` serializes concurrent admits to grant exactly one half-open probe.

```bash
# Contract suite over real Postgres (requires Docker)
pnpm test:db

# Skip Postgres tests (no Docker available)
SKIP_TESTCONTAINERS=1 pnpm test:db
```
