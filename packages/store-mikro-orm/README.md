# @dudousxd/nestjs-resilience-store-mikro-orm

A MikroORM (Postgres) `ResilienceStore` for `@dudousxd/nestjs-resilience`. Circuit-breaker state — status, failure count, open-until timestamp, and in-flight half-open probes — is stored in a Postgres table via MikroORM. The store reuses the core's pure state machine (`computeAdmit`, `computeRecord`) so behavior is identical to the in-memory implementation. Mutations (`admit` and `record`) run in MikroORM transactions with pessimistic `SELECT … FOR UPDATE` locking, serializing concurrent callers and guaranteeing exactly-one half-open probe with no lost updates.

## Install

```bash
pnpm add @dudousxd/nestjs-resilience-store-mikro-orm @mikro-orm/core @mikro-orm/postgresql
```

## Usage

Set up a MikroORM instance, create the schema, and pass the store to `ResilienceModule`:

```ts
import { MikroORM } from '@mikro-orm/postgresql';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';
import { MikroOrmResilienceStore } from '@dudousxd/nestjs-resilience-store-mikro-orm';

const orm = await MikroORM.init({
  clientUrl: process.env.DATABASE_URL,
  entities: [],
  discovery: { warnWhenNoEntities: false },
});

const store = new MikroOrmResilienceStore(orm);
await store.ensureSchema();

ResilienceModule.forRoot({ store });
```

### Options

The constructor accepts an optional second argument:

```ts
new MikroOrmResilienceStore(orm, { clock })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `clock` | `Clock` | `systemClock` | Clock used for time comparisons. Override in tests with a `FakeClock`. |

## Schema

Each circuit is stored as a single row in the `resilience_circuits` table, created by `ensureSchema()`:

| Column | Type | Description |
|---|---|---|
| `key` | TEXT (primary key) | Circuit identifier. |
| `status` | TEXT | Circuit status: `closed`, `open`, or `half-open`. |
| `failures` | INTEGER | Consecutive failure count. |
| `open_until` | BIGINT | Unix-ms timestamp after which a half-open probe is allowed. |
| `probes` | INTEGER | Number of in-flight half-open probes currently admitted. |

Call `ensureSchema()` once on startup (it runs `CREATE TABLE IF NOT EXISTS` — idempotent and safe to call repeatedly). The raw DDL is also exported as `CIRCUITS_DDL` for use with a migration tool.

## Testing

The store is validated against the core `runResilienceStoreContract` suite (imported from `@dudousxd/nestjs-resilience/testing`) over a real Postgres database spun up with testcontainers — including the concurrency case that proves `FOR UPDATE` serializes concurrent admits to grant exactly one half-open probe.

```bash
# Contract suite over real Postgres (requires Docker)
pnpm test:db

# Skip Postgres tests (no Docker available)
SKIP_TESTCONTAINERS=1 pnpm test:db
```
