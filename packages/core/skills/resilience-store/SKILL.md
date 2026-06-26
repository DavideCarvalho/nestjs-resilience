---
name: resilience-store
description: >
  The ResilienceStore contract in @dudousxd/nestjs-resilience — admit(key, cfg), record(key, cfg, ok,
  probe), snapshot(key) — and its atomicity rule (exactly one half-open probe under load). Use to pick
  a store (InMemoryResilienceStore for single-process, RedisResilienceStore/SQL for fleets), build a
  SQL-backed store with SqlResilienceStore + CIRCUITS_DDL + SqlDriver, understand BreakerConfig /
  Admission / CircuitSnapshot / CircuitStatus, and validate a custom store with runResilienceStoreContract.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-resilience"
  library_version: "0.2.0"
---

# Circuit-breaker stores

A `circuitBreaker` policy keeps no state of its own — it delegates to a `ResilienceStore`. The store
is the unit you swap to go from single-process to fleet-wide breaker state.

## Setup

```ts
import {
  InMemoryResilienceStore,
  SqlResilienceStore,
  CIRCUITS_DDL,
  type ResilienceStore,
  type BreakerConfig,
  type Admission,
  type CircuitSnapshot,
  type CircuitStatus,
} from '@dudousxd/nestjs-resilience';
```

The contract is three async methods:

```ts
interface ResilienceStore {
  admit(key: string, cfg: BreakerConfig): Promise<Admission>;     // may we proceed? (open → throws upstream)
  record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus>;
  snapshot(key: string): Promise<CircuitSnapshot>;                // read-only { status, failures, openUntil? }
}
```

`BreakerConfig` is `{ threshold, cooldownMs, halfOpenMax? }` (`halfOpenMax` defaults to 1).
`CircuitStatus` is `'closed' | 'open' | 'half-open'`.

## Core patterns

### 1. Pick a store by deployment shape

```ts
// Single process / tests — atomic for free via JS run-to-completion
const local = new InMemoryResilienceStore();

// Many instances — shared state via Redis (see the resilience-store-redis skill)
const fleet = new RedisResilienceStore(redis);
```

### 2. Build a SQL-backed store with `SqlResilienceStore`

`SqlResilienceStore(driver, opts?)` implements the contract over any transactional driver. The driver
is a tiny `SqlDriver`: a placeholder style (`'numbered'` for Postgres `$1`, `'positional'` for `?`),
`transaction()` (the breaker relies on `SELECT … FOR UPDATE` locking inside it), a non-transactional
`read()`, and `exec()` for DDL. Call `ensureSchema()` once at startup — it runs the idempotent
`CIRCUITS_DDL`.

```ts
const driver: SqlDriver = {
  placeholders: 'numbered',
  transaction: (body) => db.transaction((tx) => body({
    run: (sql, params) => tx.query(sql, params).then(() => undefined),
    all: (sql, params) => tx.query(sql, params).then((r) => r.rows),
  })),
  read: (sql, params) => db.query(sql, params).then((r) => r.rows),
  exec: (sql) => db.query(sql).then(() => undefined),
};

const store = new SqlResilienceStore(driver);
await store.ensureSchema(); // runs CIRCUITS_DDL: CREATE TABLE IF NOT EXISTS resilience_circuits (...)
```

The packaged adapters (`-store-typeorm`, `-store-mikro-orm`, `-store-prisma`, `-store-drizzle`) are
thin wrappers around exactly this base.

### 3. Validate a custom store against the shared contract

Every built-in store passes one test suite. Reuse it for your own implementation — it takes a name and
a `(clock) => ResilienceStore` factory positionally:

```ts
import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';

runResilienceStoreContract('MyStore', (clock) => new MyResilienceStore(clock));
```

## Common mistakes

### Mistake 1: using `InMemoryResilienceStore` across multiple instances

```ts
// WRONG — each pod/replica keeps its own counters; the breaker never trips fleet-wide
ResilienceModule.forRoot({ store: new InMemoryResilienceStore() });

// CORRECT — a distributed store shares admit/record state across processes
ResilienceModule.forRoot({ store: new RedisResilienceStore(redis) });
```

`InMemoryResilienceStore` holds state in a process-local `Map`; its atomicity guarantee only spans one
event loop.
Source: `packages/core/src/breaker/in-memory.store.ts`

### Mistake 2: implementing a store without atomic admit/record

```ts
// WRONG — read-modify-write without a transaction lets two callers both win the half-open probe
async admit(key, cfg) {
  const s = await this.read(key);
  if (s.status === 'half-open') { await this.write(key, { probes: s.probes + 1 }); return { allow: true, probe: true, status: 'half-open' }; }
}

// CORRECT — make admit/record atomic (Lua / WATCH-MULTI-EXEC / SELECT … FOR UPDATE / CAS)
//   so exactly ONE probe is granted in half-open under concurrency
```

The `ResilienceStore` doc comment mandates atomicity: no lost updates, no double-counted failures, and
exactly one half-open probe under load.
Source: `packages/core/src/breaker/store.ts`

### Mistake 3: forgetting to create the table for `SqlResilienceStore`

```ts
// WRONG — querying before the schema exists throws "relation resilience_circuits does not exist"
const store = new SqlResilienceStore(driver);
await store.admit('k', cfg); // table missing

// CORRECT — run the idempotent DDL at startup via ensureSchema()
const store = new SqlResilienceStore(driver);
await store.ensureSchema();
```

`ensureSchema()` runs `CIRCUITS_DDL` (`CREATE TABLE IF NOT EXISTS resilience_circuits (...)`), which is
safe to run on every boot.
Source: `packages/core/src/breaker/sql.ts`
