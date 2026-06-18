# Resilience: shared state-machine + Drizzle (SQLite) store adapter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract the circuit-breaker state machine into pure, reusable functions in core (single source of truth), refactor `InMemoryResilienceStore` to use them, and build the first DB-backed adapter `@dudousxd/nestjs-resilience-store-drizzle` (SQLite via better-sqlite3) that reuses those functions and passes the shared contract.

**Architecture:** Core gains `breaker/state-machine.ts` with two pure functions — `computeAdmit(state,cfg,now)` and `computeRecord(state,cfg,ok,probe,now)` — operating on a plain `CircuitState`. `InMemoryResilienceStore` and every future DB adapter call these inside their own load→compute→persist cycle, so the state machine is written once. The Drizzle adapter persists `CircuitState` in a single SQLite table (`resilience_circuits`), one row per circuit key, and performs each `admit`/`record` inside a synchronous better-sqlite3 transaction (sync run-to-completion gives atomicity, exactly like in-memory).

**Tech Stack:** TypeScript, core (workspace), drizzle-orm + better-sqlite3 (peers/dev), tsup dual ESM/CJS, vitest.

## Global Constraints

- TS: extends `tsconfig.base.json` (strict, exactOptionalPropertyTypes, module ESNext, moduleResolution Bundler). Extensionless relative imports; NO `.js`.
- Core stays zero-runtime-dep; the pure functions add no imports beyond core's own types.
- **Behavioural parity is sacred:** the refactor must not change any observable behaviour — core's 45 tests and the `runResilienceStoreContract` (in-memory) must stay green. The Drizzle adapter must pass the same contract (from `@dudousxd/nestjs-resilience/testing`).
- Drizzle package: name `@dudousxd/nestjs-resilience-store-drizzle`, version `0.1.0`. Peers: `@dudousxd/nestjs-resilience` (`>=0.1.0 <1.0.0`) + `drizzle-orm` (range `^0.36.0 || ^0.37.0 || ^0.38.0 || ^0.39.0 || ^0.40.0 || ^0.41.0 || ^0.42.0 || ^0.43.0 || ^0.44.0`). DevDeps: core (workspace:^), `drizzle-orm`, `better-sqlite3`, `@types/better-sqlite3`. NO testcontainers (SQLite in-memory).
- Dual ESM+CJS tsup; `exports` with correct `import`(`.d.ts`)/`require`(`.d.cts`) condition pairs — double-check the CJS `types` path is `./dist/index.d.cts` (a known footgun).
- Commits end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

```
packages/core/src/breaker/state-machine.ts        # NEW: computeAdmit/computeRecord/INITIAL_CIRCUIT_STATE/CircuitState
packages/core/src/breaker/state-machine.spec.ts   # NEW: direct unit tests for the pure fns
packages/core/src/breaker/in-memory.store.ts       # MODIFY: delegate to state-machine
packages/core/src/index.ts                          # MODIFY: export the pure fns + CircuitState
packages/store-drizzle/                             # NEW package
  package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, LICENSE
  src/index.ts          # barrel
  src/schema.ts         # drizzle sqliteTable resilience_circuits + CIRCUITS_DDL
  src/drizzle.store.ts  # DrizzleResilienceStore
  src/drizzle.store.spec.ts  # contract (SQLite :memory:) + a snapshot unit
```

---

### Task 1: Extract the pure state machine in core

**Files:**
- Create: `packages/core/src/breaker/state-machine.ts`, `packages/core/src/breaker/state-machine.spec.ts`
- Modify: `packages/core/src/breaker/in-memory.store.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Produces: `interface CircuitState { status: CircuitStatus; failures: number; openUntil: number; probes: number }`; `const INITIAL_CIRCUIT_STATE`; `computeAdmit(prev, cfg, now): { state: CircuitState; admission: Admission }`; `computeRecord(prev, cfg, ok, probe, now): { state: CircuitState; status: CircuitStatus }`.

- [ ] **Step 1: Write the pure functions**

`packages/core/src/breaker/state-machine.ts`:
```ts
import type { Admission, BreakerConfig, CircuitStatus } from './types';

/** Plain, serializable circuit state — the unit every store persists. */
export interface CircuitState {
  status: CircuitStatus;
  failures: number;
  openUntil: number;
  probes: number;
}

/** Fresh-circuit defaults (a brand-new key behaves as a closed circuit). */
export const INITIAL_CIRCUIT_STATE: CircuitState = {
  status: 'closed',
  failures: 0,
  openUntil: 0,
  probes: 0,
};

