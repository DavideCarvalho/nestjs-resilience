# @dudousxd/nestjs-resilience

NestJS-native composable resilience policies — timeout, retry, circuit-breaker, and failover — with zero runtime dependencies. Peers are `@nestjs/common` and `@nestjs/core`; optional integrations add structured diagnostics (`@dudousxd/nestjs-diagnostics`) and event-emitter support (`@nestjs/event-emitter`).

## Install

```bash
pnpm add @dudousxd/nestjs-resilience
```

## Usage

### 1. Programmatic API

Use `wrap` to compose policies (outermost first) and call them directly — no module required.

```ts
import {
  wrap,
  timeout,
  retry,
  exponential,
  circuitBreaker,
  failover,
  InMemoryResilienceStore,
} from '@dudousxd/nestjs-resilience';

const store = new InMemoryResilienceStore();

const policy = wrap(
  timeout(5_000),
  retry({ attempts: 3, backoff: exponential(200, { jitter: true }) }),
  circuitBreaker({ key: 'my-service', store, threshold: 5, cooldownMs: 30_000 }),
);

const result = await policy.execute(async (ctx) => {
  // ctx.signal is wired through all layers
  const res = await fetch('https://api.example.com/data', { signal: ctx.signal });
  return res.json();
});
```

**Failover** — try each target in order and move on after a failure:

```ts
const result = await failover({
  targets: ['https://primary.example.com', 'https://secondary.example.com'],
  run: async (url, ctx) => {
    const res = await fetch(url, { signal: ctx.signal });
    return res.json();
  },
  // optional per-target policy
  policy: (url) => wrap(timeout(3_000), retry({ attempts: 2 })),
});
```

---

### 2. Decorators + `ResilienceModule`

Register the module once; decorators wrap provider methods automatically.

```ts
// app.module.ts
import { ResilienceModule } from '@dudousxd/nestjs-resilience';

@Module({
  imports: [
    ResilienceModule.forRoot({ emit: true }), // global by default
  ],
})
export class AppModule {}
```

Apply decorators to any injectable method:

```ts
import { Injectable } from '@nestjs/common';
import { Timeout, Retry, CircuitBreaker, exponential } from '@dudousxd/nestjs-resilience';

@Injectable()
export class PaymentsService {
  @Timeout(5_000)
  @Retry({ attempts: 3, backoff: exponential(200) })
  @CircuitBreaker({ threshold: 5, cooldownMs: 30_000 })
  async charge(amount: number): Promise<Receipt> {
    // ...
  }
}
```

Decorators are composed outermost-first (top of stack = outer policy). `@CircuitBreaker` on a method uses the class name + method name as the default circuit key; supply `key` to override.

`forRootAsync` is also available for factory-based setup:

```ts
ResilienceModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    store: cfg.get('REDIS_URL') ? new RedisResilienceStore(cfg.get('REDIS_URL')) : undefined,
    emit: cfg.get('RESILIENCE_EMIT') !== 'false',
  }),
})
```

---

### 3. `ResilienceService`

Inject `ResilienceService` for runtime policy dispatch, failover helpers, and circuit inspection.

```ts
// app.module.ts — register named policies
ResilienceModule.forRoot({
  policies: {
    'payments-charge': () =>
      wrap(timeout(5_000), retry({ attempts: 3 })),
  },
})
```

```ts
import { Injectable } from '@nestjs/common';
import { ResilienceService } from '@dudousxd/nestjs-resilience';

@Injectable()
export class PaymentsService {
  constructor(private readonly resilience: ResilienceService) {}

  async charge(amount: number) {
    // Execute a named policy
    return this.resilience.execute('payments-charge', async (ctx) => {
      return this.callGateway(amount, ctx.signal);
    });
  }

  async failoverCharge(amount: number) {
    // Failover with the service-level event sink wired in
    return this.resilience.failover({
      targets: ['gateway-a', 'gateway-b'],
      run: (gw, ctx) => this.callNamedGateway(gw, amount, ctx.signal),
    });
  }

  async circuitHealth(key: string) {
    // Inspect or reset a circuit
    const snap = await this.resilience.circuit(key).snapshot();
    // snap: { status, failures, lastFailureAt, windowStart }
    if (snap.status === 'open') {
      await this.resilience.circuit(key).reset();
    }
    return snap;
  }
}
```

`ResilienceService.sink` is the active `EventSink` — pass it as `onEvent` to programmatic policies to stay on the same channel:

```ts
circuitBreaker({ key: 'x', store, threshold: 5, cooldownMs: 30_000, onEvent: svc.sink })
```

---

## The `ResilienceStore` seam

Circuit-breaker state lives behind a pluggable interface:

```ts
interface ResilienceStore {
  admit(key: string, cfg: BreakerConfig): Promise<Admission>;
  record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus>;
  snapshot(key: string): Promise<CircuitSnapshot>;
}
```

`InMemoryResilienceStore` ships in this package and is the default when no `store` is passed to `ResilienceModule.forRoot`. Distributed adapters (Redis, database-backed) live in separate packages.

**Adapter authors** can verify a custom store against the canonical contract:

```ts
import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience';

// Inside a vitest / jest describe block:
runResilienceStoreContract(() => new MyRedisResilienceStore(client));
```

---

## Diagnostics events

When `emit: true` (the default) and `@dudousxd/nestjs-diagnostics` is installed, every resilience event is emitted on the `aviary` channel. Subscribe with the diagnostics API or any `node:diagnostics_channel` listener.

| Event | When it fires | Channel |
|---|---|---|
| `circuit-opened` | Circuit transitions to open after failure threshold is reached | `aviary:resilience:circuit-opened` |
| `circuit-closed` | Circuit closes after a successful half-open probe | `aviary:resilience:circuit-closed` |
| `circuit-half-open` | A probe call is allowed through during cooldown | `aviary:resilience:circuit-half-open` |
| `short-circuited` | A call is rejected because the circuit is open | `aviary:resilience:short-circuited` |
| `failover` | A target fails and the next target is attempted | `aviary:resilience:failover` |
| `timeout` | An operation exceeds its time limit | `aviary:resilience:timeout` |
| `retry` | An attempt fails and a retry is scheduled | `aviary:resilience:retry` |

Each event payload conforms to `ResilienceEvent` (`{ type: ResilienceEventType; key?: string; [extra: string]: unknown }`), exported from the package.

---

## Errors

| Class | Thrown when |
|---|---|
| `TimeoutError` | An operation times out |
| `BrokenCircuitError` | A call is rejected by an open circuit (`short-circuited` event fires first) |
