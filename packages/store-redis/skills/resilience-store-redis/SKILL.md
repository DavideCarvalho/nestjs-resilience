---
name: resilience-store-redis
description: >
  RedisResilienceStore — a distributed circuit-breaker ResilienceStore for @dudousxd/nestjs-resilience
  backed by Redis (ioredis) with atomic Lua admit/record (cbAdmit / cbRecord). Use to share breaker
  state across many NestJS instances, wire it via ResilienceModule.forRoot({ store }), set a keyPrefix,
  inject an ioredis client, and rely on the fleet-wide exactly-one-half-open-probe guarantee. Covers
  RedisResilienceStoreOptions (clock, keyPrefix) and the ioredis peer dependency.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-resilience-store-redis"
  library_version: "0.2.0"
---

# Redis-backed circuit-breaker store

`RedisResilienceStore` implements the core `ResilienceStore` contract on Redis, so circuit-breaker
state (failure counts, open/half-open status, the probe slot) is shared across every process in a
fleet. Admit and record run as atomic Lua scripts (`cbAdmit` / `cbRecord`), giving the
exactly-one-half-open-probe guarantee under concurrent load.

## Setup

```bash
pnpm add @dudousxd/nestjs-resilience-store-redis @dudousxd/nestjs-resilience ioredis
```

`@dudousxd/nestjs-resilience` and `ioredis` are peer dependencies.

```ts
import { Redis } from 'ioredis';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';
import { RedisResilienceStore } from '@dudousxd/nestjs-resilience-store-redis';

const redis = new Redis(process.env.REDIS_URL);

@Module({
  imports: [
    ResilienceModule.forRoot({
      store: new RedisResilienceStore(redis),
    }),
  ],
})
export class AppModule {}
```

## Core patterns

### 1. Construct with an ioredis client (+ options)

The constructor is `new RedisResilienceStore(redis, opts?)`. `RedisResilienceStoreOptions` accepts
`keyPrefix` (default `'resilience:cb:'`) and a `clock`. On construction it registers the two Lua
commands on the client via `defineCommand` — idempotently, so reusing a shared client is safe.

```ts
const store = new RedisResilienceStore(redis, { keyPrefix: 'myapp:cb:' });
```

### 2. Wire it through `forRootAsync` from config

```ts
ResilienceModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    store: new RedisResilienceStore(new Redis(config.get('REDIS_URL'))),
  }),
});
```

### 3. Inspect a circuit fleet-wide

Because state lives in Redis, `snapshot()` reflects the whole fleet:

```ts
const snap = await store.snapshot('payments'); // { status, failures, openUntil? }
```

## Common mistakes

### Mistake 1: passing a Redis connection string instead of an ioredis client

```ts
// WRONG — the store expects an ioredis instance; it calls defineCommand/hmget on it
new RedisResilienceStore('redis://localhost:6379');

// CORRECT — construct the ioredis client first
new RedisResilienceStore(new Redis('redis://localhost:6379'));
```

The constructor immediately calls `redis.defineCommand(...)`, which only exists on an ioredis `Redis`
instance.
Source: `packages/store-redis/src/redis.store.ts`

### Mistake 2: assuming a custom `keyPrefix` matches keys written by the default

```ts
// WRONG — instance A writes 'resilience:cb:payments', instance B reads 'myapp:cb:payments' → split state
new RedisResilienceStore(redis);                          // pod A (default prefix)
new RedisResilienceStore(redis, { keyPrefix: 'myapp:cb:' }); // pod B

// CORRECT — every instance sharing a circuit must use the SAME keyPrefix
new RedisResilienceStore(redis, { keyPrefix: 'myapp:cb:' });
```

Keys are stored as `keyPrefix + key`, so a mismatched prefix silently partitions breaker state.
Source: `packages/store-redis/src/redis.store.ts`

### Mistake 3: reimplementing admit/record without atomicity when extending it

```ts
// WRONG — a JS read-modify-write around Redis re-introduces the race the Lua scripts prevent
const s = await redis.hgetall(key);
if (Number(s.probes) < max) await redis.hincrby(key, 'probes', 1); // two callers can both pass

// CORRECT — rely on the built-in atomic Lua (cbAdmit/cbRecord); do not bypass the store methods
await store.admit(key, cfg);
```

`admit`/`record` delegate to single-round-trip Lua scripts (`ADMIT_LUA` / `RECORD_LUA`) so exactly one
probe is granted in half-open under concurrency.
Source: `packages/store-redis/src/lua.ts`
