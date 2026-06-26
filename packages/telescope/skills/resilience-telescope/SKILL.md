---
name: resilience-telescope
description: >
  nestjsResilienceTelescope() — a @dudousxd/nestjs-telescope extension for @dudousxd/nestjs-resilience
  that records aviary:resilience:* diagnostics events (circuit-opened/closed/half-open, short-circuited,
  failover, timeout, retry) as `resilience` Telescope entries and adds a Resilience dashboard (open
  circuits, failovers, most-tripped circuits, recent transitions). Use to register it in
  TelescopeModule.forRoot({ extensions }), tune topKeysLimit/recentLimit, and ensure resilience emit +
  diagnostics are enabled. Exposes ResilienceWatcher, buildResilienceEntry, RESILIENCE_ENTRY_TYPE.
license: MIT
metadata:
  type: core
  library: "@dudousxd/nestjs-resilience-telescope"
  library_version: "0.1.0"
---

# Resilience Telescope extension

`nestjsResilienceTelescope()` plugs into `@dudousxd/nestjs-telescope`. A `ResilienceWatcher` subscribes
to every `aviary:resilience:*` diagnostics channel and records one `resilience` entry per publish; the
extension contributes a navigable "Resilience" entry type and an overview dashboard.

## Setup

```bash
pnpm add @dudousxd/nestjs-resilience-telescope @dudousxd/nestjs-telescope
```

`@dudousxd/nestjs-telescope` (`^1.9.0`) is a peer dependency.

```ts
import { Module } from '@nestjs/common';
import { TelescopeModule } from '@dudousxd/nestjs-telescope';
import { nestjsResilienceTelescope } from '@dudousxd/nestjs-resilience-telescope';
import { ResilienceModule } from '@dudousxd/nestjs-resilience';

@Module({
  imports: [
    ResilienceModule.forRoot({ emit: true }), // emit must stay on so events flow to diagnostics
    TelescopeModule.forRoot({
      extensions: [nestjsResilienceTelescope()],
    }),
  ],
})
export class AppModule {}
```

## Core patterns

### 1. Tune the dashboard panels

`nestjsResilienceTelescope(options?)` accepts `topKeysLimit` (most-tripped circuits panel, default 10)
and `recentLimit` (recent-transitions table, default 50).

```ts
nestjsResilienceTelescope({ topKeysLimit: 20, recentLimit: 100 });
```

The dashboard renders four panels: **Open circuits** (stat), **Failovers (recent)** (stat),
**Most-tripped circuits** (topN), and **Recent transitions** (table of event / key / target / trace).

### 2. Default export for terse registration

The factory is also the package default export:

```ts
import nestjsResilienceTelescope from '@dudousxd/nestjs-resilience-telescope';

TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] });
```

### 3. Programmatic access to the entry shape

For custom tooling, the watcher building blocks are exported: `RESILIENCE_ENTRY_TYPE` (`'resilience'`),
`ResilienceWatcher`, `buildResilienceEntry`, and `isResilienceEvent`.

```ts
import { RESILIENCE_ENTRY_TYPE, isResilienceEvent } from '@dudousxd/nestjs-resilience-telescope';
```

## Common mistakes

### Mistake 1: expecting data while resilience emit is disabled

```ts
// WRONG — emit:false means ResilienceService uses noopSink, so nothing reaches aviary:resilience:*
ResilienceModule.forRoot({ emit: false });
TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] }); // dashboard stays empty

// CORRECT — leave emit at its default (true) so the diagnostics sink publishes events
ResilienceModule.forRoot({ emit: true });
```

The watcher only sees what the resilience library publishes to diagnostics; `emit:false` silences the
source.
Source: `packages/telescope/src/resilience.watcher.ts`

### Mistake 2: passing the factory result's type where a factory call is expected

```ts
// WRONG — passing the function reference, not its return value (a TelescopeExtension)
TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope] });

// CORRECT — call it
TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] });
```

`nestjsResilienceTelescope` is a factory returning a `TelescopeExtension`; `extensions` expects the
extension object.
Source: `packages/telescope/src/resilience-telescope.extension.ts`

### Mistake 3: treating it as a standalone module instead of a Telescope extension

```ts
// WRONG — there is no NestJS module to import; it is not a DynamicModule
@Module({ imports: [nestjsResilienceTelescope()] })

// CORRECT — register it inside Telescope's extensions array
@Module({ imports: [TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] })] })
```

The package exports a `TelescopeExtension` factory (watchers + dashboards + dataProviders), consumed by
`TelescopeModule`, not an importable Nest module.
Source: `packages/telescope/src/resilience-telescope.extension.ts`
