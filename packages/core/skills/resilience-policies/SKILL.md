---
name: resilience-policies
description: >
  Programmatic resilience policies in @dudousxd/nestjs-resilience — timeout(ms), retry({ attempts,
  backoff }), exponential(baseMs), circuitBreaker({ key, store, threshold, cooldownMs, halfOpenMax }),
  wrap(...policies) composing outer→inner, and the standalone failover({ targets, run }) function.
  Use for composing timeout/retry/circuit-breaker around any async call, picking composition order,
  honoring the AbortSignal in PolicyContext, exponential backoff, BrokenCircuitError/TimeoutError,
  and choosing a ResilienceStore. Covers the Policy / PolicyContext / Operation contracts.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-resilience"
  library_version: "0.2.0"
---

# Programmatic resilience policies

The policy engine of `@dudousxd/nestjs-resilience`. Every policy implements `Policy`:
`execute<T>(op, parent?): Promise<T>`, where `op` is an `Operation<T> = (ctx: PolicyContext) => Promise<T>`
and `ctx` carries `{ signal: AbortSignal; attempt: number }`. Policies are plain factory functions —
no NestJS needed at this layer (see the `resilience-nestjs` skill for DI).

## Setup

```bash
pnpm add @dudousxd/nestjs-resilience
```

```ts
import {
  wrap,
  timeout,
  retry,
  exponential,
  circuitBreaker,
  failover,
  InMemoryResilienceStore,
  BrokenCircuitError,
  TimeoutError,
} from '@dudousxd/nestjs-resilience';

const store = new InMemoryResilienceStore();

const policy = wrap(
  timeout(2_000),
  retry({ attempts: 3, backoff: exponential(100, { jitter: true }) }),
  circuitBreaker({ key: 'payments', store, threshold: 5, cooldownMs: 30_000 }),
);

const charge = await policy.execute(() => chargeCard(order));
```

## Core patterns

### 1. Compose with `wrap()` — outer → inner

`wrap(...policies)` composes left-to-right as **outer to inner**: the first argument is the
outermost wrapper, the last is closest to your operation. `wrap(timeout, retry, circuitBreaker)`
means: timeout the whole retried, breaker-guarded call; retry re-runs the breaker-guarded call;
the breaker guards each individual attempt.

```ts
const policy = wrap(
  timeout(5_000),                                   // outermost: caps total wall-clock
  retry({ attempts: 3 }),                           // retries the inner call
  circuitBreaker({ key: 'db', store, threshold: 10, cooldownMs: 15_000 }), // innermost
);
```

### 2. Honor the AbortSignal so `timeout` actually cancels

`timeout(ms)` races your operation against an abort. It passes a fresh `AbortSignal` in `ctx.signal`.
A timeout *rejects* the promise, but the underlying work only truly stops if your operation observes
`ctx.signal` (e.g. passes it to `fetch`).

```ts
await timeout(2_000).execute((ctx) => fetch(url, { signal: ctx.signal }));
```

### 3. Circuit breaker needs a key + a store

`circuitBreaker` consults a `ResilienceStore` on every call: it `admit()`s (open circuits throw
`BrokenCircuitError`), runs the op, then `record()`s the outcome. `threshold` failures trip it open
for `cooldownMs`; after cooldown one probe is admitted (`halfOpenMax`, default 1).

```ts
const breaker = circuitBreaker({
  key: 'inventory-api',
  store,
  threshold: 5,
  cooldownMs: 30_000,
  halfOpenMax: 1,
  onEvent: (e) => console.log(e.type, e.key), // 'circuit-opened' | 'short-circuited' | ...
});
```

### 4. `failover()` across targets — a function, not a Policy

`failover` tries each target in order until one succeeds, optionally wrapping each in its own policy.
It returns `Promise<R>` directly (it is **not** a `Policy`).

```ts
const data = await failover({
  targets: [primaryDb, replicaDb],
  run: (db, ctx) => db.query(sql, { signal: ctx.signal }),
  policy: () => timeout(2_000),
  onFailover: (target, err, i) => log.warn(`target ${i} failed`, err),
});
```

## Common mistakes

### Mistake 1: calling `exponential()` with no base delay

```ts
// WRONG — exponential's first parameter (baseMs) is required; this yields NaN backoff delays
retry({ attempts: 3, backoff: exponential() });

// CORRECT — pass the base delay in ms
retry({ attempts: 3, backoff: exponential(100, { jitter: true }) });
```

`exponential(baseMs, opts)` computes `baseMs * factor ** attempt`; with `baseMs` undefined every
delay is `NaN`, so `clock.delay(NaN)` never fires as intended.
Source: `packages/core/src/policies/retry.ts`

### Mistake 2: treating `attempts` as the number of retries

```ts
// WRONG — expecting 1 try + 3 retries = 4 executions
retry({ attempts: 3 }); // actually runs at most 3 times total (1 try + 2 retries)

// CORRECT — for 1 initial try + 3 retries, pass attempts: 4
retry({ attempts: 4 });
```

`retry` loops `for (let attempt = 0; attempt < opts.attempts; attempt++)`, so `attempts` is the
**total** number of executions, not extra retries.
Source: `packages/core/src/policies/retry.ts`

### Mistake 3: inverting `wrap()` order so the breaker wraps the retries

```ts
// WRONG — breaker outermost: a single tripped circuit short-circuits the whole retry loop,
// and the retries never reach the operation
wrap(circuitBreaker({ key: 'api', store, threshold: 5, cooldownMs: 30_000 }), retry({ attempts: 3 }), timeout(1_000));

// CORRECT — timeout outer, retry middle, breaker inner: each attempt is breaker-guarded
wrap(timeout(1_000), retry({ attempts: 3 }), circuitBreaker({ key: 'api', store, threshold: 5, cooldownMs: 30_000 }));
```

`wrap` uses `reduceRight`, so the first policy is outermost and the last is innermost — order changes
which layer sees retries vs. the raw operation.
Source: `packages/core/src/policies/wrap.ts`

### Mistake 4: expecting `failover()` to compose inside `wrap()`

```ts
// WRONG — failover() returns a Promise, not a Policy; wrap() expects Policy objects
wrap(timeout(1_000), failover({ targets, run }));

// CORRECT — call failover() directly; wrap each target via its `policy` option
await failover({ targets, run, policy: () => wrap(timeout(1_000), retry({ attempts: 2 })) });
```

`failover` is an `async function` returning `Promise<R>`; only `timeout`/`retry`/`circuitBreaker`/`wrap`
return `Policy`.
Source: `packages/core/src/policies/failover.ts`
