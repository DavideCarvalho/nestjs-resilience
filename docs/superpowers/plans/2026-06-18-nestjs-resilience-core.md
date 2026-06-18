# nestjs-resilience (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core package `@dudousxd/nestjs-resilience` — a NestJS-native resilience toolkit (failover, timeout, retry, circuit-breaker) with composable policies, decorators, an injectable service, a pluggable circuit-breaker store, and optional diagnostics/context/event-emitter integration.

**Architecture:** A dependency-free programmatic engine (`Policy.execute(fn)` + `wrap()` + `failover()`), a circuit-breaker state machine behind an atomic `ResilienceStore` (in-memory in core), and NestJS surfaces (decorators via a `DiscoveryService` explorer, a `ResilienceService`, a module) layered on top. Time is abstracted behind a `Clock` for deterministic tests. Observability is emitted over the optional `@dudousxd/nestjs-diagnostics` peer.

**Tech Stack:** TypeScript (NodeNext, strict), pnpm workspace, tsup (dual ESM/CJS), vitest, biome, NestJS (`@nestjs/common`, `@nestjs/core`).

## Global Constraints

- **Package name:** `@dudousxd/nestjs-resilience`. **Version:** start `0.1.0`.
- **Core runtime deps: NONE.** Only `@nestjs/common` + `@nestjs/core` as **peerDependencies**. `@dudousxd/nestjs-diagnostics`, `@dudousxd/nestjs-context`, and `@nestjs/event-emitter` are **optional peerDependencies**, soft-detected — never `import`ed eagerly in a way that throws when absent.
- **TS config:** `strict: true`, `exactOptionalPropertyTypes: true`, `module: NodeNext`, `target: ES2022`. Matches the ecosystem (`tsconfig.base.json` pattern from nestjs-durable/nestjs-notifications).
- **Build:** tsup, dual ESM + CJS, `.d.ts` emitted. Each package ships a `LICENSE` (MIT).
- **Lint/format:** biome (copy `biome.json` from a sibling repo such as `../nestjs-notifications/biome.json`).
- **Diagnostics channel naming:** `aviary:resilience:<event>` via `emit('resilience', '<event>', payload)` from `@dudousxd/nestjs-diagnostics`.
- **Context token:** soft-detect the accessor via `Symbol.for('@dudousxd/nestjs-context:accessor')` (the shared `CONTEXT_ACCESSOR`); never hard-import nestjs-context.
- **Tests:** vitest. No real timers (use the injectable `Clock`/`FakeClock`). No real network.
- **Commits:** end every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

All paths under `/home/dudousxd/personal/oss/nestjs/nestjs-resilience/`.

```
package.json                      # pnpm workspace root
pnpm-workspace.yaml
tsconfig.base.json
biome.json
packages/core/
  package.json                    # @dudousxd/nestjs-resilience
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  LICENSE
  src/
    index.ts                      # public barrel
    clock.ts                      # Clock, SystemClock, FakeClock
    errors.ts                     # TimeoutError, BrokenCircuitError
    policy.ts                     # Policy, PolicyContext, rootContext, neverAbortSignal
    policies/
      timeout.ts                  # timeout()
      retry.ts                    # retry(), exponential()
      wrap.ts                     # wrap()
      circuit-breaker.ts          # circuitBreaker()
      failover.ts                 # failover()
    breaker/
      types.ts                    # BreakerConfig, CircuitStatus, CircuitSnapshot, Admission
      store.ts                    # ResilienceStore interface
      in-memory.store.ts          # InMemoryResilienceStore
      store-contract.ts           # runResilienceStoreContract() shared test suite
    events.ts                     # ResilienceEvent type + ResilienceEmitter abstraction
    integration/
      diagnostics.ts              # soft-detected diagnostics emitter
      context.ts                  # soft-detected tenant accessor
    nest/
      tokens.ts                   # DI tokens
      resilience.service.ts       # ResilienceService
      resilience.module.ts        # ResilienceModule.forRoot/forRootAsync
      decorators.ts               # @Timeout, @Retry, @CircuitBreaker
      explorer.ts                 # DiscoveryService-based method wrapper
```

---

### Task 1: Monorepo + core package scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/vitest.config.ts`, `packages/core/LICENSE`
- Create: `packages/core/src/index.ts`, `packages/core/src/sanity.spec.ts`

**Interfaces:**
- Produces: a buildable, testable workspace. `pnpm -C packages/core test` runs vitest.

- [ ] **Step 1: Write root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`package.json` (root):
```json
{
  "name": "nestjs-resilience-monorepo",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.6.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Copy `biome.json` from `../nestjs-notifications/biome.json` (same settings as the ecosystem).

- [ ] **Step 2: Write the core package files**

`packages/core/package.json`:
```json
{
  "name": "@dudousxd/nestjs-resilience",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" } },
  "files": ["dist", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "peerDependencies": {
    "@nestjs/common": "^10 || ^11",
    "@nestjs/core": "^10 || ^11",
    "@dudousxd/nestjs-diagnostics": ">=0.2.0 <1",
    "@nestjs/event-emitter": "^2 || ^3"
  },
  "peerDependenciesMeta": {
    "@dudousxd/nestjs-diagnostics": { "optional": true },
    "@nestjs/event-emitter": { "optional": true }
  },
  "devDependencies": {
    "@nestjs/common": "^11", "@nestjs/core": "^11", "@nestjs/testing": "^11",
    "@nestjs/platform-express": "^11", "reflect-metadata": "^0.2", "rxjs": "^7",
    "tsup": "^8", "typescript": "^5.6", "vitest": "^3"
  }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, "include": ["src"] }
```

`packages/core/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true });
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, environment: 'node' } });
```

`packages/core/LICENSE`: MIT text (copy from `../nestjs-notifications/LICENSE`).

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 3: Write the sanity test**

`packages/core/src/sanity.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { VERSION } from './index';

