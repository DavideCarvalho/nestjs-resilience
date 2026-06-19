# `@dudousxd/nestjs-resilience-telescope` — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Repo:** `nestjs-resilience` (new package under `packages/`)

## Goal

Surface `nestjs-resilience` circuit-breaker / failover / timeout / retry events in the
[Telescope](https://davidecarvalho.github.io/aviary/docs/telescope) dashboard as a first-class,
semantic entry type with its own navigation tab and overview dashboard — without editing
`@dudousxd/nestjs-telescope`'s `packages/ui`.

## Background & constraints

- `nestjs-resilience` already emits every state transition over `@dudousxd/nestjs-diagnostics`:
  `emit('resilience', event.type, event)` → channel `aviary:resilience:<event.type>`, payload is the
  full `ResilienceEvent` (`{ type, key?, ...extra }`). Confirmed in
  `packages/core/src/integration/diagnostics.ts`.
- Telescope has **no** generic diagnostics watcher today. Its `events` package only taps
  `@nestjs/event-emitter` via `onAny`. So resilience events do **not** reach Telescope automatically.
- Telescope's per-entry **detail panel** (`packages/ui/.../entry-detail.tsx`) is a hardcoded `switch`
  on `entry.type` with a JSON fallback. External packages **cannot** contribute a detail component.
- Telescope's **extension system** lets an external package contribute, with zero `packages/ui` edits:
  `watchers()`, `entryTypes()`, `dashboards()` (declarative panel IR), `dataProviders()`
  (server-side queries). Confirmed via the existing template
  `@dudousxd/nestjs-diagnostics`'s `packages/telescope/src/diagnostics-telescope.extension.ts`.

**Depth decision (approved):** ship the **watcher + dashboard**. Individual entries render as JSON in
the detail view. A richer per-entry detail view (circuit-state timeline) is deferred to a separate
telescope-core feature — a pluggable, declarative entry-detail extension point — and is explicitly
out of scope here. This package is designed so adding that view later is purely additive.

**Reference template:** mirror `@dudousxd/nestjs-diagnostics-telescope` end to end (package layout,
extension factory shape, watcher subscribe/cleanup mechanics, dataProvider storage reads).

## Package

- **Name:** `@dudousxd/nestjs-resilience-telescope`
- **Home:** new package in the `nestjs-resilience` monorepo (`packages/telescope`), mirroring how the
  diagnostics repo ships its own `…-telescope` bridge. It co-locates with the resilience event schema
  it depends on.
- **Public entry:** a single factory + the watcher + the content type.

```ts
import { nestjsResilienceTelescope } from '@dudousxd/nestjs-resilience-telescope';

TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] });
```

### Options

```ts
export interface ResilienceTelescopeOptions {
  /** How many circuit keys to surface in the top-N "most-tripped" panel. Default 10. */
  topKeysLimit?: number;
  /** How many recent transitions to list in the table panel. Default 50. */
  recentLimit?: number;
}
```

## File structure

```
packages/telescope/
├── package.json              # name, peers (telescope + diagnostics), tsc/vitest scripts
├── tsconfig.json             # extends repo base
├── vitest.config.ts
├── README.md
├── CHANGELOG.md
└── src/
    ├── index.ts                          # public exports
    ├── resilience.watcher.ts             # ResilienceWatcher + RESILIENCE_ENTRY_TYPE + content type + builder + validator
    ├── resilience.watcher.spec.ts
    ├── resilience-telescope.extension.ts # nestjsResilienceTelescope() factory (4 hooks)
    └── resilience-telescope.extension.spec.ts
```

Each file has one responsibility: the watcher knows how to subscribe and shape an entry; the extension
file wires the nav type, dashboard IR, and data providers.

## Component 1 — `ResilienceWatcher` (`resilience.watcher.ts`)

Mirrors `DiagnosticWatcher` but **scoped to the resilience library** instead of all channels.

```ts
import diagnostics_channel, { type Channel } from 'node:diagnostics_channel';
import {
  CHANNEL_PREFIX,
  type DiagnosticEvent,
  onChannelRegistered,
  registeredChannels,
} from '@dudousxd/nestjs-diagnostics';
import type { RecordInput, Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

export const RESILIENCE_ENTRY_TYPE = 'resilience';

/** Only subscribe to this library's channels: `aviary:resilience:*`. */
const RESILIENCE_CHANNEL_PREFIX = `${CHANNEL_PREFIX}:resilience:`; // 'aviary:resilience:'

export type ResilienceEventType =
  | 'circuit-opened'
  | 'circuit-closed'
  | 'circuit-half-open'
  | 'short-circuited'
  | 'failover'
  | 'timeout'
  | 'retry';

export interface ResilienceEntryContent {
  event: ResilienceEventType;
  key: string | null;        // breaker key (tenant-aware), when present
  target: string | null;     // failover target id, when present
  index: number | null;      // failover attempt index, when present
  error: string | null;      // error message (failover), when present
  traceId: string | null;
  ts: number;
  payload: unknown;          // full ResilienceEvent, verbatim
}
```

### Behaviour

- `register(ctx)`: subscribe to every channel in `registeredChannels()` whose name starts with
  `RESILIENCE_CHANNEL_PREFIX`, and register `onChannelRegistered` to subscribe to any **future**
  resilience channel (each event type registers its channel on first `emit`). Ignore non-resilience
  channels entirely.
- `cleanup()`: detach the `onChannelRegistered` callback and unsubscribe every listener; reset state.
  Idempotent re-`register` guard like the template.
- `safeRecord(ctx, msg)`: validate the envelope; on success `ctx.record(buildResilienceEntry(msg))`.
  **Never rethrows** — a telescope failure must never break the emitting code path
  (`console.error` and swallow).

### Entry builder

`buildResilienceEntry(msg: DiagnosticEvent): RecordInput<ResilienceEntryContent>`:

- The diagnostics `payload` is the `ResilienceEvent`. Lift its common fields to the content top level;
  keep the whole event under `payload`.
- `content.event` = `payload.type`; `key`/`target`/`index`/`error` read from payload with `null`
  fallbacks (`index` only when it is a finite number; `target`/`error` coerced to string when present).
- `familyHash` = `content.key` when present, else `content.event` — groups entries by circuit.
- `tags`:
  - `event:<event>`
  - `key:<key>` when present
  - `trace:<traceId>` when present
  - `failed` for the "bad" transitions: `circuit-opened`, `short-circuited`, `timeout` (drives the
    red styling Telescope already applies to `failed`-tagged entries).

### Validation

Reuse the diagnostics envelope shape: a structural `isDiagnosticEvent(msg)` (ts:number, lib:string,
event:string, has `payload`, optional string `traceId`, optional number `v`). Additionally require
`lib === 'resilience'` as a defensive check (the channel filter already guarantees it, but the guard
keeps the builder honest). A malformed message is ignored (no record), not thrown.

## Component 2 — `nestjsResilienceTelescope()` extension (`resilience-telescope.extension.ts`)

Returns a `TelescopeExtension` with four hooks. Provider names are namespaced `resilience.*`.

```ts
const OPEN_CIRCUITS_PROVIDER = 'resilience.openCircuits';
const FAILOVERS_PROVIDER     = 'resilience.failovers';
const TOP_KEYS_PROVIDER      = 'resilience.topKeys';
const RECENT_PROVIDER        = 'resilience.recentTransitions';
```

### `watchers()`
Returns `[new ResilienceWatcher()]`.

### `entryTypes()`
Returns `[{ id: RESILIENCE_ENTRY_TYPE, label: 'Resilience', dot: 'bg-rose-400' }]` (matches the
Aviary landing's rose/Zap identity for resilience).

### `dashboards()`
One `DashboardSpec` — `id: 'resilience.resilience'`, `label: 'Resilience'`, `navGroup: 'Observability'`:

1. **stat** — *Open circuits* → `data: { provider: OPEN_CIRCUITS_PROVIDER }`.
2. **stat** — *Failovers (recent)* → `data: { provider: FAILOVERS_PROVIDER }`.
3. **topN** — *Most-tripped circuits* → `data: { provider: TOP_KEYS_PROVIDER, query: { limit: topKeysLimit } }`, `limit: topKeysLimit`.
4. **table** — *Recent transitions* → `data: { provider: RECENT_PROVIDER, query: { limit: recentLimit } }`,
   columns: `event`, `key`, `target`, `traceId` (labels: Event / Key / Target / Trace).

### `dataProviders()`
Each loads resilience entries from storage and reduces in JS. Shared helper:

```ts
async function loadResilience(ctx: ExtensionContext, limit = 500): Promise<Entry[]> {
  const storage = ctx.moduleRef.get<StorageProvider>(TELESCOPE_STORAGE, { strict: false });
  const page = await storage.get({ type: RESILIENCE_ENTRY_TYPE, limit });
  return page.data;
}
```

- **`OPEN_CIRCUITS_PROVIDER`** → `{ value: <n> }` (a `stat` panel reads `{ value, delta?, … }`, **not**
  `{ items }`). Reduce: group entries by `key`; for each key take the **most recent** transition
  (select by max `ts`); count keys whose latest event is `circuit-opened` or `circuit-half-open` (i.e.
  not yet `circuit-closed`). Keys with no `key` are ignored.
- **`FAILOVERS_PROVIDER`** → `{ value: <n> }`: count of entries whose `event === 'failover'` in the
  loaded window.
- **`TOP_KEYS_PROVIDER`** → `{ items: [{ label, value }] }`: count `circuit-opened` events per `key`,
  sort desc, slice to `limit`.
- **`RECENT_PROVIDER`** → `{ rows: [{ event, key, target, traceId }] }`: map the most recent
  `recentLimit` entries.

`numberOr(value, fallback)` guards query params, as in the template.

## Dependencies & conventions

- **peerDependencies:** `@dudousxd/nestjs-telescope` and `@dudousxd/nestjs-diagnostics` (both published
  version ranges, not `workspace:^`, since Telescope lives in a different repo). `@dudousxd/nestjs-diagnostics`
  is also a peer of `nestjs-resilience` core already, so no new hard runtime dep is introduced.
- **devDependencies:** both peers + `@types/node`, `reflect-metadata`, `typescript`, `vitest`.
- Build with `tsc` (NodeNext, ESM, `.js` import specifiers), `vitest run --passWithNoTests`, biome,
  Node ≥20, a changeset for the new package. `publishConfig.access = public`.
- No testcontainers — this package has only pure unit tests.

## Testing

**`resilience.watcher.spec.ts`** (fake channels via `node:diagnostics_channel` + a `ctx.record` spy):
- subscribes to `aviary:resilience:*` channels and records on publish;
- **ignores** a non-resilience channel (`aviary:authz:decision` publishes → no record);
- subscribes to a resilience channel that registers **after** `register()` (via `onChannelRegistered`);
- builds correct `content` for each event family: a circuit event (`key`, no target), a `failover`
  event (`target`/`index`/`error` lifted), and asserts `familyHash` = key / event;
- adds the `failed` tag for `circuit-opened` / `short-circuited` / `timeout`, and not for
  `circuit-closed` / `retry`;
- ignores a malformed envelope (no record, no throw); a throwing `ctx.record` is swallowed;
- `cleanup()` unsubscribes (subsequent publish → no record) and detaches the registration hook.

**`resilience-telescope.extension.spec.ts`** (in-memory fake `StorageProvider` returning seeded
entries, resolved through a stub `ExtensionContext.moduleRef`):
- `entryTypes()` returns the `resilience` nav type;
- `dashboards()` exposes the four panels bound to the four provider names;
- `OPEN_CIRCUITS_PROVIDER`: seed open→(no close) for key A, open→close for key B ⇒ value `1`;
- `TOP_KEYS_PROVIDER`: ranks keys by `circuit-opened` count, respects `limit`;
- `FAILOVERS_PROVIDER`: counts `failover` entries;
- `RECENT_PROVIDER`: returns rows in recency order, respects `recentLimit`.

## Out of scope

- Pluggable per-entry **detail** view (declarative entry-detail extension point in telescope-core) —
  tracked as a separate future project; `resilience-telescope` will be its first consumer.
- Any change to `@dudousxd/nestjs-telescope`'s `packages/ui` or core.
- New event types in `nestjs-resilience` core (the watcher records whatever the core emits today;
  `timeout`/`retry` are in the event-type union and recorded if/when emitted).
```