/**
 * Pure admit decision. Given the previous state, the breaker config, and the caller's clock time,
 * returns the next state and the admission. No I/O — stores call this inside their own atomic
 * load→compute→persist cycle.
 */
export function computeAdmit(
  prev: CircuitState,
  cfg: BreakerConfig,
  now: number,
): { state: CircuitState; admission: Admission } {
  let { status, probes } = prev;
  const { failures, openUntil } = prev;
  if (status === 'open' && now >= openUntil) {
    status = 'half-open';
    probes = 0;
  }
  if (status === 'closed') {
    return { state: { status, failures, openUntil, probes }, admission: { allow: true, probe: false, status: 'closed' } };
  }
  if (status === 'open') {
    return { state: { status, failures, openUntil, probes }, admission: { allow: false, probe: false, status: 'open' } };
  }
  const max = cfg.halfOpenMax ?? 1;
  if (probes < max) {
    probes += 1;
    return { state: { status, failures, openUntil, probes }, admission: { allow: true, probe: true, status: 'half-open' } };
  }
  return { state: { status, failures, openUntil, probes }, admission: { allow: false, probe: false, status: 'half-open' } };
}

/**
 * Pure record of an outcome. Returns the next state and the resulting status.
 */
export function computeRecord(
  prev: CircuitState,
  cfg: BreakerConfig,
  ok: boolean,
  probe: boolean,
  now: number,
): { state: CircuitState; status: CircuitStatus } {
  let { status, failures, openUntil, probes } = prev;
  if (probe) probes = Math.max(0, probes - 1);
  if (ok) {
    return { state: { status: 'closed', failures: 0, openUntil: 0, probes }, status: 'closed' };
  }
  if (probe || status === 'half-open') {
    status = 'open';
    openUntil = now + cfg.cooldownMs;
    return { state: { status, failures, openUntil, probes }, status: 'open' };
  }
  failures += 1;
  if (failures >= cfg.threshold) {
    status = 'open';
    openUntil = now + cfg.cooldownMs;
    return { state: { status, failures, openUntil, probes }, status: 'open' };
  }
  return { state: { status, failures, openUntil, probes }, status };
}
```

- [ ] **Step 2: Write direct unit tests**

`packages/core/src/breaker/state-machine.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { type CircuitState, INITIAL_CIRCUIT_STATE, computeAdmit, computeRecord } from './state-machine';
import type { BreakerConfig } from './types';

const cfg: BreakerConfig = { threshold: 3, cooldownMs: 1000 };
const fresh = (): CircuitState => ({ ...INITIAL_CIRCUIT_STATE });

describe('computeRecord', () => {
  it('opens after threshold consecutive failures', () => {
    let s = fresh();
    for (let i = 0; i < 2; i++) s = computeRecord(s, cfg, false, false, 0).state;
    expect(s.failures).toBe(2);
    const r = computeRecord(s, cfg, false, false, 0);
    expect(r.status).toBe('open');
    expect(r.state.openUntil).toBe(1000);
  });

  it('success resets to closed', () => {
    const opened = computeRecord({ status: 'open', failures: 3, openUntil: 1000, probes: 0 }, cfg, true, false, 0);
    expect(opened.status).toBe('closed');
    expect(opened.state).toEqual({ status: 'closed', failures: 0, openUntil: 0, probes: 0 });
  });

  it('probe failure re-opens', () => {
    const r = computeRecord({ status: 'half-open', failures: 3, openUntil: 0, probes: 1 }, cfg, false, true, 500);
    expect(r.status).toBe('open');
    expect(r.state.openUntil).toBe(1500);
    expect(r.state.probes).toBe(0);
  });
});