describe('scaffold', () => {
  it('exports a version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 4: Install and run**

Run: `pnpm install && pnpm -C packages/core test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm workspace + core package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Clock seam

**Files:**
- Create: `packages/core/src/clock.ts`, `packages/core/src/clock.spec.ts`

**Interfaces:**
- Produces:
  - `interface Clock { now(): number; setTimer(ms: number, cb: () => void): () => void; delay(ms: number, signal?: AbortSignal): Promise<void> }`
  - `class SystemClock implements Clock`
  - `class FakeClock implements Clock { advance(ms: number): void }`
  - `const systemClock: Clock` (singleton)

- [ ] **Step 1: Write the failing test**

`packages/core/src/clock.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from './clock';

describe('FakeClock', () => {
  it('fires timers only after advancing past their delay', () => {
    const clock = new FakeClock();
    const cb = vi.fn();
    clock.setTimer(100, cb);
    clock.advance(99);
    expect(cb).not.toHaveBeenCalled();
    clock.advance(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('cancel() prevents a timer from firing', () => {
    const clock = new FakeClock();
    const cb = vi.fn();
    const cancel = clock.setTimer(10, cb);
    cancel();
    clock.advance(20);
    expect(cb).not.toHaveBeenCalled();
  });

  it('delay() resolves when time advances and rejects on abort', async () => {
    const clock = new FakeClock();
    const resolved = vi.fn();
    clock.delay(50).then(resolved);
    clock.advance(50);
    await Promise.resolve();
    expect(resolved).toHaveBeenCalled();

    const ac = new AbortController();
    const p = clock.delay(50, ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test clock`
Expected: FAIL ("Cannot find module './clock'").

- [ ] **Step 3: Implement**

`packages/core/src/clock.ts`:
```ts
export interface Clock {
  now(): number;
  setTimer(ms: number, cb: () => void): () => void;
  delay(ms: number, signal?: AbortSignal): Promise<void>;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimer(ms: number, cb: () => void): () => void {
    const t = setTimeout(cb, ms);
    return () => clearTimeout(t);
  }
  delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cancel = this.setTimer(ms, resolve);
      signal?.addEventListener(
        'abort',
        () => {
          cancel();
          reject(signal.reason ?? new Error('aborted'));
        },
        { once: true },
      );
    });
  }
}

export const systemClock: Clock = new SystemClock();

interface FakeTimer { at: number; cb: () => void; id: number }

export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: FakeTimer[] = [];

  now(): number {
    return this.t;
  }
  setTimer(ms: number, cb: () => void): () => void {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, cb, id });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  }
  delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cancel = this.setTimer(ms, resolve);
      signal?.addEventListener(
        'abort',
        () => {
          cancel();
          reject(signal.reason ?? new Error('aborted'));
        },
        { once: true },
      );
    });
  }
  /** Advance virtual time, firing any timers that come due (in order). */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at);
      if (due.length === 0) break;
      const next = due[0];
      this.timers = this.timers.filter((x) => x.id !== next.id);
      this.t = next.at;
      next.cb();
    }
    this.t = target;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/core test clock`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/clock.ts packages/core/src/clock.spec.ts
git commit -m "feat(core): injectable Clock with SystemClock + FakeClock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Error types

**Files:**
- Create: `packages/core/src/errors.ts`, `packages/core/src/errors.spec.ts`

**Interfaces:**
- Produces: `class TimeoutError extends Error { readonly ms: number }`, `class BrokenCircuitError extends Error { readonly key: string }`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/errors.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BrokenCircuitError, TimeoutError } from './errors';

describe('errors', () => {
  it('TimeoutError carries ms and is an Error', () => {
    const e = new TimeoutError(500);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('TimeoutError');
    expect(e.ms).toBe(500);
  });
  it('BrokenCircuitError carries the key', () => {
    const e = new BrokenCircuitError('sms:twilio');
    expect(e.name).toBe('BrokenCircuitError');
    expect(e.key).toBe('sms:twilio');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test errors`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/core/src/errors.ts`:
```ts
export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class BrokenCircuitError extends Error {
  constructor(readonly key: string) {
    super(`Circuit "${key}" is open`);
    this.name = 'BrokenCircuitError';
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/core test errors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/errors.spec.ts
git commit -m "feat(core): TimeoutError + BrokenCircuitError

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Policy contract + timeout policy

**Files:**
- Create: `packages/core/src/policy.ts`
- Create: `packages/core/src/policies/timeout.ts`, `packages/core/src/policies/timeout.spec.ts`

**Interfaces:**
- Produces:
  - `interface PolicyContext { signal: AbortSignal; attempt: number }`
  - `type Operation<T> = (ctx: PolicyContext) => Promise<T>`
  - `interface Policy { execute<T>(op: Operation<T>, parent?: PolicyContext): Promise<T> }`
  - `function rootContext(): PolicyContext` (a never-aborting signal, attempt 0)
  - `function timeout(ms: number, opts?: { clock?: Clock }): Policy`
- Consumes: `Clock`, `systemClock`, `TimeoutError`.

- [ ] **Step 1: Write `policy.ts` (no test of its own — exercised via policies)**

`packages/core/src/policy.ts`:
```ts
export interface PolicyContext {
  signal: AbortSignal;
  attempt: number;
}

export type Operation<T> = (ctx: PolicyContext) => Promise<T>;

export interface Policy {
  execute<T>(op: Operation<T>, parent?: PolicyContext): Promise<T>;
}

/** A signal that never aborts — the root of a policy chain. */
export function rootContext(): PolicyContext {
  return { signal: new AbortController().signal, attempt: 0 };
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/policies/timeout.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../clock';
import { TimeoutError } from '../errors';
import { rootContext } from '../policy';
import { timeout } from './timeout';

describe('timeout', () => {
  it('passes through a fast result', async () => {
    const clock = new FakeClock();
    const p = timeout(100, { clock });
    await expect(p.execute(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when the op exceeds ms', async () => {
    const clock = new FakeClock();
    const p = timeout(100, { clock });
    const result = p.execute(() => new Promise(() => {})); // never resolves
    clock.advance(100);
    await expect(result).rejects.toBeInstanceOf(TimeoutError);
  });

  it('aborts the op signal on timeout', async () => {
    const clock = new FakeClock();
    const p = timeout(100, { clock });
    let aborted = false;
    const result = p.execute(
      (ctx) =>
        new Promise<never>((_, reject) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
            reject(ctx.signal.reason);
          });
        }),
    );
    clock.advance(100);
    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it('links the parent signal — aborting the parent aborts the op', async () => {
    const clock = new FakeClock();
    const parentAc = new AbortController();
    const p = timeout(1000, { clock });
    const result = p.execute(
      (ctx) => new Promise<never>((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))),
      { signal: parentAc.signal, attempt: 0 },
    );
    parentAc.abort(new Error('parent gone'));
    await expect(result).rejects.toThrow('parent gone');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm -C packages/core test timeout`
Expected: FAIL.

- [ ] **Step 4: Implement**

`packages/core/src/policies/timeout.ts`:
```ts
import { type Clock, systemClock } from '../clock';
import { TimeoutError } from '../errors';
import { type Operation, type Policy, type PolicyContext, rootContext } from '../policy';

export function timeout(ms: number, opts: { clock?: Clock } = {}): Policy {
  const clock = opts.clock ?? systemClock;
  return {
    execute<T>(op: Operation<T>, parent: PolicyContext = rootContext()): Promise<T> {
      const ac = new AbortController();
      const onParentAbort = () => ac.abort(parent.signal.reason);
      if (parent.signal.aborted) ac.abort(parent.signal.reason);
      else parent.signal.addEventListener('abort', onParentAbort, { once: true });

      const cancelTimer = clock.setTimer(ms, () => ac.abort(new TimeoutError(ms)));
      const ctx: PolicyContext = { signal: ac.signal, attempt: parent.attempt };

      const aborted = new Promise<never>((_, reject) => {
        ac.signal.addEventListener('abort', () => reject(ac.signal.reason ?? new TimeoutError(ms)), { once: true });
      });

      return Promise.race([op(ctx), aborted]).finally(() => {
        cancelTimer();
        parent.signal.removeEventListener('abort', onParentAbort);
      });
    },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/core test timeout`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/policy.ts packages/core/src/policies/timeout.ts packages/core/src/policies/timeout.spec.ts
git commit -m "feat(core): Policy contract + timeout policy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: retry policy + backoff

**Files:**
- Create: `packages/core/src/policies/retry.ts`, `packages/core/src/policies/retry.spec.ts`

**Interfaces:**
- Produces:
  - `type Backoff = (attempt: number) => number`
  - `function exponential(baseMs: number, opts?: { jitter?: boolean; factor?: number }): Backoff`
  - `function retry(opts: { attempts: number; backoff?: Backoff; clock?: Clock }): Policy`
- Consumes: `Clock`, `Policy`, `Operation`, `rootContext`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/policies/retry.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../clock';
import { exponential, retry } from './retry';

describe('retry', () => {
  it('returns the first success without retrying', async () => {
    const op = vi.fn(async () => 'ok');
    await expect(retry({ attempts: 3 }).execute(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledOnce();
  });

  it('retries up to `attempts` then rethrows the last error', async () => {
    const op = vi.fn(async () => {
      throw new Error('boom');
    });
    const clock = new FakeClock();
    const p = retry({ attempts: 3, backoff: () => 10, clock });
    const result = p.execute(op);
    // drive the two backoff delays
    await Promise.resolve();
    clock.advance(10);
    await Promise.resolve();
    clock.advance(10);
    await expect(result).rejects.toThrow('boom');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('exposes the 0-based attempt number to the op', async () => {
    const seen: number[] = [];
    const clock = new FakeClock();
    const op = vi.fn(async (ctx: { attempt: number }) => {
      seen.push(ctx.attempt);
      if (ctx.attempt < 2) throw new Error('again');
      return 'ok';
    });
    const result = retry({ attempts: 5, backoff: () => 1, clock }).execute(op);
    await Promise.resolve();
    clock.advance(1);
    await Promise.resolve();
    clock.advance(1);
    await expect(result).resolves.toBe('ok');
    expect(seen).toEqual([0, 1, 2]);
  });

  it('exponential() grows by factor', () => {
    const b = exponential(100, { factor: 2 });
    expect(b(0)).toBe(100);
    expect(b(1)).toBe(200);
    expect(b(2)).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test retry`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/core/src/policies/retry.ts`:
```ts
import { type Clock, systemClock } from '../clock';
import { type Operation, type Policy, type PolicyContext, rootContext } from '../policy';

export type Backoff = (attempt: number) => number;

export function exponential(baseMs: number, opts: { jitter?: boolean; factor?: number } = {}): Backoff {
  const factor = opts.factor ?? 2;
  return (attempt) => {
    const raw = baseMs * factor ** attempt;
    if (!opts.jitter) return raw;
    // full jitter: a deterministic-enough spread without Math.random in tests is fine in prod
    return Math.round(raw * (0.5 + Math.random() / 2));
  };
}

export function retry(opts: { attempts: number; backoff?: Backoff; clock?: Clock }): Policy {
  const clock = opts.clock ?? systemClock;
  const backoff = opts.backoff ?? (() => 0);
  return {
    async execute<T>(op: Operation<T>, parent: PolicyContext = rootContext()): Promise<T> {
      let last: unknown;
      for (let attempt = 0; attempt < opts.attempts; attempt++) {
        try {
          return await op({ signal: parent.signal, attempt });
        } catch (err) {
          last = err;
          if (attempt < opts.attempts - 1) await clock.delay(backoff(attempt), parent.signal);
        }
      }
      throw last;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/core test retry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policies/retry.ts packages/core/src/policies/retry.spec.ts
git commit -m "feat(core): retry policy + exponential backoff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: wrap() composition

**Files:**
- Create: `packages/core/src/policies/wrap.ts`, `packages/core/src/policies/wrap.spec.ts`

**Interfaces:**
- Produces: `function wrap(...policies: Policy[]): Policy` — composes outer→inner (first arg outermost).
- Consumes: `Policy`, `Operation`, `rootContext`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/policies/wrap.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../clock';
import { TimeoutError } from '../errors';
import { retry } from './retry';
import { timeout } from './timeout';
import { wrap } from './wrap';

describe('wrap', () => {
  it('runs outer→inner: retry around timeout retries a timed-out op', async () => {
    const clock = new FakeClock();
    let calls = 0;
    const op = vi.fn(async (ctx: { signal: AbortSignal }) => {
      calls++;
      if (calls < 2) {
        // first call hangs until aborted by the timeout
        await new Promise<never>((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason)));
      }
      return 'ok';
    });
    const policy = wrap(retry({ attempts: 3, backoff: () => 5, clock }), timeout(100, { clock }));
    const result = policy.execute(op);
    clock.advance(100); // first attempt times out
    await Promise.resolve();
    clock.advance(5); // backoff
    await expect(result).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('an empty wrap just runs the op', async () => {
    await expect(wrap().execute(async () => 42)).resolves.toBe(42);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test wrap`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/core/src/policies/wrap.ts`:
```ts
import { type Operation, type Policy, type PolicyContext, rootContext } from '../policy';

export function wrap(...policies: Policy[]): Policy {
  return {
    execute<T>(op: Operation<T>, parent: PolicyContext = rootContext()): Promise<T> {
      const composed = policies.reduceRight<Operation<T>>(
        (innerOp, policy) => (ctx) => policy.execute(innerOp, ctx),
        op,
      );
      return composed(parent);
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/core test wrap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policies/wrap.ts packages/core/src/policies/wrap.spec.ts
git commit -m "feat(core): wrap() policy composition

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Breaker types + ResilienceStore + in-memory store (state machine)

**Files:**
- Create: `packages/core/src/breaker/types.ts`, `packages/core/src/breaker/store.ts`
- Create: `packages/core/src/breaker/in-memory.store.ts`, `packages/core/src/breaker/in-memory.store.spec.ts`

**Interfaces:**
- Produces:
  - `type CircuitStatus = 'closed' | 'open' | 'half-open'`
  - `interface CircuitSnapshot { status: CircuitStatus; failures: number; openUntil?: number }`
  - `interface BreakerConfig { threshold: number; cooldownMs: number; halfOpenMax?: number }`
  - `interface Admission { allow: boolean; probe: boolean; status: CircuitStatus }`
  - `interface ResilienceStore { admit(key, cfg): Promise<Admission>; record(key, cfg, ok, probe): Promise<CircuitStatus>; snapshot(key): Promise<CircuitSnapshot> }`
  - `class InMemoryResilienceStore implements ResilienceStore` (constructor `(clock?: Clock)`)
- Consumes: `Clock`, `systemClock`.

- [ ] **Step 1: Write types + store interface**

`packages/core/src/breaker/types.ts`:
```ts
export type CircuitStatus = 'closed' | 'open' | 'half-open';

export interface CircuitSnapshot {
  status: CircuitStatus;
  failures: number;
  openUntil?: number;
}

export interface BreakerConfig {
  threshold: number;
  cooldownMs: number;
  /** Max concurrent probes allowed in half-open. Default 1. */
  halfOpenMax?: number;
}

export interface Admission {
  allow: boolean;
  probe: boolean;
  status: CircuitStatus;
}
```

`packages/core/src/breaker/store.ts`:
```ts
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './types';

export interface ResilienceStore {
  /** Decide whether a call may proceed; atomically flip open→half-open after cooldown and hand the
   *  probe slot to one caller. */
  admit(key: string, cfg: BreakerConfig): Promise<Admission>;
  /** Record an outcome; atomically update counters/state and return the resulting status. */
  record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus>;
  /** Read-only snapshot. */
  snapshot(key: string): Promise<CircuitSnapshot>;
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/breaker/in-memory.store.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../clock';
import { InMemoryResilienceStore } from './in-memory.store';
import type { BreakerConfig } from './types';

const cfg: BreakerConfig = { threshold: 3, cooldownMs: 1000 };

describe('InMemoryResilienceStore', () => {
  it('starts closed and admits', async () => {
    const s = new InMemoryResilienceStore(new FakeClock());
    expect(await s.admit('k', cfg)).toEqual({ allow: true, probe: false, status: 'closed' });
  });

  it('opens after `threshold` failures and then short-circuits', async () => {
    const clock = new FakeClock();
    const s = new InMemoryResilienceStore(clock);
    await s.record('k', cfg, false, false);
    await s.record('k', cfg, false, false);
    expect(await s.record('k', cfg, false, false)).toBe('open');
    const a = await s.admit('k', cfg);
    expect(a.allow).toBe(false);
    expect((await s.snapshot('k')).status).toBe('open');
  });

  it('a success resets the failure count', async () => {
    const s = new InMemoryResilienceStore(new FakeClock());
    await s.record('k', cfg, false, false);
    await s.record('k', cfg, true, false);
    expect((await s.snapshot('k')).failures).toBe(0);
  });

  it('after cooldown, admit hands exactly one caller the probe', async () => {
    const clock = new FakeClock();
    const s = new InMemoryResilienceStore(clock);
    for (let i = 0; i < 3; i++) await s.record('k', cfg, false, false);
    clock.advance(1000);
    const a1 = await s.admit('k', cfg);
    const a2 = await s.admit('k', cfg);
    expect([a1.probe, a2.probe].filter(Boolean)).toHaveLength(1);
    expect(a1.status).toBe('half-open');
  });

  it('probe success closes; probe failure re-opens', async () => {
    const clock = new FakeClock();
    const s = new InMemoryResilienceStore(clock);
    for (let i = 0; i < 3; i++) await s.record('k', cfg, false, false);
    clock.advance(1000);
    await s.admit('k', cfg); // claim the probe
    expect(await s.record('k', cfg, true, true)).toBe('closed');

    for (let i = 0; i < 3; i++) await s.record('k', cfg, false, false);
    clock.advance(1000);
    await s.admit('k', cfg);
    expect(await s.record('k', cfg, false, true)).toBe('open');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm -C packages/core test in-memory`
Expected: FAIL.

- [ ] **Step 4: Implement**

`packages/core/src/breaker/in-memory.store.ts`:
```ts
import { type Clock, systemClock } from '../clock';
import type { ResilienceStore } from './store';
import type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './types';

interface Entry {
  status: CircuitStatus;
  failures: number;
  openUntil: number;
  probes: number; // probes currently in flight (half-open)
}

export class InMemoryResilienceStore implements ResilienceStore {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly clock: Clock = systemClock) {}

  private entry(key: string): Entry {
    let e = this.map.get(key);
    if (!e) {
      e = { status: 'closed', failures: 0, openUntil: 0, probes: 0 };
      this.map.set(key, e);
    }
    return e;
  }

  async admit(key: string, cfg: BreakerConfig): Promise<Admission> {
    const e = this.entry(key);
    if (e.status === 'open' && this.clock.now() >= e.openUntil) {
      e.status = 'half-open';
      e.probes = 0;
    }
    if (e.status === 'closed') return { allow: true, probe: false, status: 'closed' };
    if (e.status === 'open') return { allow: false, probe: false, status: 'open' };
    // half-open: hand out up to halfOpenMax probes
    const max = cfg.halfOpenMax ?? 1;
    if (e.probes < max) {
      e.probes++;
      return { allow: true, probe: true, status: 'half-open' };
    }
    return { allow: false, probe: false, status: 'half-open' };
  }

  async record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus> {
    const e = this.entry(key);
    if (probe) e.probes = Math.max(0, e.probes - 1);
    if (ok) {
      e.status = 'closed';
      e.failures = 0;
      e.openUntil = 0;
      return 'closed';
    }
    // failure
    if (probe || e.status === 'half-open') {
      e.status = 'open';
      e.openUntil = this.clock.now() + cfg.cooldownMs;
      return 'open';
    }
    e.failures++;
    if (e.failures >= cfg.threshold) {
      e.status = 'open';
      e.openUntil = this.clock.now() + cfg.cooldownMs;
      return 'open';
    }
    return e.status;
  }

  async snapshot(key: string): Promise<CircuitSnapshot> {
    const e = this.entry(key);
    return { status: e.status, failures: e.failures, openUntil: e.openUntil || undefined };
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/core test in-memory`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/breaker/
git commit -m "feat(core): ResilienceStore + InMemoryResilienceStore state machine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: circuitBreaker policy

**Files:**
- Create: `packages/core/src/events.ts`
- Create: `packages/core/src/policies/circuit-breaker.ts`, `packages/core/src/policies/circuit-breaker.spec.ts`

**Interfaces:**
- Produces:
  - `type ResilienceEvent = { type: 'circuit-opened'|'circuit-closed'|'circuit-half-open'|'short-circuited'|'failover'|'timeout'|'retry'; key?: string; [k: string]: unknown }`
  - `type EventSink = (e: ResilienceEvent) => void`
  - `function circuitBreaker(opts: { key: string; store: ResilienceStore; threshold: number; cooldownMs: number; halfOpenMax?: number; onEvent?: EventSink }): Policy`
- Consumes: `ResilienceStore`, `BrokenCircuitError`, `Policy`, `Operation`, `rootContext`.

- [ ] **Step 1: Write events.ts**

`packages/core/src/events.ts`:
```ts
export type ResilienceEventType =
  | 'circuit-opened'
  | 'circuit-closed'
  | 'circuit-half-open'
  | 'short-circuited'
  | 'failover'
  | 'timeout'
  | 'retry';

export interface ResilienceEvent {
  type: ResilienceEventType;
  key?: string;
  [extra: string]: unknown;
}

export type EventSink = (event: ResilienceEvent) => void;

export const noopSink: EventSink = () => {};
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/policies/circuit-breaker.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { InMemoryResilienceStore } from '../breaker/in-memory.store';
import { FakeClock } from '../clock';
import { BrokenCircuitError } from '../errors';
import { circuitBreaker } from './circuit-breaker';

const base = (store: InMemoryResilienceStore) => ({ key: 'k', store, threshold: 3, cooldownMs: 1000 });

describe('circuitBreaker', () => {
  it('passes successes through', async () => {
    const store = new InMemoryResilienceStore(new FakeClock());
    await expect(circuitBreaker(base(store)).execute(async () => 'ok')).resolves.toBe('ok');
  });

  it('opens after threshold failures and then short-circuits with BrokenCircuitError', async () => {
    const store = new InMemoryResilienceStore(new FakeClock());
    const p = circuitBreaker(base(store));
    for (let i = 0; i < 3; i++) await p.execute(async () => { throw new Error('boom'); }).catch(() => {});
    await expect(p.execute(async () => 'should-not-run')).rejects.toBeInstanceOf(BrokenCircuitError);
  });

  it('emits circuit-opened / short-circuited / circuit-closed', async () => {
    const clock = new FakeClock();
    const store = new InMemoryResilienceStore(clock);
    const onEvent = vi.fn();
    const p = circuitBreaker({ ...base(store), onEvent });
    for (let i = 0; i < 3; i++) await p.execute(async () => { throw new Error('x'); }).catch(() => {});
    await p.execute(async () => 'x').catch(() => {});
    clock.advance(1000);
    await p.execute(async () => 'ok'); // probe succeeds → closed
    const types = onEvent.mock.calls.map((c) => c[0].type);
    expect(types).toContain('circuit-opened');
    expect(types).toContain('short-circuited');
    expect(types).toContain('circuit-closed');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm -C packages/core test circuit-breaker`
Expected: FAIL.

- [ ] **Step 4: Implement**

`packages/core/src/policies/circuit-breaker.ts`:
```ts
import type { ResilienceStore } from '../breaker/store';
import { BrokenCircuitError } from '../errors';
import { type EventSink, noopSink } from '../events';
import { type Operation, type Policy, type PolicyContext, rootContext } from '../policy';

export interface CircuitBreakerOptions {
  key: string;
  store: ResilienceStore;
  threshold: number;
  cooldownMs: number;
  halfOpenMax?: number;
  onEvent?: EventSink;
}

export function circuitBreaker(opts: CircuitBreakerOptions): Policy {
  const onEvent: EventSink = opts.onEvent ?? noopSink;
  const cfg = { threshold: opts.threshold, cooldownMs: opts.cooldownMs, halfOpenMax: opts.halfOpenMax };
  return {
    async execute<T>(op: Operation<T>, parent: PolicyContext = rootContext()): Promise<T> {
      const admission = await opts.store.admit(opts.key, cfg);
      if (admission.status === 'half-open' && admission.probe) onEvent({ type: 'circuit-half-open', key: opts.key });
      if (!admission.allow) {
        onEvent({ type: 'short-circuited', key: opts.key });
        throw new BrokenCircuitError(opts.key);
      }
      try {
        const result = await op({ signal: parent.signal, attempt: parent.attempt });
        const status = await opts.store.record(opts.key, cfg, true, admission.probe);
        if (status === 'closed' && admission.probe) onEvent({ type: 'circuit-closed', key: opts.key });
        return result;
      } catch (err) {
        const status = await opts.store.record(opts.key, cfg, false, admission.probe);
        if (status === 'open') onEvent({ type: 'circuit-opened', key: opts.key });
        throw err;
      }
    },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/core test circuit-breaker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events.ts packages/core/src/policies/circuit-breaker.ts packages/core/src/policies/circuit-breaker.spec.ts
git commit -m "feat(core): circuitBreaker policy with event sink

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: failover

**Files:**
- Create: `packages/core/src/policies/failover.ts`, `packages/core/src/policies/failover.spec.ts`

**Interfaces:**
- Produces:
  - `function failover<TTarget, R>(opts: { targets: TTarget[]; run: (target: TTarget, ctx: PolicyContext) => Promise<R>; policy?: (target: TTarget) => Policy; onFailover?: (target: TTarget, error: unknown, index: number) => void; onEvent?: EventSink }): Promise<R>`
- Consumes: `Policy`, `PolicyContext`, `rootContext`, `EventSink`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/policies/failover.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { failover } from './failover';

describe('failover', () => {
  it('returns the first target that succeeds', async () => {
    const result = await failover({
      targets: ['a', 'b', 'c'],
      run: async (t) => {
        if (t === 'a') throw new Error('a down');
        return `sent via ${t}`;
      },
    });
    expect(result).toBe('sent via b');
  });

  it('throws the last error when all fail, and calls onFailover per failure', async () => {
    const onFailover = vi.fn();
    await expect(
      failover({
        targets: ['a', 'b'],
        run: async (t) => {
          throw new Error(`${t} down`);
        },
        onFailover,
      }),
    ).rejects.toThrow('b down');
    expect(onFailover).toHaveBeenCalledTimes(2);
  });

  it('throws synchronously-rejecting on empty targets', async () => {
    await expect(failover({ targets: [], run: async () => 'x' })).rejects.toThrow(/at least one/i);
  });

  it('applies a per-target policy', async () => {
    const policy = vi.fn(() => ({ execute: <T>(op: any) => op({ signal: new AbortController().signal, attempt: 0 }) }));
    await failover({ targets: ['a'], run: async () => 'ok', policy });
    expect(policy).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test failover`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/core/src/policies/failover.ts`:
```ts
import { type EventSink, noopSink } from '../events';
import { type Policy, type PolicyContext, rootContext } from '../policy';

export interface FailoverOptions<TTarget, R> {
  targets: TTarget[];
  run: (target: TTarget, ctx: PolicyContext) => Promise<R>;
  policy?: (target: TTarget) => Policy;
  onFailover?: (target: TTarget, error: unknown, index: number) => void;
  onEvent?: EventSink;
}

export async function failover<TTarget, R>(opts: FailoverOptions<TTarget, R>): Promise<R> {
  if (opts.targets.length === 0) throw new Error('failover() needs at least one target.');
  const onEvent: EventSink = opts.onEvent ?? noopSink;
  let last: unknown;
  for (let i = 0; i < opts.targets.length; i++) {
    const target = opts.targets[i] as TTarget;
    const run = (ctx: PolicyContext) => opts.run(target, ctx);
    try {
      const policy = opts.policy?.(target);
      return policy ? await policy.execute(run) : await run(rootContext());
    } catch (err) {
      last = err;
      opts.onFailover?.(target, err, i);
      onEvent({ type: 'failover', target: String(target), index: i, error: err });
    }
  }
  throw last;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C packages/core test failover`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/policies/failover.ts packages/core/src/policies/failover.spec.ts
git commit -m "feat(core): failover() over an ordered target list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: ResilienceStore contract test suite

**Files:**
- Create: `packages/core/src/breaker/store-contract.ts`
- Create: `packages/core/src/breaker/in-memory.contract.spec.ts`

**Interfaces:**
- Produces: `function runResilienceStoreContract(name: string, makeStore: (clock: Clock) => ResilienceStore): void` — a reusable describe-block that adapter packages import.
- Consumes: `ResilienceStore`, `Clock`, `FakeClock`.

- [ ] **Step 1: Write the contract suite**

`packages/core/src/breaker/store-contract.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { type Clock, FakeClock } from '../clock';
import type { ResilienceStore } from './store';
import type { BreakerConfig } from './types';

const cfg: BreakerConfig = { threshold: 3, cooldownMs: 1000 };

/** Shared behavioural contract every ResilienceStore adapter must satisfy. */
export function runResilienceStoreContract(name: string, makeStore: (clock: Clock) => ResilienceStore): void {
  describe(`ResilienceStore contract: ${name}`, () => {
    it('opens after threshold and short-circuits', async () => {
      const s = makeStore(new FakeClock());
      for (let i = 0; i < 3; i++) await s.record('k', cfg, false, false);
      expect((await s.admit('k', cfg)).allow).toBe(false);
    });

    it('hands exactly one probe to concurrent admits in half-open', async () => {
      const clock = new FakeClock();
      const s = makeStore(clock);
      for (let i = 0; i < 3; i++) await s.record('k', cfg, false, false);
      clock.advance(1000);
      const admissions = await Promise.all(Array.from({ length: 10 }, () => s.admit('k', cfg)));
      expect(admissions.filter((a) => a.probe)).toHaveLength(1);
    });

    it('counts concurrent failures exactly (no lost updates)', async () => {
      const s = makeStore(new FakeClock());
      // 2 concurrent failures keep it closed (threshold 3), the 3rd opens it
      await Promise.all([s.record('k', cfg, false, false), s.record('k', cfg, false, false)]);
      expect((await s.snapshot('k')).failures).toBe(2);
      await s.record('k', cfg, false, false);
      expect((await s.snapshot('k')).status).toBe('open');
    });

    it('probe success closes fleet-wide; failure re-opens', async () => {
      const clock = new FakeClock();
      const s = makeStore(clock);
      for (let i = 0; i < 3; i++) await s.record('k', cfg, false, false);
      clock.advance(1000);
      await s.admit('k', cfg);
      expect(await s.record('k', cfg, true, true)).toBe('closed');
    });
  });
}
```

- [ ] **Step 2: Run the contract against the in-memory store**

`packages/core/src/breaker/in-memory.contract.spec.ts`:
```ts
import { InMemoryResilienceStore } from './in-memory.store';
import { runResilienceStoreContract } from './store-contract';

runResilienceStoreContract('InMemoryResilienceStore', (clock) => new InMemoryResilienceStore(clock));
```

- [ ] **Step 3: Run**

Run: `pnpm -C packages/core test contract`
Expected: PASS (the in-memory store satisfies the contract). If the "concurrent failures" test fails, the in-memory store's `record` is doing a non-atomic read-modify-write across awaits — make `record` synchronous internally (it is, in Task 7) so JS run-to-completion guarantees atomicity.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/breaker/store-contract.ts packages/core/src/breaker/in-memory.contract.spec.ts
git commit -m "test(core): shared ResilienceStore contract suite

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Soft-detected integrations (diagnostics emitter + context tenant) + barrel export

**Files:**
- Create: `packages/core/src/integration/diagnostics.ts`, `packages/core/src/integration/context.ts`
- Create: `packages/core/src/integration/diagnostics.spec.ts`
- Modify: `packages/core/src/index.ts` (full public barrel)

**Interfaces:**
- Produces:
  - `function diagnosticsSink(): EventSink` — emits each `ResilienceEvent` over `@dudousxd/nestjs-diagnostics` if installed, else a no-op. Uses `emit('resilience', event.type, event)`.
  - `function tenantSuffix(): string | undefined` — reads the tenant from the context accessor if present.
- Consumes: `EventSink`, `ResilienceEvent`.

- [ ] **Step 1: Write the failing test (diagnostics emission, optional-dep safe)**

`packages/core/src/integration/diagnostics.spec.ts`:
```ts
import diagnostics_channel from 'node:diagnostics_channel';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnosticsSink } from './diagnostics';

describe('diagnosticsSink', () => {
  const channel = 'aviary:resilience:circuit-opened';
  const seen: unknown[] = [];
  const handler = (msg: unknown) => seen.push(msg);

  afterEach(() => {
    diagnostics_channel.unsubscribe(channel, handler);
    seen.length = 0;
  });

  it('publishes a resilience event over the diagnostics channel when subscribed', () => {
    diagnostics_channel.subscribe(channel, handler);
    diagnosticsSink()({ type: 'circuit-opened', key: 'sms:twilio', failures: 3 });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { payload: { event: string } }).payload.event).toBe('circuit-opened');
  });

  it('is a no-op when nobody is subscribed (never throws)', () => {
    expect(() => diagnosticsSink()({ type: 'timeout', key: 'k', ms: 100 })).not.toThrow();
  });
});
```

> Note: `@dudousxd/nestjs-diagnostics`'s `emit` only publishes when subscribed, and uses Node's
> `diagnostics_channel` under the hood, so the test subscribes directly to the raw channel name
> `aviary:resilience:circuit-opened` (= `aviary:<lib>:<event>`). In this monorepo, add
> `@dudousxd/nestjs-diagnostics` as a **devDependency** so the import resolves in tests.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test diagnostics`
Expected: FAIL.

- [ ] **Step 3: Implement the soft-detected emitter + context**

`packages/core/src/integration/diagnostics.ts`:
```ts
import type { EventSink } from '../events';

type EmitFn = (lib: string, event: string, payload: unknown) => void;

let cached: EmitFn | null | undefined;

/** Resolve nestjs-diagnostics' `emit` lazily; cache null when absent so we never re-require. */
function resolveEmit(): EmitFn | null {
  if (cached !== undefined) return cached;
  try {
    // Indirected require so bundlers don't hard-fail when the optional peer is missing.
    const mod = (eval('require') as NodeRequire)('@dudousxd/nestjs-diagnostics') as { emit: EmitFn };
    cached = typeof mod.emit === 'function' ? mod.emit : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function diagnosticsSink(): EventSink {
  return (event) => {
    const emit = resolveEmit();
    if (!emit) return;
    emit('resilience', event.type, event);
  };
}

/** Test-only reset of the cached emit resolution. */
export function __resetDiagnosticsCache(): void {
  cached = undefined;
}
```

`packages/core/src/integration/context.ts`:
```ts
const CONTEXT_ACCESSOR = Symbol.for('@dudousxd/nestjs-context:accessor');

interface ContextAccessor {
  get(): { tenantId?: string } | undefined;
}

/** Read the current tenant from nestjs-context if its accessor is registered, else undefined. */
export function tenantSuffix(): string | undefined {
  const accessor = (globalThis as Record<symbol, unknown>)[CONTEXT_ACCESSOR] as ContextAccessor | undefined;
  return accessor?.get?.()?.tenantId;
}
```

- [ ] **Step 4: Write the public barrel**

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';

export type { Clock } from './clock';
export { FakeClock, SystemClock, systemClock } from './clock';
export { BrokenCircuitError, TimeoutError } from './errors';
export type { EventSink, ResilienceEvent, ResilienceEventType } from './events';
export type { Operation, Policy, PolicyContext } from './policy';
export { rootContext } from './policy';
export { timeout } from './policies/timeout';
export { type Backoff, exponential, retry } from './policies/retry';
export { wrap } from './policies/wrap';
export { type CircuitBreakerOptions, circuitBreaker } from './policies/circuit-breaker';
export { type FailoverOptions, failover } from './policies/failover';
export type { ResilienceStore } from './breaker/store';
export type { Admission, BreakerConfig, CircuitSnapshot, CircuitStatus } from './breaker/types';
export { InMemoryResilienceStore } from './breaker/in-memory.store';
export { runResilienceStoreContract } from './breaker/store-contract';
export { diagnosticsSink } from './integration/diagnostics';
export { tenantSuffix } from './integration/context';
```

- [ ] **Step 5: Run + build**

Run: `pnpm -C packages/core test && pnpm -C packages/core build`
Expected: all tests pass; `dist/` emitted with `.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/integration packages/core/src/index.ts
git commit -m "feat(core): soft-detected diagnostics emitter + context tenant + public barrel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: NestJS module + ResilienceService

**Files:**
- Create: `packages/core/src/nest/tokens.ts`, `packages/core/src/nest/resilience.service.ts`, `packages/core/src/nest/resilience.module.ts`
- Create: `packages/core/src/nest/resilience.module.spec.ts`
- Modify: `packages/core/src/index.ts` (export the Nest surface)

**Interfaces:**
- Produces:
  - tokens `RESILIENCE_STORE`, `RESILIENCE_OPTIONS`
  - `interface ResilienceModuleOptions { store?: ResilienceStore; policies?: Record<string, () => Policy>; global?: boolean; emit?: boolean }`
  - `class ResilienceModule { static forRoot(opts?): DynamicModule; static forRootAsync(opts): DynamicModule }`
  - `class ResilienceService { execute<T>(policy: string | Policy, op: Operation<T>): Promise<T>; failover<T,R>(opts): Promise<R>; circuit(key): { snapshot(): Promise<CircuitSnapshot>; reset(): Promise<void> }; sink: EventSink }`
- Consumes: everything from Tasks 4–11.

- [ ] **Step 1: Write the failing test**

`packages/core/src/nest/resilience.module.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { timeout } from '../policies/timeout';
import { wrap } from '../policies/wrap';
import { ResilienceModule } from './resilience.module';
import { ResilienceService } from './resilience.service';

describe('ResilienceModule', () => {
  it('provides ResilienceService and runs a named policy', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ResilienceModule.forRoot({
          policies: { fast: () => wrap(timeout(1000)) },
        }),
      ],
    }).compile();
    const svc = moduleRef.get(ResilienceService);
    await expect(svc.execute('fast', async () => 'ok')).resolves.toBe('ok');
  });

  it('runs an inline policy and a raw op', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ResilienceModule.forRoot()] }).compile();
    const svc = moduleRef.get(ResilienceService);
    await expect(svc.execute(wrap(timeout(1000)), async () => 42)).resolves.toBe(42);
  });

  it('exposes circuit snapshot/reset', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ResilienceModule.forRoot()] }).compile();
    const svc = moduleRef.get(ResilienceService);
    const snap = await svc.circuit('k').snapshot();
    expect(snap.status).toBe('closed');
    await expect(svc.circuit('k').reset()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test resilience.module`
Expected: FAIL.

- [ ] **Step 3: Implement tokens + service + module**

`packages/core/src/nest/tokens.ts`:
```ts
export const RESILIENCE_STORE = Symbol('RESILIENCE_STORE');
export const RESILIENCE_OPTIONS = Symbol('RESILIENCE_OPTIONS');
```

`packages/core/src/nest/resilience.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ResilienceStore } from '../breaker/store';
import type { CircuitSnapshot } from '../breaker/types';
import { diagnosticsSink } from '../integration/diagnostics';
import { type EventSink, noopSink } from '../events';
import { type FailoverOptions, failover } from '../policies/failover';
import type { Operation, Policy } from '../policy';
import { wrap } from '../policies/wrap';
import { RESILIENCE_OPTIONS, RESILIENCE_STORE } from './tokens';
import type { ResilienceModuleOptions } from './resilience.module';

@Injectable()
export class ResilienceService {
  readonly sink: EventSink;
  private readonly policies: Record<string, () => Policy>;

  constructor(
    @Inject(RESILIENCE_STORE) private readonly store: ResilienceStore,
    @Inject(RESILIENCE_OPTIONS) options: ResilienceModuleOptions,
  ) {
    this.sink = options.emit === false ? noopSink : diagnosticsSink();
    this.policies = options.policies ?? {};
  }

  execute<T>(policy: string | Policy, op: Operation<T>): Promise<T> {
    const resolved = typeof policy === 'string' ? this.resolve(policy) : policy;
    return resolved.execute(op);
  }

  failover<TTarget, R>(opts: FailoverOptions<TTarget, R>): Promise<R> {
    return failover({ onEvent: this.sink, ...opts });
  }

  circuit(key: string) {
    const store = this.store;
    return {
      snapshot: (): Promise<CircuitSnapshot> => store.snapshot(key),
      reset: async (): Promise<void> => {
        await store.record(key, { threshold: 1, cooldownMs: 0 }, true, false);
      },
    };
  }

  private resolve(name: string): Policy {
    const factory = this.policies[name];
    if (!factory) throw new Error(`Unknown resilience policy "${name}".`);
    return factory();
  }
}
```

`packages/core/src/nest/resilience.module.ts`:
```ts
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { InMemoryResilienceStore } from '../breaker/in-memory.store';
import type { ResilienceStore } from '../breaker/store';
import type { Policy } from '../policy';
import { ResilienceService } from './resilience.service';
import { RESILIENCE_OPTIONS, RESILIENCE_STORE } from './tokens';

export interface ResilienceModuleOptions {
  store?: ResilienceStore;
  policies?: Record<string, () => Policy>;
  global?: boolean;
  /** Emit diagnostics events. Default true. */
  emit?: boolean;
}

export interface ResilienceModuleAsyncOptions {
  global?: boolean;
  inject?: unknown[];
  useFactory: (...args: unknown[]) => Promise<ResilienceModuleOptions> | ResilienceModuleOptions;
}

@Module({})
export class ResilienceModule {
  static forRoot(options: ResilienceModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: RESILIENCE_OPTIONS, useValue: options },
      { provide: RESILIENCE_STORE, useValue: options.store ?? new InMemoryResilienceStore() },
      ResilienceService,
    ];
    return {
      module: ResilienceModule,
      global: options.global ?? true,
      providers,
      exports: [ResilienceService, RESILIENCE_STORE],
    };
  }

  static forRootAsync(options: ResilienceModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: RESILIENCE_OPTIONS, useFactory: options.useFactory, inject: options.inject as never },
      {
        provide: RESILIENCE_STORE,
        useFactory: (opts: ResilienceModuleOptions) => opts.store ?? new InMemoryResilienceStore(),
        inject: [RESILIENCE_OPTIONS],
      },
      ResilienceService,
    ];
    return {
      module: ResilienceModule,
      global: options.global ?? true,
      providers,
      exports: [ResilienceService, RESILIENCE_STORE],
    };
  }
}
```

- [ ] **Step 4: Export the Nest surface**

Append to `packages/core/src/index.ts`:
```ts
export { ResilienceModule } from './nest/resilience.module';
export type { ResilienceModuleOptions, ResilienceModuleAsyncOptions } from './nest/resilience.module';
export { ResilienceService } from './nest/resilience.service';
export { RESILIENCE_STORE, RESILIENCE_OPTIONS } from './nest/tokens';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm -C packages/core test resilience.module`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/nest/tokens.ts packages/core/src/nest/resilience.service.ts packages/core/src/nest/resilience.module.ts packages/core/src/nest/resilience.module.spec.ts packages/core/src/index.ts
git commit -m "feat(core): ResilienceModule + ResilienceService

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Decorators + DiscoveryService explorer

**Files:**
- Create: `packages/core/src/nest/decorators.ts`, `packages/core/src/nest/explorer.ts`
- Create: `packages/core/src/nest/explorer.spec.ts`
- Modify: `packages/core/src/nest/resilience.module.ts` (register the explorer + `DiscoveryModule`), `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `@Timeout(ms: number)`, `@Retry(opts: { attempts: number; backoff?: Backoff })`, `@CircuitBreaker(opts: { threshold: number; cooldownMs: number; key?: string; halfOpenMax?: number } | string)` — method decorators storing metadata.
  - `class ResilienceExplorer implements OnModuleInit` — scans providers via `DiscoveryService`, wraps decorated methods in the composed policy.
- Consumes: `DiscoveryService`, `MetadataScanner` (`@nestjs/core`), the policies, `ResilienceStore`, `EventSink`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/nest/explorer.spec.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { TimeoutError } from '../errors';
import { CircuitBreaker, Retry, Timeout } from './decorators';
import { ResilienceModule } from './resilience.module';

@Injectable()
class FlakyService {
  calls = 0;
  @Retry({ attempts: 3 })
  async sometimes(): Promise<string> {
    this.calls++;
    if (this.calls < 3) throw new Error('transient');
    return 'ok';
  }

  @CircuitBreaker({ threshold: 2, cooldownMs: 1000, key: 'flaky.always' })
  async always(): Promise<string> {
    throw new Error('down');
  }
}

describe('ResilienceExplorer', () => {
  it('@Retry wraps the method so it retries to success', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule.forRoot()],
      providers: [FlakyService],
    }).compile();
    await moduleRef.init();
    const svc = moduleRef.get(FlakyService);
    await expect(svc.sometimes()).resolves.toBe('ok');
    expect(svc.calls).toBe(3);
  });

  it('@CircuitBreaker opens the circuit after threshold failures', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule.forRoot()],
      providers: [FlakyService],
    }).compile();
    await moduleRef.init();
    const svc = moduleRef.get(FlakyService);
    await svc.always().catch(() => {});
    await svc.always().catch(() => {});
    // now open → short-circuits
    await expect(svc.always()).rejects.toThrow(/Circuit/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C packages/core test explorer`
Expected: FAIL.

- [ ] **Step 3: Implement the decorators**

`packages/core/src/nest/decorators.ts`:
```ts
import type { Backoff } from '../policies/retry';

export const RESILIENCE_META = Symbol('resilience:meta');

export interface TimeoutMeta { kind: 'timeout'; ms: number }
export interface RetryMeta { kind: 'retry'; attempts: number; backoff?: Backoff }
export interface CircuitMeta { kind: 'circuit'; threshold: number; cooldownMs: number; key?: string; halfOpenMax?: number }
export type PolicyMeta = TimeoutMeta | RetryMeta | CircuitMeta;

function push(target: object, propertyKey: string | symbol, meta: PolicyMeta): void {
  const existing: PolicyMeta[] = Reflect.getMetadata(RESILIENCE_META, target, propertyKey) ?? [];
  // Decorators apply bottom-up; unshift so source order = outer→inner.
  Reflect.defineMetadata(RESILIENCE_META, [meta, ...existing], target, propertyKey);
}

export function Timeout(ms: number): MethodDecorator {
  return (target, key) => push(target, key, { kind: 'timeout', ms });
}
export function Retry(opts: { attempts: number; backoff?: Backoff }): MethodDecorator {
  return (target, key) => push(target, key, { kind: 'retry', ...opts });
}
export function CircuitBreaker(
  opts: { threshold: number; cooldownMs: number; key?: string; halfOpenMax?: number },
): MethodDecorator {
  return (target, key) => push(target, key, { kind: 'circuit', ...opts });
}
```

> Requires `reflect-metadata` (already a devDependency; consumers import it once at bootstrap, the
> standard NestJS requirement). Ensure `import 'reflect-metadata'` runs in the test setup —
> add it at the top of `explorer.spec.ts` if needed.

- [ ] **Step 4: Implement the explorer**

`packages/core/src/nest/explorer.ts`:
```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { ResilienceStore } from '../breaker/store';
import type { EventSink } from '../events';
import { circuitBreaker } from '../policies/circuit-breaker';
import { retry } from '../policies/retry';
import { timeout } from '../policies/timeout';
import { wrap } from '../policies/wrap';
import type { Policy } from '../policy';
import { type PolicyMeta, RESILIENCE_META } from './decorators';
import { ResilienceService } from './resilience.service';
import { RESILIENCE_STORE } from './tokens';

@Injectable()
export class ResilienceExplorer implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly service: ResilienceService,
    @Inject(RESILIENCE_STORE) private readonly store: ResilienceStore,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance);
      this.scanner.scanFromPrototype(instance, proto, (methodName) => {
        const metas: PolicyMeta[] | undefined = Reflect.getMetadata(RESILIENCE_META, proto, methodName);
        if (!metas?.length) return;
        const className = wrapper.metatype?.name ?? 'Provider';
        const policy = this.buildPolicy(metas, `${className}.${methodName}`);
        const original = instance[methodName] as (...args: unknown[]) => Promise<unknown>;
        instance[methodName] = (...args: unknown[]) => policy.execute(() => original.apply(instance, args));
      });
    }
  }

  private buildPolicy(metas: PolicyMeta[], defaultKey: string): Policy {
    const policies: Policy[] = metas.map((m) => {
      if (m.kind === 'timeout') return timeout(m.ms);
      if (m.kind === 'retry') return retry({ attempts: m.attempts, backoff: m.backoff });
      return circuitBreaker({
        key: m.key ?? defaultKey,
        store: this.store,
        threshold: m.threshold,
        cooldownMs: m.cooldownMs,
        halfOpenMax: m.halfOpenMax,
        onEvent: this.service.sink,
      });
    });
    return wrap(...policies);
  }
}
```

- [ ] **Step 5: Register the explorer + DiscoveryModule in the module**

In `packages/core/src/nest/resilience.module.ts`, import `DiscoveryModule` from `@nestjs/core` and `ResilienceExplorer`; add `DiscoveryModule` to a new `imports` array on the returned `DynamicModule`, and add `ResilienceExplorer` to `providers` in BOTH `forRoot` and `forRootAsync`. Concretely, change the `forRoot` return to:
```ts
return {
  module: ResilienceModule,
  global: options.global ?? true,
  imports: [DiscoveryModule],
  providers: [...providers, ResilienceExplorer],
  exports: [ResilienceService, RESILIENCE_STORE],
};
```
(and the same `imports`/`providers` additions in `forRootAsync`). Add the imports at the top:
```ts
import { DiscoveryModule } from '@nestjs/core';
import { ResilienceExplorer } from './explorer';
```

- [ ] **Step 6: Export decorators**

Append to `packages/core/src/index.ts`:
```ts
export { CircuitBreaker, Retry, Timeout } from './nest/decorators';
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm -C packages/core test explorer`
Expected: PASS.

- [ ] **Step 8: Full suite + build + typecheck**

Run: `pnpm -C packages/core test && pnpm -C packages/core typecheck && pnpm -C packages/core build`
Expected: all green; `dist/` emitted.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/nest/decorators.ts packages/core/src/nest/explorer.ts packages/core/src/nest/explorer.spec.ts packages/core/src/nest/resilience.module.ts packages/core/src/index.ts
git commit -m "feat(core): @Timeout/@Retry/@CircuitBreaker decorators + DiscoveryService explorer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Package docs + changeset

**Files:**
- Create: `packages/core/README.md`, `.changeset/config.json`, `.changeset/initial-resilience-core.md`

**Interfaces:** none (docs/release plumbing).

- [ ] **Step 1: Write the README**

`packages/core/README.md`: a short usage doc covering the three surfaces (programmatic `wrap`/`failover`, `@CircuitBreaker`/`@Timeout`/`@Retry` + `ResilienceModule`, `ResilienceService`), the `ResilienceStore` seam, and the diagnostics events table. Mirror the structure of `../nestjs-notifications/packages/core/README.md`.

- [ ] **Step 2: Add changesets config**

`.changeset/config.json` (copy from `../nestjs-notifications/.changeset/config.json`).

`.changeset/initial-resilience-core.md`:
```md
---
"@dudousxd/nestjs-resilience": minor
---

Initial release: composable resilience policies (timeout, retry, circuit-breaker, failover) with a programmatic API, NestJS decorators + explorer, an injectable ResilienceService, a pluggable ResilienceStore (in-memory in core), and optional diagnostics/context/event-emitter integration.
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/README.md .changeset/
git commit -m "docs(core): README + initial changeset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §1 policy engine (Policy/PolicyContext/Clock/timeout/retry/wrap/failover/errors) → Tasks 2–6, 9. ✅
- §2 circuit-breaker + ResilienceStore (state machine, atomic ops, half-open single-probe, tenant keys) → Tasks 7, 8, 11 (tenant via `tenantSuffix`). ✅ (Tenant *application* — composing the suffix into the breaker key — is exercised by consumers; the helper is provided and unit-tested.)
- §3 NestJS surfaces (decorators+explorer, ResilienceService, module) → Tasks 12, 13. ✅
- §4 integration (diagnostics events, context, event-emitter) → Task 11 (diagnostics + context). ⚠️ **Gap: the optional `@nestjs/event-emitter` mirror is not yet a task.** Acceptable for v1 core (diagnostics is the canonical path); add as a follow-up task if desired — see note below.
- §5 testing (fake clock, state-machine tests, **store contract suite**, composition, emission, decorator) → Tasks 2,6,7,8,10,11,13. ✅ Redis adapter contract run is Plan 2.
- §6 package structure / dual build / adapters → Task 1 (+ Plan 2 for Redis). ✅

**Gap fix (event-emitter mirror):** add this optional task before Task 14 if the user wants it in v1:
> **Task 13.5 — event-emitter mirror.** Create `src/integration/event-emitter.ts` exporting `eventEmitterSink(emitter?: { emit(name: string, payload: unknown): void }): EventSink` that maps `ResilienceEvent` → dotted name `resilience.<type-with-dots>` and emits if an emitter is provided. Compose it with `diagnosticsSink` in `ResilienceService` when an `EventEmitter2` is injected (optional, `@Optional()`). Test: a fake emitter receives `resilience.circuit.opened`. — Deferred by default; diagnostics covers observability and an in-process subscriber can cover reactions.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" in any step. README content is described by mirroring a concrete sibling file (acceptable — it's docs prose, not code). ✅

**3. Type consistency:** `ResilienceStore.admit/record/snapshot` signatures identical across Tasks 7, 8, 10, 12. `Policy.execute(op, parent?)` consistent across Tasks 4–8, 13. `EventSink`/`ResilienceEvent` consistent across Tasks 8, 9, 11, 12. `circuitBreaker(opts)` field names (`key/store/threshold/cooldownMs/halfOpenMax/onEvent`) consistent in Tasks 8, 12, 13. `BreakerConfig` (`threshold/cooldownMs/halfOpenMax`) consistent in Tasks 7, 8, 10. ✅

---

## Notes for the implementer

- **Atomicity in the in-memory store is free** because each `admit`/`record` body runs synchronously to completion (JS run-to-completion) — no `await` mid-mutation. Preserve that; do not introduce an `await` between reading and writing an `Entry`. The contract suite's "concurrent" tests rely on it and will catch a regression. The Redis adapter (Plan 2) must reproduce this atomicity explicitly (Lua / `WATCH`/`MULTI`).
- **Optional-peer imports** must stay lazy/guarded (the `eval('require')` indirection in `diagnostics.ts`) so the core builds and runs with the peer absent.
- Run `pnpm -C packages/core test && pnpm -C packages/core typecheck` after every task.
