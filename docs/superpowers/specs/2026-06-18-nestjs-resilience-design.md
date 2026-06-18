# `@dudousxd/nestjs-resilience` — Design

- **Date:** 2026-06-18
- **Status:** Approved design — ready for implementation plan
- **Decomposed from:** the `nestjs-notifications` failover redesign. The notifications failover
  (provider failover + channel failover) is a **downstream consumer** of this library and gets its
  own spec in a later round.

## Overview

A NestJS-native resilience toolkit — a "cockatiel for NestJS" — providing composable policies
(**failover, timeout, retry, circuit-breaker**) usable three ways (programmatic, decorators, an
injectable service), with **pluggable distributed state** for the circuit-breaker (in-memory by
default; Redis and DB adapters) and **ecosystem-native observability** (emits over
`@dudousxd/nestjs-diagnostics`).

It exists because resilience is needed across the ecosystem — notifications provider failover,
durable steps calling flaky providers, any payment/HTTP call — and the existing `failover()` in
notifications is naive (stateless, no circuit-breaking, no timeout, clunky API). Rather than bake a
better-but-still-local failover into notifications, we extract a proper, reusable primitive.

### Goals

- Composable policies: `failover`, `timeout`, `retry`, `circuitBreaker`.
- Three consumption surfaces: programmatic policy objects (the engine), method decorators (idiomatic
  sugar), and an injectable `ResilienceService` (DI bridge + breaker control).
- A **distributed circuit-breaker** behind a pluggable `ResilienceStore` — fleet-wide health so one
  pod opening the breaker makes the whole fleet shed load, with coordinated half-open probing.
- Ecosystem integration: observability via `@dudousxd/nestjs-diagnostics`; tenant/trace via
  `@dudousxd/nestjs-context`; optional in-app reactions via `@nestjs/event-emitter`.
- **Core is zero runtime-deps** (only `@nestjs/common` as a peer). Diagnostics, context, and
  event-emitter are **optional, soft-detected peers** — absent them, the lib still works, it just
  doesn't emit / isn't tenant-aware.

### Non-goals (v1)

- **Bulkhead / concurrency-limit** — YAGNI for now.
- **Rate-limiting** — notifications already covers this in its dispatch-guards.
- **Confirmation/wait-based channel escalation** (the "B" from the notifications discussion: send
  WhatsApp, wait for a delivery receipt, escalate to SMS). That is inherently durable/time-spanning
  and belongs in a `@dudousxd/nestjs-durable` workflow, not in this synchronous core.
- **The notifications consumer wiring** — a separate spec.

## Package structure

Mirrors the ecosystem's store-adapter convention (`durable-store-*`, `notifications-database-*`):

- `@dudousxd/nestjs-resilience` — core: the 4 policies, the in-memory `ResilienceStore`, the
  `ResilienceStore` interface, the decorators + explorer, the `ResilienceService`, the module, and
  the diagnostics emission.
- `@dudousxd/nestjs-resilience-store-redis` — first distributed adapter (the common fleet-wide
  breaker case).
- **Fast-follow:** `-store-prisma`, `-store-typeorm`, `-store-mikro-orm`, `-store-drizzle` — same
  `ResilienceStore` interface; can ride the DB you already run.

## 1. The policy engine (programmatic core)

A `Policy` wraps an async operation and adds behavior. Everything composes.

```ts
interface Policy {
  execute<T>(fn: (ctx: PolicyContext) => Promise<T>): Promise<T>;
}
interface PolicyContext {
  /** Aborted on timeout/cancellation — fn should forward it (fetch/SDK) to truly cancel. */
  signal: AbortSignal;
  /** 0-based attempt number, for retry. */
  attempt: number;
}
```

Single-operation policies (each is a `Policy`):

```ts
timeout(5_000)
retry({ attempts: 3, backoff: exponential(200, { jitter: true }) })
circuitBreaker({ key, store, threshold: 5, cooldownMs: 30_000 })
```

Composition is outer→inner, left to right:

```ts
const policy = wrap(retry({ attempts: 3 }), timeout(5_000));
await policy.execute(({ signal }) => fetch(url, { signal })); // retry around timeout around fn
```

`failover` is a **deliberately different shape** — the others wrap one operation; failover chooses
among N targets, each with its own policy (e.g. a per-provider breaker):

```ts
await failover({
  targets: [twilio, vonage],
  policy: (p) => wrap(circuitBreaker({ key: `sms:${p.id}`, store, threshold: 5, cooldownMs: 30_000 }), timeout(5_000)),
  run:    (p, { signal }) => p.send(payload, signal),
  onFailover: (p, err, index) => { /* hook */ },
});
```

