# Resilience: Postgres store adapters (TypeORM / MikroORM / Prisma)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three distributed `ResilienceStore` adapters backed by Postgres via TypeORM, MikroORM, and Prisma — each a thin raw-SQL-over-transaction wrapper reusing core's pure `computeAdmit`/`computeRecord`, validated against the shared contract under testcontainers Postgres.

**Architecture:** Every adapter stores circuit state in one table `resilience_circuits` (`key` PK, `status`, `failures`, `open_until`, `probes`). Each `admit`/`record` runs the SAME atomic algorithm in a DB transaction: (1) `INSERT … ON CONFLICT DO NOTHING` to guarantee the row exists, (2) `SELECT … FOR UPDATE` to pessimistically lock it (serializing concurrent callers per key — this is what yields fleet-wide single-probe + no lost updates), (3) build a `CircuitState`, call the core pure function, (4) `UPDATE` the row. The adapters differ ONLY in how each ORM opens a transaction and runs raw SQL. No ORM entities/models are needed (raw SQL throughout); a tiny `ensure*Schema` helper runs the `CREATE TABLE IF NOT EXISTS`.

**Tech Stack:** TypeScript, core (workspace), per-ORM client (peer), `pg`, `@testcontainers/postgresql`, tsup dual ESM/CJS, vitest.

## Global Constraints

- TS: extends `tsconfig.base.json` (strict, exactOptionalPropertyTypes, module ESNext, moduleResolution Bundler). Extensionless relative imports.
- Each adapter REUSES core's pure functions — NO re-implemented state-machine logic. Import `computeAdmit`/`computeRecord`/`INITIAL_CIRCUIT_STATE`/`CircuitState`/`systemClock` + types from `@dudousxd/nestjs-resilience`; `runResilienceStoreContract` from `@dudousxd/nestjs-resilience/testing`.
- Package names: `@dudousxd/nestjs-resilience-store-typeorm`, `-store-mikro-orm`, `-store-prisma`. Version `0.1.0`. Dual ESM+CJS tsup; `exports` with correct `import`(`.d.ts`)/`require`(`.d.cts`) pairs — verify the CJS `types` path is `./dist/index.d.cts` (known footgun).
- Contract integration specs are `*.db.spec.ts` run via a `test:db` package script; they spin up Postgres via `@testcontainers/postgresql` (`postgres:16-alpine`) and **skip cleanly** when `SKIP_TESTCONTAINERS` is set (wrap the suite in `describe.skip` based on the env). The default `test` script runs only non-Docker tests (each adapter has a tiny snapshot unit using a hand fake, OR excludes `*.db.spec.ts`).
- Commits end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## SHARED building blocks (every adapter uses these verbatim)

Put these in each package's `src/sql.ts`:
```ts
import type { CircuitState, CircuitStatus } from '@dudousxd/nestjs-resilience';
import { INITIAL_CIRCUIT_STATE } from '@dudousxd/nestjs-resilience';

export const CIRCUITS_DDL = `
CREATE TABLE IF NOT EXISTS resilience_circuits (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  failures INTEGER NOT NULL,
  open_until BIGINT NOT NULL,
  probes INTEGER NOT NULL
)`;

// Postgres $N placeholders.
export const INSERT_INITIAL = `INSERT INTO resilience_circuits (key, status, failures, open_until, probes) VALUES ($1, 'closed', 0, 0, 0) ON CONFLICT (key) DO NOTHING`;
export const SELECT_FOR_UPDATE = `SELECT status, failures, open_until, probes FROM resilience_circuits WHERE key = $1 FOR UPDATE`;
export const SELECT_PLAIN = `SELECT status, failures, open_until, probes FROM resilience_circuits WHERE key = $1`;
export const UPDATE_STATE = `UPDATE resilience_circuits SET status = $1, failures = $2, open_until = $3, probes = $4 WHERE key = $5`;

/** Map a raw DB row (numbers may come back as string or BigInt depending on the driver) → CircuitState. */
export function rowToState(row: { status: unknown; failures: unknown; open_until: unknown; probes: unknown } | undefined): CircuitState {
  if (!row) return { ...INITIAL_CIRCUIT_STATE };
  return {
    status: String(row.status) as CircuitStatus,
    failures: Number(row.failures),
    openUntil: Number(row.open_until),
    probes: Number(row.probes),
  };
}
```

