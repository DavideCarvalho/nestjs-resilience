# @dudousxd/nestjs-resilience-store-redis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first distributed `ResilienceStore` adapter — a Redis-backed circuit-breaker store that passes the shared `runResilienceStoreContract` suite atomically.

**Architecture:** A new workspace package `packages/store-redis` exporting `RedisResilienceStore`, which implements the core `ResilienceStore` interface (`admit`/`record`/`snapshot`) against Redis. State for each circuit lives in a Redis hash `{prefix}{key}` with fields `status`/`failures`/`openUntil`/`probes`. The two compound mutations (`admit`, `record`) run as **atomic Lua scripts** (one Lua call = one atomic Redis operation), which is what gives fleet-wide single-probe half-open and exact failure counting. Time comes from an **injected `Clock`** (passed into the Lua as `now`), never Redis server time — so the store is deterministic and passes the `FakeClock`-driven contract.

**Tech Stack:** TypeScript, ioredis (peer), tsup dual ESM/CJS, vitest, `@testcontainers/redis` for the real-Redis contract run.

## Global Constraints

- **Package name:** `@dudousxd/nestjs-resilience-store-redis`. **Version:** start `0.1.0`.
- **Runtime deps: NONE.** Peers only: `@dudousxd/nestjs-resilience` (`>=0.1.0 <1.0.0`) and `ioredis` (`^5.0.0`). (No `@nestjs/common` peer — this is a plain store class, not a Nest module.)
- **TS config:** extends the repo `tsconfig.base.json` (`strict`, `exactOptionalPropertyTypes`, `module: ESNext`, `moduleResolution: Bundler`, target ES2022). Extensionless relative imports; NO `.js` extensions.
- **Build:** tsup, dual ESM + CJS, `.d.ts` emitted. Ship a `LICENSE` (MIT). Mirror `packages/core`'s `package.json` `exports`/`main`/`module`/`types` shape and the sibling `@dudousxd/nestjs-notifications-redis` package layout.
- **Behavioural parity:** `RedisResilienceStore` MUST produce the exact same observable state transitions as `InMemoryResilienceStore` (`packages/core/src/breaker/in-memory.store.ts`) so it passes the unmodified `runResilienceStoreContract`. Do not change the core contract or interface.
- **Atomicity:** `admit` and `record` MUST each be a single atomic Lua script (`EVAL`/`defineCommand`). No multi-round-trip read-modify-write, no `WATCH/MULTI` needed — one Lua call per operation.
- **Time source:** the injected `Clock.now()` is read in JS at each call and passed into Lua as `ARGV` `now`. Never use Redis `TIME`.
- **Tests:** vitest. The contract runs against real Redis via `@testcontainers/redis` under a separate `test:db` script; it skips cleanly when `SKIP_TESTCONTAINERS` is set. The default `test` script runs only fast no-Docker unit tests.
- **Commits:** end every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

All paths under `/home/dudousxd/personal/oss/nestjs/nestjs-resilience/`.

```
packages/store-redis/
  package.json                      # @dudousxd/nestjs-resilience-store-redis
  tsconfig.json                     # extends ../../tsconfig.base.json
  tsup.config.ts                    # entry src/index.ts, esm+cjs, dts
  vitest.config.ts
  LICENSE                           # MIT (copy packages/core/LICENSE)
  src/
    index.ts                        # barrel: export { RedisResilienceStore } + options type
    lua.ts                          # ADMIT_LUA + RECORD_LUA script string constants
    redis.store.ts                  # RedisResilienceStore implements ResilienceStore
    redis.store.spec.ts             # fast unit test (no Docker): snapshot defaults + key prefix
    redis.store.db.spec.ts          # testcontainers: runResilienceStoreContract against real Redis
.changeset/
  resilience-store-redis-initial.md # minor bump for the new package
```

---

### Task 1: Scaffold the store-redis package

**Files:**
- Create: `packages/store-redis/package.json`, `packages/store-redis/tsconfig.json`, `packages/store-redis/tsup.config.ts`, `packages/store-redis/vitest.config.ts`, `packages/store-redis/LICENSE`, `packages/store-redis/src/index.ts`

**Interfaces:**
- Produces: an installable workspace package that builds (empty barrel) and is resolvable as `@dudousxd/nestjs-resilience-store-redis`.

- [ ] **Step 1: Write `packages/store-redis/package.json`**

