---
name: resilience-nestjs
description: >
  Wire @dudousxd/nestjs-resilience into NestJS DI — ResilienceModule.forRoot/forRootAsync (global by
  default), the injectable ResilienceService (execute, failover, circuit(key).snapshot()/reset()), and
  the @Timeout / @Retry / @CircuitBreaker method decorators wrapped at startup by the ResilienceExplorer
  via DiscoveryService. Use for module registration, async store config, named policy registries, the
  RESILIENCE_STORE / RESILIENCE_OPTIONS tokens, default breaker keys (Class.method), and emit/eventEmitter.
license: MIT
metadata:
  type: framework
  framework: nestjs
  library: "@dudousxd/nestjs-resilience"
  library_version: "0.2.0"
requires:
  - "@nestjs/common"
  - "@nestjs/core"
---

# Resilience in NestJS (DI surfaces)

Three NestJS-native ways to use the library: register `ResilienceModule`, inject `ResilienceService`,
or annotate methods with `@Timeout` / `@Retry` / `@CircuitBreaker`. The programmatic policies
(`timeout`/`retry`/`circuitBreaker`/`wrap`/`failover`) are documented in the `resilience-policies` skill.

## Setup

```bash
pnpm add @dudousxd/nestjs-resilience
```

`@nestjs/common` and `@nestjs/core` are peer dependencies. `@dudousxd/nestjs-diagnostics` is an
optional peer (event emission no-ops without it).

```ts
import { Module } from '@nestjs/common';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';

@Module({
  imports: [
    ResilienceModule.forRoot({
      // store defaults to a new InMemoryResilienceStore() — single-process only
      policies: {
        payments: () => wrap(timeout(2_000), retry({ attempts: 3 })),
      },
    }),
  ],
})
export class AppModule {}
```

`ResilienceModule` is **global by default** (`global: options.global ?? true`), so `ResilienceService`
and `RESILIENCE_STORE` are injectable everywhere without re-importing.

## Core patterns

### 1. Decorate methods — wrapped at startup by the explorer

`@Timeout`, `@Retry`, `@CircuitBreaker` attach metadata; `ResilienceExplorer` (registered by
`ResilienceModule`) walks every provider at `onModuleInit` and replaces decorated methods with a
policy-wrapped version. Decorators apply **top → bottom = outer → inner**.

```ts
import { Injectable } from '@nestjs/common';
import { Timeout, Retry, CircuitBreaker } from '@dudousxd/nestjs-resilience';

@Injectable()
export class PaymentService {
  @Timeout(2_000)
  @Retry({ attempts: 3 })
  @CircuitBreaker({ threshold: 5, cooldownMs: 30_000 }) // key defaults to 'PaymentService.charge'
  async charge(order: Order) {
    return this.gateway.charge(order);
  }
}
```

### 2. Inject `ResilienceService` for imperative control

```ts
@Injectable()
export class OrderService {
  constructor(private readonly resilience: ResilienceService) {}

  run() {
    // a named policy registered in forRoot({ policies })
    return this.resilience.execute('payments', () => this.charge());
  }

  failover() {
    return this.resilience.failover({ targets: [a, b], run: (t, ctx) => t.call(ctx.signal) });
  }

  async health() {
    const snap = await this.resilience.circuit('payments').snapshot(); // { status, failures, openUntil? }
    if (snap.status === 'open') await this.resilience.circuit('payments').reset();
  }
}
```

### 3. Async config with `forRootAsync` + a distributed store

```ts
ResilienceModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    store: new RedisResilienceStore(new Redis(config.get('REDIS_URL'))),
    emit: true,
  }),
});
```

## Common mistakes

### Mistake 1: calling `ResilienceService.execute('name', …)` for an unregistered policy

```ts
// WRONG — 'retries' was never registered in forRoot({ policies })
this.resilience.execute('retries', op); // throws: Unknown resilience policy "retries".

// CORRECT — register the named factory first
ResilienceModule.forRoot({ policies: { retries: () => retry({ attempts: 3 }) } });
this.resilience.execute('retries', op);
```

`execute` resolves string names against the `policies` map and throws when the name is missing.
Source: `packages/core/src/nest/resilience.service.ts`

### Mistake 2: omitting `key` on `@CircuitBreaker` across instances expecting a shared circuit

```ts
// WRONG — no key: each decorated method gets a key derived from its Class.method name
@CircuitBreaker({ threshold: 5, cooldownMs: 30_000 })
async callA() {}

// CORRECT — pass an explicit, shared key to group breakers for the same upstream
@CircuitBreaker({ key: 'billing-upstream', threshold: 5, cooldownMs: 30_000 })
async callA() {}
```

Without `key`, the explorer uses `` `${className}.${methodName}` `` as the breaker key, so two methods
hitting the same upstream get independent circuits.
Source: `packages/core/src/nest/explorer.ts`

### Mistake 3: relying on the default store for a multi-instance deployment

```ts
// WRONG — no store: forRoot installs a per-process InMemoryResilienceStore; each pod trips alone
ResilienceModule.forRoot({});

// CORRECT — supply a distributed store so breaker state is fleet-wide
ResilienceModule.forRoot({ store: new RedisResilienceStore(redis) });
```

`forRoot`/`forRootAsync` default `RESILIENCE_STORE` to `new InMemoryResilienceStore()`, which is not
shared across processes.
Source: `packages/core/src/nest/resilience.module.ts`

### Mistake 4: expecting events without enabling/installing diagnostics

```ts
// WRONG — emit:false silences the diagnostics sink, so Telescope/diagnostics see nothing
ResilienceModule.forRoot({ emit: false });

// CORRECT — leave emit at its default (true) and install @dudousxd/nestjs-diagnostics;
// optionally mirror to @nestjs/event-emitter
ResilienceModule.forRoot({ emit: true, eventEmitter: this.eventEmitter });
```

`ResilienceService` builds its sink from `options.emit` (default true → `diagnosticsSink()`) and an
optional `eventEmitter` mirror; with `emit:false` the base sink is `noopSink`.
Source: `packages/core/src/nest/resilience.service.ts`