**Atomic algorithm (identical across adapters), inside a transaction `t` that can `exec(sql, params)` and `query(sql, params)`:**
```
await exec(INSERT_INITIAL, [key]);
const rows = await query(SELECT_FOR_UPDATE, [key]);
const { state, result } = compute(rowToState(rows[0]), cfg, ...);
await exec(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
return result;   // admission for admit; status for record
```
`snapshot(key)` (no transaction/lock): `query(SELECT_PLAIN, [key])` → `rowToState(rows[0])` → `{ status, failures, ...(openUntil>0?{openUntil}:{}) }`.

---

### Task 1: store-typeorm — scaffold

**Files:** Create `packages/store-typeorm/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,LICENSE,src/index.ts}`

- [ ] **Step 1: package.json**
```json
{
  "name": "@dudousxd/nestjs-resilience-store-typeorm",
  "version": "0.1.0",
  "description": "TypeORM (Postgres) ResilienceStore for @dudousxd/nestjs-resilience",
  "license": "MIT", "author": "Davide Carvalho", "type": "module",
  "main": "./dist/index.cjs", "module": "./dist/index.js", "types": "./dist/index.d.ts",
  "files": ["dist"],
  "exports": { ".": { "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }, "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" } } },
  "scripts": { "build": "tsup", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run --exclude '**/*.db.spec.ts'", "test:db": "vitest run" },
  "peerDependencies": { "@dudousxd/nestjs-resilience": ">=0.1.0 <1.0.0", "typeorm": "^0.3.0" },
  "devDependencies": { "@dudousxd/nestjs-resilience": "workspace:^", "@testcontainers/postgresql": "^10.18.0", "pg": "^8.13.1", "reflect-metadata": "^0.2.2", "typeorm": "^0.3.30", "typescript": "^5.9.3" }
}
```
- [ ] **Step 2:** tsconfig (`{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }`), tsup (`entry ['src/index.ts'], format ['esm','cjs'], dts:true, clean:true`), vitest (`{ test: { testTimeout: 60_000, hookTimeout: 240_000 } }`), `cp packages/core/LICENSE packages/store-typeorm/LICENSE`, `src/index.ts` = `export {};`.
- [ ] **Step 3:** `pnpm install` (root). Fetches typeorm, pg, @testcontainers/postgresql, reflect-metadata. If a native build (pg has none; nothing native here typically) is gated, note it. If registry can't resolve, BLOCKED.
- [ ] **Step 4:** `pnpm -C packages/store-typeorm build` (empty OK). Commit `packages/store-typeorm pnpm-lock.yaml` — `chore: scaffold @dudousxd/nestjs-resilience-store-typeorm`.

---

### Task 2: store-typeorm — TypeOrmResilienceStore + contract (testcontainers)

**Files:** Create `packages/store-typeorm/src/sql.ts`, `src/typeorm.store.ts`, `src/typeorm.store.db.spec.ts`, `README.md`, `.changeset/resilience-store-typeorm-initial.md`; Modify `src/index.ts`.

**Interfaces:** Produces `class TypeOrmResilienceStore implements ResilienceStore` with `constructor(dataSource: DataSource, opts?: { clock?: Clock })` and `ensureSchema(): Promise<void>`. Consumes core pure fns + `DataSource` from `typeorm`.

- [ ] **Step 1:** Write `src/sql.ts` (the SHARED building blocks above, verbatim).

- [ ] **Step 2:** Write `src/typeorm.store.ts`:
```ts
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus, Clock, ResilienceStore } from '@dudousxd/nestjs-resilience';
import { computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import type { DataSource } from 'typeorm';
import { CIRCUITS_DDL, INSERT_INITIAL, SELECT_FOR_UPDATE, SELECT_PLAIN, UPDATE_STATE, rowToState } from './sql';

export interface TypeOrmResilienceStoreOptions { clock?: Clock }

export class TypeOrmResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly ds: DataSource, opts: TypeOrmResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async ensureSchema(): Promise<void> {
    await this.ds.query(CIRCUITS_DDL);
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    return this.ds.transaction(async (em): Promise<Admission> => {
      await em.query(INSERT_INITIAL, [key]);
      const rows = (await em.query(SELECT_FOR_UPDATE, [key])) as unknown[];
      const { state, admission } = computeAdmit(rowToState(rows[0] as never), cfg, this.clock.now());
      await em.query(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    return this.ds.transaction(async (em): Promise<CircuitStatus> => {
      await em.query(INSERT_INITIAL, [key]);
      const rows = (await em.query(SELECT_FOR_UPDATE, [key])) as unknown[];
      const { state, status } = computeRecord(rowToState(rows[0] as never), cfg, ok, probe, this.clock.now());
      await em.query(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const rows = (await this.ds.query(SELECT_PLAIN, [key])) as unknown[];
    const s = rowToState(rows[0] as never);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
```