```json
{
  "name": "@dudousxd/nestjs-resilience-store-redis",
  "version": "0.1.0",
  "description": "Redis-backed distributed ResilienceStore for @dudousxd/nestjs-resilience",
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
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:db": "vitest run --config vitest.config.ts redis.store.db"
  },
  "peerDependencies": {
    "@dudousxd/nestjs-resilience": ">=0.1.0 <1.0.0",
    "ioredis": "^5.0.0"
  },
  "devDependencies": {
    "@dudousxd/nestjs-resilience": "workspace:^",
    "@testcontainers/redis": "^10.18.0",
    "ioredis": "^5.4.2",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Write `packages/store-redis/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }
```

- [ ] **Step 3: Write `packages/store-redis/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true });
```

- [ ] **Step 4: Write `packages/store-redis/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 180_000 } });
```

- [ ] **Step 5: Copy the LICENSE and write a placeholder barrel**

```bash
cp packages/core/LICENSE packages/store-redis/LICENSE
```

`packages/store-redis/src/index.ts`:
```ts
export {};
```

- [ ] **Step 6: Install + verify the package resolves and builds**

Run: `pnpm install` (workspace root — picks up the new package; `packages/*` glob already covers it).
Then: `pnpm -C packages/store-redis build`
Expected: install succeeds; `dist/` emitted (empty barrel is fine).

- [ ] **Step 7: Commit**

```bash
git add packages/store-redis pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore: scaffold @dudousxd/nestjs-resilience-store-redis package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: RedisResilienceStore + atomic Lua scripts

**Files:**
- Create: `packages/store-redis/src/lua.ts`, `packages/store-redis/src/redis.store.ts`, `packages/store-redis/src/redis.store.spec.ts`
- Modify: `packages/store-redis/src/index.ts`

**Interfaces:**
- Consumes (from `@dudousxd/nestjs-resilience`): the `ResilienceStore` interface and the types `BreakerConfig`, `Admission`, `CircuitSnapshot`, `CircuitStatus`, `Clock`, and `systemClock`.
- Produces:
  - `class RedisResilienceStore implements ResilienceStore` with `constructor(redis: Redis, opts?: { clock?: Clock; keyPrefix?: string })` (default `keyPrefix: 'resilience:cb:'`, default `clock: systemClock`).
  - `interface RedisResilienceStoreOptions { clock?: Clock; keyPrefix?: string }`.

**Parity reference (mirror EXACTLY):** `packages/core/src/breaker/in-memory.store.ts` — `admit` lines 25-40, `record` lines 42-64, `snapshot` lines 66-69. The Lua below is a line-by-line translation of that logic. The only behavioural source of truth is that file; if anything below disagrees with it, the in-memory file wins (and is a bug to report).

- [ ] **Step 1: Write the failing unit test (no Docker)**

This test uses a hand-written minimal fake of the two ioredis methods the store needs for `snapshot` and key-prefixing — it does NOT exercise Lua (that's Task 3). It verifies the no-Redis-state defaults and the key prefix.

`packages/store-redis/src/redis.store.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { RedisResilienceStore } from './redis.store';

// Minimal fake: only the methods snapshot() and defineCommand touch.
function fakeRedis(hmgetReply: (string | null)[]) {
  return {
    defineCommand: vi.fn(),
    cbAdmit: vi.fn(),
    cbRecord: vi.fn(),
    hmget: vi.fn(async (..._args: unknown[]) => hmgetReply),
  };
}

describe('RedisResilienceStore.snapshot', () => {
  it('returns the closed default for a never-seen key (no openUntil field)', async () => {
    const redis = fakeRedis([null, null, null]);
    const store = new RedisResilienceStore(redis as never, { keyPrefix: 'p:' });
    const snap = await store.snapshot('k');
    expect(snap).toEqual({ status: 'closed', failures: 0 });
    expect(snap.openUntil).toBeUndefined();
    // applied the prefix
    expect(redis.hmget).toHaveBeenCalledWith('p:k', 'status', 'failures', 'openUntil');
  });

  it('parses an open snapshot with failures and openUntil', async () => {
    const redis = fakeRedis(['open', '3', '5000']);
    const store = new RedisResilienceStore(redis as never);
    expect(await store.snapshot('k')).toEqual({ status: 'open', failures: 3, openUntil: 5000 });
  });

  it('omits openUntil when it is 0', async () => {
    const redis = fakeRedis(['closed', '0', '0']);
    const store = new RedisResilienceStore(redis as never);
    expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/store-redis test redis.store`
Expected: FAIL (`RedisResilienceStore` not defined).

- [ ] **Step 3: Write the Lua scripts**

`packages/store-redis/src/lua.ts`:
```ts
/**
 * Atomic admit. KEYS[1] = circuit hash. ARGV: now, halfOpenMax.
 * Mirrors InMemoryResilienceStore.admit. Returns {allow(1/0), probe(1/0), status}.
 */