describe('computeAdmit', () => {
  it('closed allows without a probe', () => {
    expect(computeAdmit(fresh(), cfg, 0).admission).toEqual({ allow: true, probe: false, status: 'closed' });
  });

  it('open denies before cooldown', () => {
    const a = computeAdmit({ status: 'open', failures: 3, openUntil: 1000, probes: 0 }, cfg, 500);
    expect(a.admission).toEqual({ allow: false, probe: false, status: 'open' });
  });

  it('open past cooldown grants exactly one probe; the next admit is denied', () => {
    const open: CircuitState = { status: 'open', failures: 3, openUntil: 1000, probes: 0 };
    const first = computeAdmit(open, cfg, 1000);
    expect(first.admission).toEqual({ allow: true, probe: true, status: 'half-open' });
    const second = computeAdmit(first.state, cfg, 1000);
    expect(second.admission).toEqual({ allow: false, probe: false, status: 'half-open' });
  });
});
```

- [ ] **Step 3: Run the new unit tests**

Run: `pnpm -C packages/core test state-machine`
Expected: PASS.

- [ ] **Step 4: Refactor `InMemoryResilienceStore` to delegate**

Replace the body of `packages/core/src/breaker/in-memory.store.ts` with (keep the file's existing imports for `Clock`/`systemClock`/`ResilienceStore`/types and ADD the state-machine import):
```ts
import { type Clock, systemClock } from '../clock';
import type { ResilienceStore } from './store';
import { type CircuitState, INITIAL_CIRCUIT_STATE, computeAdmit, computeRecord } from './state-machine';
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './types';

export class InMemoryResilienceStore implements ResilienceStore {
  private readonly map = new Map<string, CircuitState>();
  constructor(private readonly clock: Clock = systemClock) {}

  private entry(key: string): CircuitState {
    let e = this.map.get(key);
    if (!e) {
      e = { ...INITIAL_CIRCUIT_STATE };
      this.map.set(key, e);
    }
    return e;
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const { state, admission } = computeAdmit(this.entry(key), cfg, this.clock.now());
    this.map.set(key, state);
    return admission;
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    const { state, status } = computeRecord(this.entry(key), cfg, ok, probe, this.clock.now());
    this.map.set(key, state);
    return status;
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const e = this.entry(key);
    return { status: e.status, failures: e.failures, ...(e.openUntil ? { openUntil: e.openUntil } : {}) };
  }
}
```

- [ ] **Step 5: Export the pure machine from the barrel**

Append to `packages/core/src/index.ts`:
```ts
export { INITIAL_CIRCUIT_STATE, computeAdmit, computeRecord } from './breaker/state-machine';
export type { CircuitState } from './breaker/state-machine';
```

- [ ] **Step 6: Full core gate (parity proof)**

Run: `pnpm -C packages/core test` → all 48 (45 + 3 new) PASS, including the in-memory contract (unchanged behaviour).
Run: `pnpm -C packages/core typecheck` → 0 errors.
Run: `pnpm -C packages/core build` → dist + .d.ts (index + testing entries).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/breaker/state-machine.ts packages/core/src/breaker/state-machine.spec.ts packages/core/src/breaker/in-memory.store.ts packages/core/src/index.ts
git commit -m "refactor(core): extract pure computeAdmit/computeRecord state machine

In-memory store now delegates to the shared pure functions; exported for
custom and DB-backed store adapters to reuse (single source of truth).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scaffold the store-drizzle package

**Files:**
- Create: `packages/store-drizzle/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `LICENSE`, `src/index.ts`

- [ ] **Step 1: `packages/store-drizzle/package.json`**

```json
{
  "name": "@dudousxd/nestjs-resilience-store-drizzle",
  "version": "0.1.0",
  "description": "Drizzle (SQLite) ResilienceStore for @dudousxd/nestjs-resilience",
  "license": "MIT",
  "author": "Davide Carvalho",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "scripts": { "build": "tsup", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" },
  "peerDependencies": {
    "@dudousxd/nestjs-resilience": ">=0.1.0 <1.0.0",
    "drizzle-orm": "^0.36.0 || ^0.37.0 || ^0.38.0 || ^0.39.0 || ^0.40.0 || ^0.41.0 || ^0.42.0 || ^0.43.0 || ^0.44.0"
  },
  "devDependencies": {
    "@dudousxd/nestjs-resilience": "workspace:^",
    "@types/better-sqlite3": "^7.6.11",
    "better-sqlite3": "^11.10.0",
    "drizzle-orm": "^0.44.7",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: tsconfig / tsup / vitest / LICENSE / barrel**

`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }`
`tsup.config.ts`: `import { defineConfig } from 'tsup'; export default defineConfig({ entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true });`
`vitest.config.ts`: `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { testTimeout: 20_000 } });`
`cp packages/core/LICENSE packages/store-drizzle/LICENSE`
`src/index.ts`: `export {};`

- [ ] **Step 3: Install + build**

Run: `pnpm install` (root) — fetches `drizzle-orm`, `better-sqlite3`, `@types/better-sqlite3`. If the registry can't resolve them (offline), STOP + report BLOCKED with the error.
Run: `pnpm -C packages/store-drizzle build` → empty build OK.

- [ ] **Step 4: Commit**

```bash
git add packages/store-drizzle pnpm-lock.yaml
git commit -m "chore: scaffold @dudousxd/nestjs-resilience-store-drizzle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: DrizzleResilienceStore + contract (SQLite)