- [ ] **Step 3:** `src/index.ts`:
```ts
export { TypeOrmResilienceStore } from './typeorm.store';
export type { TypeOrmResilienceStoreOptions } from './typeorm.store';
export { CIRCUITS_DDL } from './sql';
```

- [ ] **Step 4:** Write `src/typeorm.store.db.spec.ts` (testcontainers):
```ts
import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import { DataSource } from 'typeorm';
import { TypeOrmResilienceStore } from './typeorm.store';

const skip = !!process.env.SKIP_TESTCONTAINERS;
const suite = skip ? describe.skip : describe;

suite('TypeOrmResilienceStore (real Postgres)', () => {
  let pg: StartedPostgreSqlContainer;
  let ds: DataSource;
  let n = 0;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({ type: 'postgres', url: pg.getConnectionUri() });
    await ds.initialize();
  }, 240_000);

  afterAll(async () => {
    await ds?.destroy();
    await pg?.stop();
  });

  // Unique table-key namespace per makeStore call: the contract reuses key 'k'. We isolate by
  // prefixing the key inside a wrapper store so each case sees a clean circuit on the shared table.
  runResilienceStoreContract('TypeOrmResilienceStore', (clock) => {
    const prefix = `t${++n}:`;
    const store = new TypeOrmResilienceStore(ds, { clock });
    // ensureSchema is idempotent; run once lazily on first construction.
    void store.ensureSchema();
    return new Proxy(store, {
      get(target, p) {
        const orig = (target as unknown as Record<string, unknown>)[p as string];
        if (typeof orig === 'function' && (p === 'admit' || p === 'record' || p === 'snapshot')) {
          return (key: string, ...rest: unknown[]) => (orig as (...a: unknown[]) => unknown).call(target, prefix + key, ...rest);
        }
        return orig;
      },
    }) as TypeOrmResilienceStore;
  });
});
```
> The Proxy key-prefix isolates each contract case's reuse of key `'k'` on the one shared table.
> `ensureSchema()` is `CREATE TABLE IF NOT EXISTS`, safe to call repeatedly. If `void store.ensureSchema()`
> racing the first query is flaky, instead create the table ONCE in `beforeAll` (call
> `await new TypeOrmResilienceStore(ds).ensureSchema()` there) and drop the per-store call — prefer that
> if you see "relation does not exist".

- [ ] **Step 5: Run the contract against real Postgres**

Run: `pnpm -C packages/store-typeorm test:db` (Docker) → all contract cases pass, incl. concurrency (FOR UPDATE serializes).
Run: `SKIP_TESTCONTAINERS=1 pnpm -C packages/store-typeorm test:db` → skipped, exit 0.
Run: `pnpm -C packages/store-typeorm typecheck` (0 errors) + `pnpm -C packages/store-typeorm build`.
> If a concurrency case fails, the FOR UPDATE lock isn't serializing — confirm the INSERT-then-SELECT-FOR-UPDATE
> runs inside the same `em` transaction. If "relation does not exist", create the table in beforeAll (see note).
> Do NOT relax the contract.

