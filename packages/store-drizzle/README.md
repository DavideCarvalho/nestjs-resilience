# @dudousxd/nestjs-resilience-store-drizzle

A Drizzle-backed `ResilienceStore` for `@dudousxd/nestjs-resilience`. Circuit-breaker state — status, failure count, open-until timestamp, and in-flight half-open probes — is stored in a SQLite table via Drizzle ORM (using `better-sqlite3`). The store reuses the core's pure state machine (`computeAdmit`, `computeRecord`) so behavior is identical to the in-memory implementation. Mutations (`admit` and `record`) run in synchronous transactions, guaranteeing exactly-one half-open probe and no lost updates.

## Install

```bash
pnpm add @dudousxd/nestjs-resilience-store-drizzle drizzle-orm better-sqlite3
```

## Usage

Set up the SQLite database with the resilience schema and initialize the table:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';
import { DrizzleResilienceStore, resilienceSchema, CIRCUITS_DDL } from '@dudousxd/nestjs-resilience-store-drizzle';

const sqlite = new Database('resilience.db');
sqlite.exec(CIRCUITS_DDL);
const db = drizzle(sqlite, { schema: resilienceSchema });

ResilienceModule.forRoot({
  store: new DrizzleResilienceStore(db),
});
```

### Options

The constructor accepts an optional second argument:

```ts
new DrizzleResilienceStore(db, { clock })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `clock` | `Clock` | `systemClock` | Clock used for time comparisons. Override in tests with a `FakeClock`. |

## Schema

Each circuit is stored as a single row in the `resilience_circuits` table:

| Column | Type | Description |
|---|---|---|
| `key` | TEXT (primary key) | Circuit identifier. |
| `status` | TEXT | Circuit status: `closed`, `open`, or `half-open`. |
| `failures` | INTEGER | Consecutive failure count. |
| `open_until` | INTEGER | Unix-ms timestamp after which a half-open probe is allowed. |
| `probes` | INTEGER | Number of in-flight half-open probes currently admitted. |

Use `CIRCUITS_DDL` for manual setup or run a `drizzle-kit` migration to create the table.

## Testing

The store is validated against the core `runResilienceStoreContract` suite (imported from `@dudousxd/nestjs-resilience/testing`) over a real SQLite database.

```bash
# Fast unit tests
pnpm test

# Contract suite over real SQLite
pnpm test:db
```