export const ADMIT_LUA = `
local h = KEYS[1]
local now = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local status = redis.call('HGET', h, 'status')
if status == false then status = 'closed' end
local openUntil = tonumber(redis.call('HGET', h, 'openUntil') or '0')
local probes = tonumber(redis.call('HGET', h, 'probes') or '0')

if status == 'open' and now >= openUntil then
  status = 'half-open'
  probes = 0
  redis.call('HSET', h, 'status', 'half-open', 'probes', 0)
end

if status == 'closed' then
  return {1, 0, 'closed'}
end
if status == 'open' then
  return {0, 0, 'open'}
end
if probes < max then
  redis.call('HINCRBY', h, 'probes', 1)
  return {1, 1, 'half-open'}
end
return {0, 0, 'half-open'}
`;

/**
 * Atomic record. KEYS[1] = circuit hash. ARGV: ok(1/0), probe(1/0), now, threshold, cooldownMs.
 * Mirrors InMemoryResilienceStore.record. Returns the resulting status string.
 */
export const RECORD_LUA = `
local h = KEYS[1]
local ok = ARGV[1] == '1'
local probe = ARGV[2] == '1'
local now = tonumber(ARGV[3])
local threshold = tonumber(ARGV[4])
local cooldownMs = tonumber(ARGV[5])

if probe then
  local p = tonumber(redis.call('HGET', h, 'probes') or '0')
  if p > 0 then redis.call('HINCRBY', h, 'probes', -1) end
end

if ok then
  redis.call('HSET', h, 'status', 'closed', 'failures', 0, 'openUntil', 0)
  return 'closed'
end

local status = redis.call('HGET', h, 'status')
if status == false then status = 'closed' end

if probe or status == 'half-open' then
  redis.call('HSET', h, 'status', 'open', 'openUntil', now + cooldownMs)
  return 'open'
end

local failures = redis.call('HINCRBY', h, 'failures', 1)
if failures >= threshold then
  redis.call('HSET', h, 'status', 'open', 'openUntil', now + cooldownMs)
  return 'open'
end
return status
`;
```

- [ ] **Step 4: Write the store**

`packages/store-redis/src/redis.store.ts`:
```ts
import type {
  Admission,
  BreakerConfig,
  CircuitSnapshot,
  CircuitStatus,
  Clock,
  ResilienceStore,
} from '@dudousxd/nestjs-resilience';
import { systemClock } from '@dudousxd/nestjs-resilience';
import type { Redis } from 'ioredis';
import { ADMIT_LUA, RECORD_LUA } from './lua';

export interface RedisResilienceStoreOptions {
  clock?: Clock;
  keyPrefix?: string;
}

/** ioredis client augmented with our two registered Lua commands. */
type WithCommands = Redis & {
  cbAdmit(key: string, now: number, max: number): Promise<[number, number, string]>;
  cbRecord(
    key: string,
    ok: number,
    probe: number,
    now: number,
    threshold: number,
    cooldownMs: number,
  ): Promise<string>;
};

export class RedisResilienceStore implements ResilienceStore {
  private readonly redis: WithCommands;
  private readonly clock: Clock;
  private readonly prefix: string;

  constructor(redis: Redis, opts: RedisResilienceStoreOptions = {}) {
    this.redis = redis as WithCommands;
    this.clock = opts.clock ?? systemClock;
    this.prefix = opts.keyPrefix ?? 'resilience:cb:';
    // Register the scripts once per client (idempotent: skip if already defined).
    if (typeof this.redis.cbAdmit !== 'function') {
      this.redis.defineCommand('cbAdmit', { numberOfKeys: 1, lua: ADMIT_LUA });
    }
    if (typeof this.redis.cbRecord !== 'function') {
      this.redis.defineCommand('cbRecord', { numberOfKeys: 1, lua: RECORD_LUA });
    }
  }