- [ ] **Step 6:** README (mirror store-drizzle: intro = TypeORM/Postgres ResilienceStore reusing core's state machine; install `pnpm add @dudousxd/nestjs-resilience-store-typeorm typeorm pg`; usage = `const store = new TypeOrmResilienceStore(dataSource); await store.ensureSchema(); ResilienceModule.forRoot({ store })`; note the `resilience_circuits` table + `ensureSchema()`; testing note `test:db` needs Docker). Changeset `.changeset/resilience-store-typeorm-initial.md` (minor; "Initial release: a TypeORM (Postgres) ResilienceStore … atomic SELECT FOR UPDATE, reuses core's shared state machine, contract-validated over real Postgres via testcontainers."). Verify symbols vs `src/index.ts`.

- [ ] **Step 7:** Commit `packages/store-typeorm/src packages/store-typeorm/README.md .changeset/` — `feat(store-typeorm): TypeOrmResilienceStore over Postgres (FOR UPDATE), contract-validated`.

---

### Task 3: store-mikro-orm — scaffold

Same as Task 1 with name `@dudousxd/nestjs-resilience-store-mikro-orm`. peers: `@dudousxd/nestjs-resilience` + `@mikro-orm/core` (`^6.0.0 || ^7.0.0`). devDeps: core (workspace:^), `@mikro-orm/core` `^6.4.0`, `@mikro-orm/postgresql` `^6.4.0`, `@testcontainers/postgresql` `^10.18.0`, `reflect-metadata` `^0.2.2`, `typescript`. Scripts identical (test excludes `*.db.spec.ts`, `test:db` runs all). Scaffold files + `pnpm install` + empty build + commit `chore: scaffold @dudousxd/nestjs-resilience-store-mikro-orm`.

---

### Task 4: store-mikro-orm — MikroOrmResilienceStore + contract

`src/sql.ts` = the shared building blocks (verbatim). `src/mikro-orm.store.ts`:
```ts
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus, Clock, ResilienceStore } from '@dudousxd/nestjs-resilience';
import { computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import type { MikroORM } from '@mikro-orm/core';
import { CIRCUITS_DDL, INSERT_INITIAL, SELECT_FOR_UPDATE, SELECT_PLAIN, UPDATE_STATE, rowToState } from './sql';

export interface MikroOrmResilienceStoreOptions { clock?: Clock }

export class MikroOrmResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly orm: MikroORM, opts: MikroOrmResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async ensureSchema(): Promise<void> {
    await this.orm.em.getConnection().execute(CIRCUITS_DDL);
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const em = this.orm.em.fork();
    return em.transactional(async (tx): Promise<Admission> => {
      const conn = tx.getConnection();
      await conn.execute(INSERT_INITIAL, [key]);
      const rows = (await conn.execute(SELECT_FOR_UPDATE, [key])) as unknown[];
      const { state, admission } = computeAdmit(rowToState(rows[0] as never), cfg, this.clock.now());
      await conn.execute(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    const em = this.orm.em.fork();
    return em.transactional(async (tx): Promise<CircuitStatus> => {
      const conn = tx.getConnection();
      await conn.execute(INSERT_INITIAL, [key]);
      const rows = (await conn.execute(SELECT_FOR_UPDATE, [key])) as unknown[];
      const { state, status } = computeRecord(rowToState(rows[0] as never), cfg, ok, probe, this.clock.now());
      await conn.execute(UPDATE_STATE, [state.status, state.failures, state.openUntil, state.probes, key]);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const rows = (await this.orm.em.getConnection().execute(SELECT_PLAIN, [key])) as unknown[];
    const s = rowToState(rows[0] as never);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
```
> IMPORTANT: confirm that `tx.getConnection().execute(...)` runs inside the EM's transaction (so FOR UPDATE
> locks within the same tx). If MikroORM's connection.execute bypasses the transaction context (you'll see the
> concurrency contract case fail — two probes granted), switch to running the three statements via the
> transactional EM's query API that joins the tx (e.g. `tx.execute(...)` if available in the installed
> version, or `tx.getConnection('write').execute(sql, params, 'all', tx.getTransactionContext())`). Verify
> against the installed @mikro-orm/core version's API; the contract under testcontainers is the proof.

`src/index.ts` exports `MikroOrmResilienceStore` + options + `CIRCUITS_DDL`. The `*.db.spec.ts` mirrors Task 2's (testcontainers Postgres; build a MikroORM via `@mikro-orm/postgresql` `MikroORM.init({ driver: PostgreSqlDriver, clientUrl: pg.getConnectionUri(), entities: [], discovery: { warnWhenNoEntities: false } })`; create the table once in beforeAll via `ensureSchema`; Proxy key-prefix per makeStore). Run `test:db` (Docker), the skip path, typecheck, build. README + changeset (`-store-mikro-orm`). Commit `feat(store-mikro-orm): MikroOrmResilienceStore over Postgres (FOR UPDATE), contract-validated`.

---

### Task 5: store-prisma — scaffold