**Files:**
- Create: `packages/store-drizzle/src/schema.ts`, `src/drizzle.store.ts`, `src/drizzle.store.spec.ts`
- Modify: `packages/store-drizzle/src/index.ts`

**Interfaces:**
- Consumes from `@dudousxd/nestjs-resilience`: `ResilienceStore`, `Clock`, `systemClock`, `CircuitState`, `INITIAL_CIRCUIT_STATE`, `computeAdmit`, `computeRecord`, and the types `Admission`/`BreakerConfig`/`CircuitSnapshot`/`CircuitStatus`. From `@dudousxd/nestjs-resilience/testing`: `runResilienceStoreContract`.
- Produces: `class DrizzleResilienceStore implements ResilienceStore` with `constructor(db: BetterSQLite3Database<typeof schema>, opts?: { clock?: Clock; table?: ... })`; export `circuits` table + `CIRCUITS_DDL`.

- [ ] **Step 1: Write the schema**

`packages/store-drizzle/src/schema.ts`:
```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per circuit key. status/openUntil/probes/failures mirror core's CircuitState. */
export const circuits = sqliteTable('resilience_circuits', {
  key: text('key').primaryKey(),
  status: text('status').notNull(),
  failures: integer('failures').notNull(),
  openUntil: integer('open_until').notNull(),
  probes: integer('probes').notNull(),
});

export const resilienceSchema = { circuits };

/** Raw DDL for tests / manual setup (no migration tool required). */
export const CIRCUITS_DDL = `
CREATE TABLE IF NOT EXISTS resilience_circuits (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  failures INTEGER NOT NULL,
  open_until INTEGER NOT NULL,
  probes INTEGER NOT NULL
);`;
```

- [ ] **Step 2: Write the store**

`packages/store-drizzle/src/drizzle.store.ts`:
```ts
import type {
  Admission,
  BreakerConfig,
  CircuitSnapshot,
  CircuitState,
  CircuitStatus,
  Clock,
  ResilienceStore,
} from '@dudousxd/nestjs-resilience';
import { INITIAL_CIRCUIT_STATE, computeAdmit, computeRecord, systemClock } from '@dudousxd/nestjs-resilience';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { circuits, type resilienceSchema } from './schema';

export interface DrizzleResilienceStoreOptions {
  clock?: Clock;
}

type DB = BetterSQLite3Database<typeof resilienceSchema>;

export class DrizzleResilienceStore implements ResilienceStore {
  private readonly clock: Clock;
  constructor(private readonly db: DB, opts: DrizzleResilienceStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  private load(key: string): CircuitState {
    const row = this.db.select().from(circuits).where(eq(circuits.key, key)).get();
    if (!row) return { ...INITIAL_CIRCUIT_STATE };
    return { status: row.status as CircuitStatus, failures: row.failures, openUntil: row.openUntil, probes: row.probes };
  }

  private persist(key: string, s: CircuitState): void {
    this.db
      .insert(circuits)
      .values({ key, status: s.status, failures: s.failures, openUntil: s.openUntil, probes: s.probes })
      .onConflictDoUpdate({
        target: circuits.key,
        set: { status: s.status, failures: s.failures, openUntil: s.openUntil, probes: s.probes },
      })
      .run();
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    // better-sqlite3 is synchronous: this transaction runs to completion atomically.
    return this.db.transaction((): Admission => {
      const { state, admission } = computeAdmit(this.load(key), cfg, this.clock.now());
      this.persist(key, state);
      return admission;
    });
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    return this.db.transaction((): CircuitStatus => {
      const { state, status } = computeRecord(this.load(key), cfg, ok, probe, this.clock.now());
      this.persist(key, state);
      return status;
    });
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const s = this.load(key);
    return { status: s.status, failures: s.failures, ...(s.openUntil ? { openUntil: s.openUntil } : {}) };
  }
}
```

