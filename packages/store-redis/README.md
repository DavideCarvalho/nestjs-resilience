# @dudousxd/nestjs-resilience-store-redis

> [!WARNING]
> **Deprecated.** NestJS now ships its own resilience package, [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience): retry, timeout, circuit breaker, bulkhead, outbound rate limit, fallback, presets and decorators. Use it instead; this package gets no new releases. The one thing without an equivalent is the distributed circuit-breaker state (the `ResilienceStore` packages): the official breaker keeps its state in each process. See [Migrating to `@nestjs/resilience`](https://davidecarvalho.github.io/aviary/docs/resilience/migrate-to-nestjs-resilience).

A distributed Redis-backed `ResilienceStore` for `@dudousxd/nestjs-resilience`. Circuit-breaker state — status, failure count, open-until timestamp, and in-flight half-open probes — is stored in Redis so every instance in a fleet shares the same view. Mutations (`admit` and `record`) are implemented as atomic Lua scripts, which guarantees exactly-one half-open probe and no lost updates across concurrent processes. Both `ioredis` and `@dudousxd/nestjs-resilience` are peer dependencies.

## Install

```bash
pnpm add @dudousxd/nestjs-resilience-store-redis ioredis
```

## Usage

```ts
import Redis from 'ioredis';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';
import { RedisResilienceStore } from '@dudousxd/nestjs-resilience-store-redis';

ResilienceModule.forRoot({
  store: new RedisResilienceStore(new Redis(process.env.REDIS_URL!)),
});
```

### Options

The constructor accepts an optional second argument:

```ts
new RedisResilienceStore(redis, { keyPrefix, clock, successFastPath })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `keyPrefix` | `string` | `'resilience:cb:'` | Prefix for every Redis key written by this store. |
| `clock` | `Clock` | `systemClock` | Clock used for time comparisons. Override in tests with a `FakeClock`. |
| `successFastPath` | `boolean` | `false` | Opt in to skip the `record` round-trip for a success the store knows would change nothing (see below). Off by default: every outcome is sent to Redis, as before 0.3.0. |

## How it works

Each circuit is stored as a Redis hash at `{keyPrefix}{circuitKey}` with the following fields:

| Field | Description |
|---|---|
| `status` | Circuit status: `closed`, `open`, or `half-open`. |
| `failures` | Consecutive failure count. |
| `openUntil` | Unix-ms timestamp after which a half-open probe is allowed. |
| `probes` | Number of in-flight half-open probes currently admitted. |

`admit` and `record` are each a single Lua script executed atomically on the Redis server, so all state transitions for a given circuit happen in one round-trip with no intermediate state visible to other callers. This is what prevents two concurrent requests from both being admitted as half-open probes (the classic race in distributed circuit breakers).

On a healthy circuit neither script writes: `admit` on a closed circuit only reads, and `record` skips the `HSET` when a success lands on a circuit that is already closed with no failures. A key that has only ever succeeded has no hash; a missing hash reads as the closed default, so `snapshot()` is unaffected.

### Redis cost per call

Each script reads the circuit hash with a single `HMGET`, so a script call costs 2 commands (`EVALSHA` + `HMGET`) plus any write it makes.

With `successFastPath: true` (opt-in), a success skips `record` entirely when the store's latest `admit` for that key saw a clean circuit (closed, no failures) and the store has not sent a failure for the key since. A success on a clean circuit writes nothing, so the skipped script would have been a no-op at that moment. Failures and half-open probe outcomes are always sent.

| Call | Commands |
|---|---|
| Healthy call (closed, success), `successFastPath: true` | 2 (`admit` only) |
| Healthy call, fast path off (default) | 4 |
| Failing call on a closed circuit | 5 (`admit` + `record` with `HINCRBY`) |
| Short-circuited call (open) | 2 |

**Across a fleet.** `admit` still reads Redis on every call, so a circuit another instance opened is seen on the next call. The only difference the fast path makes is to a success that was in flight while another instance changed the circuit: that success is not sent, so it does not reset failures that instance recorded, or close a circuit it just opened. Without the fast path, that late success would have closed the circuit. A skipped `record` resolves to `'closed'`, the status its `admit` saw, rather than a fresh read of Redis; the circuit-breaker policy only uses that value to emit `circuit-closed` after a probe, and probes are never skipped. The store keeps one small entry in memory per circuit key it has seen, with no eviction, so with a very large number of distinct keys set `successFastPath: false`.

Time is read from the injected `Clock` in the application process (via `this.clock.now()`) and passed into Lua as an argument. The store never relies on Redis server time, which means tests can run with a `FakeClock` and the wall-clock is not a source of non-determinism.

## Testing

The store is validated against the core `runResilienceStoreContract` suite (imported from `@dudousxd/nestjs-resilience/testing`) over a real Redis instance spun up via `@testcontainers/redis`.

```bash
# Fast unit tests — no Docker required
pnpm test

# Contract suite over real Redis (requires Docker)
pnpm test:db

# Skip testcontainers (CI without Docker)
SKIP_TESTCONTAINERS=1 pnpm test:db
```