It tries each target under that target's policy; returns the first success; rethrows the last error
if all fail. This is exactly what the notifications provider failover consumes.

**Errors (typed):** `TimeoutError`; `BrokenCircuitError` (breaker open — short-circuits **without**
running `fn`); retry/failover exhausted **rethrow the last underlying error**.

**Timeout honesty:** `timeout` rejects the `execute` after `ms`; if `fn` wired the `signal`, the
operation is also cancelled; if not (an SDK without abort support), the operation runs orphaned but
the caller proceeds. The `signal` in `PolicyContext` is first-class precisely so cancellation can
propagate.

**Clock seam.** Timeout, retry backoff, and breaker cooldown all depend on time. Policies take a
`Clock` (default = real wall clock); tests inject a fake clock to advance time deterministically.
This is both a design and a testing decision (see §6).

## 2. Circuit-breaker + `ResilienceStore`

### State machine

```
closed ──(failures ≥ threshold)──▶ open ──(cooldownMs elapsed)──▶ half-open
  ▲                                                                  │
  └──────────────(probe OK)──────────────────────────────────────────┤
                                  (probe failed) ──▶ open (new cooldown)
```

- **closed** — calls pass; failures counted; a success resets the counter; `threshold` failures →
  open.
- **open** — short-circuits immediately (`BrokenCircuitError`, `fn` never runs) for `cooldownMs`.
- **half-open** — lets a single probe through; success → closed (reset), failure → open (new
  cooldown).

### The store interface

State is shared across instances, so the store exposes **atomic** operations; each adapter
guarantees atomicity its own way (in-memory trivially; Redis via Lua / `INCR` / `SET NX PX`; DB via
transaction / row-lock).

```ts
interface BreakerConfig { threshold: number; cooldownMs: number; halfOpenMax?: number }

interface ResilienceStore {
  /** May a call proceed now? Atomically flips open→half-open once the cooldown elapses and hands
   *  the single probe slot to exactly one caller (fleet-wide). */
  admit(key: string, cfg: BreakerConfig): Promise<{ allow: boolean; probe: boolean }>;
  /** Record the outcome; atomically updates counters and transitions state. */
  record(key: string, cfg: BreakerConfig, ok: boolean, probe: boolean): Promise<CircuitStatus>;
  /** Read-only snapshot, for the service / dashboards. */
  snapshot(key: string): Promise<CircuitSnapshot>;
}

type CircuitStatus = 'closed' | 'open' | 'half-open';
interface CircuitSnapshot { status: CircuitStatus; failures: number; openUntil?: number }
```

### Distributed half-open coordination (the crux)

When the cooldown expires, `admit` returns `probe: true` to **exactly one caller across the whole
fleet**; the others keep short-circuiting (`allow: false`) until the probe resolves. Probe success →
`record` closes the breaker for everyone (fleet-wide reset); probe failure → re-open. Without this,
every pod would probe the recovering provider simultaneously and knock it back over. `halfOpenMax`
optionally allows *k* concurrent probes instead of one.

### Tenant-aware keys

The breaker `key` can incorporate the tenant (`sms:twilio` vs `sms:twilio:tenant_42`), read from
`@dudousxd/nestjs-context` (soft-detected via the shared `CONTEXT_ACCESSOR` symbol — no hard
import). A bad provider for one tenant then doesn't trip the breaker for the others.

## 3. NestJS surfaces

All three sit on top of §1's engine.

### Decorators + explorer (single-operation policies on provider methods)

```ts
@Injectable()
export class PaymentService {
  @CircuitBreaker({ threshold: 5, cooldownMs: 30_000 }) // key defaults to "PaymentService.charge"
  @Timeout(5_000)
  @Retry({ attempts: 3 })
  async charge(dto: ChargeDto) { /* … */ }
}
```

A `DiscoveryService`-based explorer wraps the decorated methods at startup — the same pattern the
notifications core uses to discover channels (consistent with the codebase; no exotic monkey-patch).
Stacked decorators compose outer→inner. The default `key` is `Class.method`, overridable, and gains
a tenant suffix from context when the policy is marked `tenantAware`.

> **Note:** `failover` is list-oriented (multiple targets), so it is **not** a method decorator — it
> lives in the service / programmatic form. Decorators cover `timeout`/`retry`/`circuitBreaker`,
> which wrap a single method.

### `ResilienceService` (injectable)