  private k(key: string): string {
    return this.prefix + key;
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const max = cfg.halfOpenMax ?? 1;
    const [allow, probe, status] = await this.redis.cbAdmit(this.k(key), this.clock.now(), max);
    return { allow: allow === 1, probe: probe === 1, status: status as CircuitStatus };
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    const status = await this.redis.cbRecord(
      this.k(key),
      ok ? 1 : 0,
      probe ? 1 : 0,
      this.clock.now(),
      cfg.threshold,
      cfg.cooldownMs,
    );
    return status as CircuitStatus;
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const [status, failures, openUntil] = await this.redis.hmget(
      this.k(key),
      'status',
      'failures',
      'openUntil',
    );
    const ou = openUntil ? Number(openUntil) : 0;
    return {
      status: (status as CircuitStatus) ?? 'closed',
      failures: failures ? Number(failures) : 0,
      ...(ou > 0 ? { openUntil: ou } : {}),
    };
  }
}
```

> Note on the `cbAdmit`/`cbRecord` typing: ioredis' `defineCommand` adds methods dynamically, so we
> cast the client to `WithCommands`. The unit test's fake provides `cbAdmit`/`cbRecord`/`defineCommand`
> stubs so the constructor's `typeof ... !== 'function'` guard sees them as already-defined and the
> cast type-checks. If `exactOptionalPropertyTypes` complains about the snapshot spread, the
> conditional `...(ou > 0 ? { openUntil: ou } : {})` is the correct pattern (already used here).

- [ ] **Step 5: Export from the barrel**

`packages/store-redis/src/index.ts`:
```ts
export { RedisResilienceStore } from './redis.store';
export type { RedisResilienceStoreOptions } from './redis.store';
```

- [ ] **Step 6: Run unit test + typecheck + build**

Run: `pnpm -C packages/store-redis test redis.store`
Expected: PASS (3 snapshot tests).
Run: `pnpm -C packages/store-redis typecheck`
Expected: 0 errors.
Run: `pnpm -C packages/store-redis build`
Expected: `dist/` with `.d.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/store-redis/src
git commit -m "feat(store-redis): RedisResilienceStore with atomic Lua admit/record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Contract suite against real Redis (testcontainers)

**Files:**
- Create: `packages/store-redis/src/redis.store.db.spec.ts`

**Interfaces:**
- Consumes: `runResilienceStoreContract` from `@dudousxd/nestjs-resilience`; `RedisResilienceStore` from `./redis.store`; `RedisContainer`/`StartedRedisContainer` from `@testcontainers/redis`; `Redis` from `ioredis`.

**Why this is the real test:** the unit test in Task 2 never runs Lua. This task runs the *unmodified* core contract (including the concurrent single-probe and concurrent-failure cases) against a real Redis, which is the only way to prove the Lua atomicity. Each `makeStore` call gets a **unique key prefix** so the contract's reuse of key `'k'` across its cases never collides on the shared Redis instance.

- [ ] **Step 1: Write the testcontainers contract spec**

`packages/store-redis/src/redis.store.db.spec.ts`:
```ts
import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe } from 'vitest';
import { RedisResilienceStore } from './redis.store';

// Skips cleanly when SKIP_TESTCONTAINERS is set (e.g. no Docker). Run with `pnpm -C packages/store-redis test:db`.
const skip = !!process.env.SKIP_TESTCONTAINERS;
const suite = skip ? describe.skip : describe;
const CONTAINER_TIMEOUT = 180_000;

suite('RedisResilienceStore (real Redis)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let n = 0;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis({ host: container.getHost(), port: container.getFirstMappedPort() });
  }, CONTAINER_TIMEOUT);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });

  // Fresh key namespace per makeStore call → the contract's reuse of key 'k' is isolated per case.
  runResilienceStoreContract(
    'RedisResilienceStore',
    (clock) => new RedisResilienceStore(redis, { clock, keyPrefix: `t${++n}:` }),
  );
});
```

> **Why `makeStore` works here:** `runResilienceStoreContract` registers a nested `describe` whose `it`
> bodies call `makeStore(new FakeClock())`. Those bodies run *after* `beforeAll`, so `redis` is
> connected by then. The per-call `keyPrefix` (`t1:`, `t2:`, …) namespaces each case. The injected
> `FakeClock` drives cooldown: `clock.advance(1000)` changes what `clock.now()` returns, which the
> store passes into the Lua as `now`, so the open→half-open transition fires exactly as in-memory.

- [ ] **Step 2: Run the contract against real Redis**

Run (requires Docker): `pnpm -C packages/store-redis test:db`
Expected: PASS — all `ResilienceStore contract: RedisResilienceStore` cases green, including:
- `hands exactly one probe to concurrent admits in half-open` (proves Lua atomicity: exactly 1 of 10 concurrent admits gets the probe)
- `counts concurrent failures exactly (no lost updates)`
- `probe success closes fleet-wide; failure re-opens` and `probe failure re-opens the circuit`

Verify the skip path too:
Run: `SKIP_TESTCONTAINERS=1 pnpm -C packages/store-redis test:db`
Expected: the suite is skipped, exit code 0.

