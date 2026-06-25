# Skill spec — nestjs-resilience (autonomous TanStack Intent pass)

Maintainer interview phases (domain-discovery Phase 2 & 4) were SKIPPED — this repo is scaffolded
fully autonomously. Everything below is grounded in `packages/*/src` and `docs/`.

## Scope decision

Public packages (all publishable, none `private`):
`@dudousxd/nestjs-resilience` (core), and store adapters for redis/typeorm/mikro-orm/prisma/drizzle,
plus the telescope extension.

Skills target the **3 primary client-facing packages** a consumer actually imports:

1. `@dudousxd/nestjs-resilience` (core) — the policy engine + NestJS DI surfaces.
2. `@dudousxd/nestjs-resilience-store-redis` — the most common distributed store.
3. `@dudousxd/nestjs-resilience-telescope` — the observability extension.

The four ORM store adapters (typeorm, mikro-orm, prisma, drizzle) are intentionally **uncovered** —
they share the `SqlResilienceStore` base documented in the core store skill; per-ORM wiring is a thin
shell. Listed in `gaps`.

## Skill set (5 SKILL.md, flat)

| skill | package | type | covers |
| --- | --- | --- | --- |
| `resilience-policies` | core | core | programmatic timeout/retry/circuitBreaker/wrap/failover + composition order + AbortSignal |
| `resilience-nestjs` | core | framework | ResilienceModule.forRoot/forRootAsync, ResilienceService, @Timeout/@Retry/@CircuitBreaker |
| `resilience-store` | core | core | ResilienceStore contract, InMemory vs distributed, SqlResilienceStore, runResilienceStoreContract |
| `resilience-store-redis` | store-redis | core | RedisResilienceStore wiring, keyPrefix, atomic Lua, fleet-wide state |
| `resilience-telescope` | telescope | core | nestjsResilienceTelescope() extension, dashboard, watcher prerequisites |

Flat layout: `packages/<pkg>/skills/<skill>/SKILL.md`. <5 entries per package → no router skill;
each is `core` except the NestJS DI skill which is `framework` (requires @nestjs/common + @nestjs/core).

## Per-skill content plan (each: Setup → 2–4 Core Patterns → ≥3 Common Mistakes with Wrong/Correct + Source)

- **resilience-policies**: compose with `wrap()` (outer→inner), `retry` attempts = total tries,
  `exponential(baseMs)` required arg, `timeout` honoring `ctx.signal`, `circuitBreaker` needs store+key,
  `failover` is a standalone fn.
- **resilience-nestjs**: `forRoot`/`forRootAsync` (global default true), inject `ResilienceService`,
  decorators wrapped at startup by the explorer, default key = `Class.method`, named policy registry,
  `circuit(key).snapshot()/reset()`.
- **resilience-store**: the 3-method contract + atomicity rule, InMemory per-process pitfall,
  `SqlResilienceStore` + `CIRCUITS_DDL`, validate custom stores with `runResilienceStoreContract`.
- **resilience-store-redis**: `new RedisResilienceStore(ioredis, { keyPrefix })`, wire via `store:`,
  idempotent Lua registration, fleet-wide single-probe guarantee.
- **resilience-telescope**: `nestjsResilienceTelescope({ topKeysLimit, recentLimit })` in
  `TelescopeModule.forRoot({ extensions })`, needs resilience emit on + diagnostics present.

## Remaining Gaps (would-be interview answers)

- No GitHub issues exist → AI-agent failure modes are only those evident from source.
- No documented production tuning defaults (threshold/cooldownMs/halfOpenMax per workload).
- `timeout`/`retry` ResilienceEventType values are declared but no emit site exists for the standalone
  policies; skills do not claim they are emitted.
- Skill priority ordering inferred, not maintainer-ranked.
- ORM store adapters left uncovered (thin `SqlResilienceStore` shells).
- Precedence when decorators and programmatic policies overlap on one provider is undocumented.