```ts
constructor(private readonly resilience: ResilienceService) {}

await this.resilience.execute('sms-provider', ({ signal }) => twilio.send(p, signal)); // named policy
await this.resilience.failover({ targets, policy, run });                              // the list form
const snap = await this.resilience.circuit('sms:twilio').snapshot();                   // inspect
await this.resilience.circuit('sms:twilio').reset();                                   // admin override
```

### The module

```ts
ResilienceModule.forRoot({
  store: RedisResilienceStore,        // defaults to the in-memory store; Redis from the adapter pkg
  policies: {
    'sms-provider': () => wrap(circuitBreaker({ threshold: 5, cooldownMs: 30_000 }), timeout(5_000)),
  },
});
// forRootAsync as well, for stores needing a connection (Redis/DB).
```

A named policy (`'sms-provider'`) is referenceable from the decorator (`@CircuitBreaker('sms-provider')`),
the service (`execute('sms-provider', …)`), and downstream consumers (notifications' transport pool).

## 4. Ecosystem integration

### Diagnostics (`@dudousxd/nestjs-diagnostics`) — the observability spine

Every policy emits via `emit('resilience', '<event>', payload)` → channel `aviary:resilience:<event>`:

| Event | Payload |
| --- | --- |
| `circuit-opened` | `{ key, failures, cooldownMs }` |
| `circuit-closed` / `circuit-half-open` | `{ key }` |
| `short-circuited` | `{ key }` — a call rejected while the breaker is open |
| `failover` | `{ key, target, index, error }` |
| `timeout` | `{ key, ms }` |
| `retry` | `{ key, attempt, error }` |

Because diagnostics only builds an event when something is subscribed (zero-cost otherwise) and
auto-fills `traceId` from context, this is free and trace-correlated. Telescope picks it all up via
the generic diagnostics watcher (no telescope coupling); OTel/APM likewise. Diagnostics is an
**optional peer** — absent it, no emission and the lib works unchanged.

### Context (`@dudousxd/nestjs-context`)

Tenant → per-tenant breaker keys (soft-detected via `CONTEXT_ACCESSOR`, no hard import). Trace →
emitted events are correlated to the triggering request, for free (via diagnostics).

### Event-emitter (`@nestjs/event-emitter`) — optional, for in-app reactions

Distinct from diagnostics (which is for *observing*): this is for the app to *react* —
`@OnEvent('resilience.circuit.opened')` to page someone, flip a feature flag, etc. Mirrors the same
events in dotted form, only when event-emitter is present.

### Durable (`@dudousxd/nestjs-durable`) — two-way

Durable steps calling flaky providers consume the policies (timeout/CB/failover). DB-backed
`ResilienceStore` adapters reuse durable's store conventions / the DB you already run. And the
deferred channel-failover "B" is a durable workflow — it lives there, not in this core.

## 5. Testing strategy

1. **Injectable clock.** Inject a `Clock` (real by default) so tests advance time deterministically
   — verifying "timeout fires at `ms`", "open→half-open after `cooldownMs`", and backoff delays
   without real timers.
2. **State machine** — tested against the in-memory store + fake clock (threshold open, cooldown
   half-open, probe close/re-open).
3. **Store contract tests** — a shared `ResilienceStore` contract suite runs against **every**
   adapter (in-memory, Redis, prisma, typeorm, …), guaranteeing identical semantics and hammering
   the **atomic/concurrency** guarantees: N concurrent `admit` in half-open → exactly one
   `probe: true`; concurrent `record(failure)` → exact counter. Redis/DB run under **testcontainers**
   (reuses the infra added in the notifications rework).
4. **Composition** — `wrap(retry, timeout)` (retry re-runs after timeout; `signal` aborts) and
   `failover` (ordered, respects per-target breakers, rethrows last).
5. **Emission** — drop a subscriber on the diagnostics channel and assert the right events fire on
   transitions.
6. **Decorator/interceptor** — a test module with a decorated provider method; assert the explorer
   wrapped it and the policy applies.

No real network anywhere — policy/failover tests use fake targets (functions that succeed/fail on
cue).

## Open questions / future

- **Failure-counting mode.** v1 uses a simple count (failures since last success). A
  sampling/rate-over-window breaker (à la cockatiel) could be a later opt-in.
- **DB store adapters** ship fast-follow; only in-memory (core) + Redis are in the v1 cut.
- **Confirmation-based channel escalation ("B")** is a future `nestjs-durable` workflow, out of
  scope here.
- **Aviary docs.** Once shipped, `nestjs-resilience` joins the Aviary field guide as its own
  library (call sign / specimen TBD).