> If `test:db` fails on a concurrency case, the Lua is not faithfully mirroring
> `in-memory.store.ts` — diff the two state machines; do NOT relax the contract. If it fails because
> Docker is unavailable, set `SKIP_TESTCONTAINERS=1` (do not delete the test). Report DONE_WITH_CONCERNS
> with the failing output if a concurrency case genuinely fails against real Redis.

- [ ] **Step 3: Commit**

```bash
git add packages/store-redis/src/redis.store.db.spec.ts
git commit -m "test(store-redis): run ResilienceStore contract against real Redis via testcontainers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: README + changeset

**Files:**
- Create: `packages/store-redis/README.md`, `.changeset/resilience-store-redis-initial.md`

**Interfaces:** none (docs/release plumbing).

- [ ] **Step 1: Write `packages/store-redis/README.md`**

A short usage doc that:
1. One-paragraph intro: a distributed Redis-backed `ResilienceStore` for `@dudousxd/nestjs-resilience` so circuit-breaker state is shared fleet-wide; atomic via Lua; deps are `ioredis` + the core as peers.
2. Install: `pnpm add @dudousxd/nestjs-resilience-store-redis ioredis`.
3. Usage — construct and wire into the module:
   ```ts
   import Redis from 'ioredis';
   import { ResilienceModule } from '@dudousxd/nestjs-resilience';
   import { RedisResilienceStore } from '@dudousxd/nestjs-resilience-store-redis';

   ResilienceModule.forRoot({
     store: new RedisResilienceStore(new Redis(process.env.REDIS_URL!)),
   });
   ```
   and a programmatic note that `new RedisResilienceStore(redis, { keyPrefix, clock })` accepts a custom key prefix and `Clock`.
4. A short "How it works" note: per-circuit Redis hash `{prefix}{key}` with `status/failures/openUntil/probes`; `admit` and `record` are atomic Lua scripts; time comes from the injected `Clock` (the app's clock), not Redis server time.
5. Testing note: the package validates itself against the core `runResilienceStoreContract` under `@testcontainers/redis` (`pnpm test:db`, needs Docker; `SKIP_TESTCONTAINERS=1` to skip).

Verify every symbol/option you mention is real against `src/index.ts` and `src/redis.store.ts`.

- [ ] **Step 2: Write the changeset**

`.changeset/resilience-store-redis-initial.md`:
```md
---
"@dudousxd/nestjs-resilience-store-redis": minor
---

Initial release: a distributed Redis-backed ResilienceStore for @dudousxd/nestjs-resilience. Circuit-breaker state (status, failure count, open-until, in-flight probes) is shared fleet-wide in a Redis hash, with `admit` and `record` implemented as atomic Lua scripts (exactly-one half-open probe, no lost updates). Validated against the core ResilienceStore contract suite over real Redis via testcontainers.
```

- [ ] **Step 3: Verify the package still builds**

Run: `pnpm -C packages/store-redis build && pnpm -C packages/store-redis typecheck`
Expected: build emits `dist/`, typecheck 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/store-redis/README.md .changeset/
git commit -m "docs(store-redis): README + initial changeset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Distributed `ResilienceStore` adapter (atomic, Lua) → Tasks 2, 3. ✅
- Passes the shared contract over real Redis (testcontainers) → Task 3. ✅
- Package structure / dual build / peers → Task 1. ✅
- Docs + release → Task 4. ✅

**2. Placeholder scan:** No "TBD/handle edge cases" — the Lua and store are complete; the README is described by mirroring concrete sibling files. ✅

**3. Type consistency:** `RedisResilienceStore` implements `ResilienceStore` (`admit`/`record`/`snapshot`) with the exact core signatures; `BreakerConfig` fields (`threshold`/`cooldownMs`/`halfOpenMax`) and `Admission` (`allow`/`probe`/`status`) match core; `Clock`/`systemClock` imported from the core barrel. The Lua is a line-by-line mirror of `in-memory.store.ts`. ✅

## Notes for the implementer
- **Atomicity is the whole point:** keep each operation a single Lua script. Never split `admit`/`record` into multiple awaited Redis round-trips — that reintroduces the lost-update race the contract checks for.
- **Mirror in-memory exactly.** The contract is unforgiving: any divergence from `in-memory.store.ts`'s state transitions fails a case. When in doubt, re-read that file.
- **Time is injected, not Redis-side.** Read `this.clock.now()` in JS per call and pass it into Lua. This is what makes the `FakeClock`-driven contract pass and avoids depending on Redis clock skew.
- Run `pnpm -C packages/store-redis test && pnpm -C packages/store-redis typecheck` after every task; run `test:db` (Docker) for the real validation in Task 3.