Name `@dudousxd/nestjs-resilience-store-prisma`. peers: `@dudousxd/nestjs-resilience` + `@prisma/client` (`^5.0.0 || ^6.0.0 || ^7.0.0`). devDeps: core (workspace:^), `@prisma/client` `^6.19.3`, `prisma` `^6.19.3`, `@testcontainers/postgresql` `^10.18.0`, `typescript`. Add `"files": ["dist", "prisma"]`. Scripts: build/typecheck/test(exclude db)/test:db PLUS `"prisma:generate": "prisma generate --schema prisma/schema.prisma"`. Ship a minimal `prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js"; output = "../node_modules/.prisma/resilience-client" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
```
(No models — the adapter uses raw SQL only.) Scaffold files + `pnpm install` + `pnpm -C packages/store-prisma prisma:generate` (generates the client; needs no live DB for generate) + empty build + commit `chore: scaffold @dudousxd/nestjs-resilience-store-prisma`.
> If `prisma generate` requires `DATABASE_URL`, set a dummy `DATABASE_URL=postgresql://x:x@localhost:5432/x` env for the generate step (generation doesn't connect).

---

### Task 6: store-prisma — PrismaResilienceStore + contract

`src/sql.ts` = shared building blocks. `src/prisma.store.ts`:
```ts
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus, Clock, ResilienceStore } from '@dudousxd/nestjs-resilience';
import { computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import { CIRCUITS_DDL, INSERT_INITIAL, SELECT_FOR_UPDATE, SELECT_PLAIN, UPDATE_STATE, rowToState } from './sql';

/** Structural subset of PrismaClient the adapter needs (avoids importing a generated client type). */
export interface PrismaLike {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<R>(fn: (tx: PrismaLike) => Promise<R>): Promise<R>;
}

export interface PrismaResilienceStoreOptions { clock?: Clock }

export class PrismaResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly prisma: PrismaLike, opts: PrismaResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async ensureSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(CIRCUITS_DDL);
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    return this.prisma.$transaction(async (tx): Promise<Admission> => {
      await tx.$executeRawUnsafe(INSERT_INITIAL, key);
      const rows = await tx.$queryRawUnsafe<unknown[]>(SELECT_FOR_UPDATE, key);
      const { state, admission } = computeAdmit(rowToState(rows[0] as never), cfg, this.clock.now());
      await tx.$executeRawUnsafe(UPDATE_STATE, state.status, state.failures, state.openUntil, state.probes, key);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    return this.prisma.$transaction(async (tx): Promise<CircuitStatus> => {
      await tx.$executeRawUnsafe(INSERT_INITIAL, key);
      const rows = await tx.$queryRawUnsafe<unknown[]>(SELECT_FOR_UPDATE, key);
      const { state, status } = computeRecord(rowToState(rows[0] as never), cfg, ok, probe, this.clock.now());
      await tx.$executeRawUnsafe(UPDATE_STATE, state.status, state.failures, state.openUntil, state.probes, key);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(SELECT_PLAIN, key);
    const s = rowToState(rows[0] as never);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
```
> `$queryRawUnsafe` may return Postgres BIGINT (`open_until`) as a JS `BigInt`; `rowToState` uses `Number(...)`
> which handles BigInt, string, and number. `$transaction(fn)` with an interactive callback uses a real DB
> transaction so `SELECT … FOR UPDATE` locks within it.

`src/index.ts` exports `PrismaResilienceStore` + `PrismaResilienceStoreOptions` + `PrismaLike` + `CIRCUITS_DDL`. The `*.db.spec.ts`: testcontainers Postgres; `prisma generate` already ran (scaffold) → import the generated client: `const { PrismaClient } = await import('../node_modules/.prisma/resilience-client/index.js')`; `const prisma = new PrismaClient({ datasources: { db: { url: pg.getConnectionUri() } } })`; `await new PrismaResilienceStore(prisma).ensureSchema()` once in beforeAll; Proxy key-prefix per makeStore; `afterAll` `await prisma.$disconnect()`. Run `test:db` (Docker), skip path, typecheck, build. README + changeset (`-store-prisma`; mention raw-SQL, `ensureSchema()`, that the adapter takes any `PrismaClient`). Commit `feat(store-prisma): PrismaResilienceStore over Postgres (FOR UPDATE), contract-validated`.

---

## Self-Review
- All three adapters reuse `computeAdmit`/`computeRecord` (no duplicated logic); identical atomic INSERT→FOR UPDATE→compute→UPDATE algorithm; differ only in ORM transaction/raw-query glue. ✅
- Contract passes against real Postgres (concurrency genuinely tested via FOR UPDATE). ✅
- Packaging mirrors the ecosystem (dual build, correct `.d.cts`, peers not deps). ✅

## Notes for the implementer
- The adapters are persistence shells — never re-implement transitions; only load(locked) → `compute*` → persist.
- The FOR UPDATE lock inside the transaction is what serializes the contract's concurrent admits; verify the three statements run in ONE transaction for each ORM (the testcontainers concurrency case is the proof).
- `rowToState` must tolerate string/BigInt/number numerics (driver-dependent).
- Create the table ONCE in `beforeAll` if a per-store `ensureSchema()` race causes "relation does not exist".
- Run `typecheck` + `test:db` (Docker) before each adapter's commit.
