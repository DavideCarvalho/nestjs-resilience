# @dudousxd/nestjs-resilience-store-redis

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
new RedisResilienceStore(redis, { keyPrefix, clock })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `keyPrefix` | `string` | `'resilience:cb:'` | Prefix for every Redis key written by this store. |
| `clock` | `Clock` | `systemClock` | Clock used for time comparisons. Override in tests with a `FakeClock`. |

## How it works

Each circuit is stored as a Redis hash at `{keyPrefix}{circuitKey}` with the following fields:

| Field | Description |
|---|---|
| `status` | Circuit status: `closed`, `open`, or `half-open`. |
| `failures` | Consecutive failure count. |
| `openUntil` | Unix-ms timestamp after which a half-open probe is allowed. |
| `probes` | Number of in-flight half-open probes currently admitted. |

`admit` and `record` are each a single Lua script executed atomically on the Redis server, so all state transitions for a given circuit happen in one round-trip with no intermediate state visible to other callers. This is what prevents two concurrent requests from both being admitted as half-open probes (the classic race in distributed circuit breakers).

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