> Note: `db.transaction(fn)` with the better-sqlite3 driver runs `fn` synchronously and returns its
> value (not a Promise). The `async` methods wrap that sync return — `return this.db.transaction(...)`
> resolves the value. Do NOT pass an `async` callback to `db.transaction` (the sync driver rejects it).
> If typecheck complains the transaction callback can't be async, that confirms you must keep it sync.

- [ ] **Step 3: Barrel**

`packages/store-drizzle/src/index.ts`:
```ts
export { DrizzleResilienceStore } from './drizzle.store';
export type { DrizzleResilienceStoreOptions } from './drizzle.store';
export { circuits, resilienceSchema, CIRCUITS_DDL } from './schema';
```

- [ ] **Step 4: Contract spec (SQLite :memory:)**

`packages/store-drizzle/src/drizzle.store.spec.ts`:
```ts
import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DrizzleResilienceStore } from './drizzle.store';
import { CIRCUITS_DDL, resilienceSchema } from './schema';

// Fresh in-memory SQLite per makeStore call → each contract case is isolated.
runResilienceStoreContract('DrizzleResilienceStore', (clock) => {
  const sqlite = new Database(':memory:');
  sqlite.exec(CIRCUITS_DDL);
  const db = drizzle(sqlite, { schema: resilienceSchema });
  return new DrizzleResilienceStore(db, { clock });
});

describe('DrizzleResilienceStore.snapshot', () => {
  it('returns the closed default for a never-seen key', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(CIRCUITS_DDL);
    const db = drizzle(sqlite, { schema: resilienceSchema });
    const store = new DrizzleResilienceStore(db);
    expect(await store.snapshot('nope')).toEqual({ status: 'closed', failures: 0 });
  });
});
```

- [ ] **Step 5: Gate**

Run: `pnpm -C packages/store-drizzle test` → contract (all cases) + snapshot unit PASS.
Run: `pnpm -C packages/store-drizzle typecheck` → 0 errors.
Run: `pnpm -C packages/store-drizzle build` → dist + .d.ts.

> If a contract case fails, the store is not delegating correctly to `computeAdmit`/`computeRecord`
> or the load/persist round-trips the wrong column. Do NOT relax the contract.

- [ ] **Step 6: Commit**

```bash
git add packages/store-drizzle/src
git commit -m "feat(store-drizzle): DrizzleResilienceStore over SQLite, contract-validated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: store-drizzle README + changeset

**Files:** Create `packages/store-drizzle/README.md`, `.changeset/resilience-store-drizzle-initial.md`

- [ ] **Step 1: README** — mirror `packages/store-redis/README.md`: intro (Drizzle/SQLite-backed ResilienceStore; reuses core's pure state machine; deps drizzle-orm + better-sqlite3), install (`pnpm add @dudousxd/nestjs-resilience-store-drizzle drizzle-orm better-sqlite3`), usage (build the drizzle db with `resilienceSchema`, run `CIRCUITS_DDL` or a drizzle-kit migration, `new DrizzleResilienceStore(db)` into `ResilienceModule.forRoot({ store })`), a "schema" note (the `resilience_circuits` table / `CIRCUITS_DDL`), and a testing note. Verify every symbol against `src/index.ts`.

- [ ] **Step 2: changeset** — `.changeset/resilience-store-drizzle-initial.md`:
```md
---
"@dudousxd/nestjs-resilience-store-drizzle": minor
---

Initial release: a Drizzle (SQLite / better-sqlite3) ResilienceStore for @dudousxd/nestjs-resilience. Circuit state persists in a single `resilience_circuits` table; each admit/record runs in a synchronous transaction reusing core's shared state machine. Validated against the core ResilienceStore contract suite.
```

- [ ] **Step 3:** Verify `pnpm -C packages/store-drizzle build && pnpm -C packages/store-drizzle typecheck`. Commit `README.md` + `.changeset/`.

---

## Self-Review
- Core refactor preserves behaviour (in-memory contract + 45 tests stay green) and exports pure fns. ✅
- Drizzle adapter reuses the pure fns, persists `CircuitState` in one table, passes the same contract. ✅
- Packaging mirrors store-redis (dual build, correct `.d.cts` CJS types). ✅

## Notes for the implementer
- The pure functions are the single source of truth; the Drizzle store must NOT re-implement any transition logic — only load → `compute*` → persist.
- better-sqlite3 is synchronous; the transaction callback must be sync (run-to-completion = atomicity, same guarantee as in-memory). Don't make it async.
- Run `pnpm -C packages/store-drizzle test && pnpm -C packages/store-drizzle typecheck` before each commit.
