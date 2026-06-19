# `@dudousxd/nestjs-resilience-telescope` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new package in the nestjs-resilience monorepo that surfaces resilience circuit-breaker / failover / timeout / retry events in the Telescope dashboard as a first-class `resilience` entry type with an overview dashboard.

**Architecture:** A `ResilienceWatcher` subscribes (only) to the `aviary:resilience:*` diagnostics channels and records one `type: 'resilience'` Telescope entry per publish. A `nestjsResilienceTelescope()` factory returns a `TelescopeExtension` contributing that watcher, the navigable entry type, an overview dashboard, and the server-side data providers its panels bind to. It mirrors the existing `@dudousxd/nestjs-diagnostics-telescope` package.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler` → extensionless relative imports), tsup (dual ESM/CJS), vitest, `node:diagnostics_channel`, `@dudousxd/nestjs-diagnostics` (subscribe API), `@dudousxd/nestjs-telescope` (extension API), `@dudousxd/nestjs-telescope-testing` (test harness).

## Global Constraints

- Package name **`@dudousxd/nestjs-resilience-telescope`**, version `0.1.0`, in `packages/telescope/`.
- Entry type string is exactly **`'resilience'`**; the watcher's `type` field must equal it.
- Subscribe **only** to channels starting with `aviary:resilience:` — ignore every other library's channels.
- The watcher must **never throw** out of a diagnostics listener — validation failures and record failures are swallowed (`console.error` + return).
- `@dudousxd/nestjs-telescope` is a **peer** dependency (`^1.9.0`); `@dudousxd/nestjs-diagnostics` is a regular **dependency** (`^0.2.3`).
- **No `@dudousxd/nestjs-resilience` (core) dependency** — the `ResilienceEventType` union is redefined locally to keep the package decoupled.
- Build with **tsup**, extend `../../tsconfig.base.json`, tests are `src/*.spec.ts` (excluded from the build via tsconfig). `tsconfig.base.json` sets `exactOptionalPropertyTypes: true` — never assign `key: undefined`; omit the key or use a conditional spread.
- No testcontainers, no DB — pure unit tests.
- `publishConfig.access` is `public`.
- DataProvider return shapes (telescope contract): **stat** → `{ value: number }`; **topN** → `{ items: Array<{ label: string; value: number }> }`; **table** → `{ rows: Array<Record<string, unknown>> }`.

---

## File Structure

```
packages/telescope/
├── package.json                              # name, deps, tsup/vitest scripts, publishConfig
├── tsconfig.json                             # extends ../../tsconfig.base.json
├── tsup.config.ts                            # esm+cjs, dts, clean
├── vitest.config.ts                          # minimal node config
├── README.md                                 # usage
├── .changeset/ (repo root)                   # release note for the new package
└── src/
    ├── index.ts                              # public exports
    ├── resilience.watcher.ts                 # ResilienceWatcher + RESILIENCE_ENTRY_TYPE + content type + builder + validator
    ├── resilience.watcher.spec.ts
    ├── resilience-telescope.extension.ts     # nestjsResilienceTelescope() factory (4 hooks)
    └── resilience-telescope.extension.spec.ts
```

- **resilience.watcher.ts** owns "how a diagnostics envelope becomes a Telescope entry" (subscribe, validate, shape, tag).
- **resilience-telescope.extension.ts** owns "what the dashboard shows" (nav type, panels, the reductions over stored entries).
- **index.ts** is the public surface.

---

### Task 1: Package scaffold + `ResilienceWatcher`

**Files:**
- Create: `packages/telescope/package.json`
- Create: `packages/telescope/tsconfig.json`
- Create: `packages/telescope/tsup.config.ts`
- Create: `packages/telescope/vitest.config.ts`
- Create: `packages/telescope/src/resilience.watcher.ts`
- Test: `packages/telescope/src/resilience.watcher.spec.ts`

**Interfaces:**
- Consumes (from `@dudousxd/nestjs-diagnostics`): `CHANNEL_PREFIX: string` (value `'aviary'`), `registeredChannels(): string[]`, `onChannelRegistered(cb: (name: string) => void): () => void`, `type DiagnosticEvent<T>` (`{ v?, lib, event, ts, traceId?, payload }`), and the test helpers `emit(lib, event, payload)`, `resetRegistry()`, `setContextAccessor(x)`.
- Consumes (from `@dudousxd/nestjs-telescope`): `type Watcher`, `type WatcherContext` (`{ record(input), … }`), `type RecordInput<T>`.
- Consumes (from `@dudousxd/nestjs-telescope-testing`): `collectWatcherEntries(watcher): Promise<{ recorded: RecordInput[] }>`.
- Produces: `class ResilienceWatcher implements Watcher` (`type = 'resilience'`, `register(ctx)`, `cleanup()`); `const RESILIENCE_ENTRY_TYPE = 'resilience'`; `type ResilienceEventType`; `interface ResilienceEntryContent { event: string; key: string | null; target: string | null; index: number | null; error: string | null; traceId: string | null; ts: number; payload: unknown }`; `function buildResilienceEntry(msg: DiagnosticEvent): RecordInput<ResilienceEntryContent>`; `function isResilienceEvent(msg): msg is DiagnosticEvent`.

- [ ] **Step 1: Create `packages/telescope/package.json`**

```json
{
  "name": "@dudousxd/nestjs-resilience-telescope",
  "version": "0.1.0",
  "description": "nestjs-telescope extension for @dudousxd/nestjs-resilience — records circuit-breaker / failover / timeout / retry events in the Telescope dashboard.",
  "license": "MIT",
  "author": "Davide Carvalho",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@dudousxd/nestjs-diagnostics": "^0.2.3"
  },
  "peerDependencies": {
    "@dudousxd/nestjs-telescope": "^1.9.0"
  },
  "devDependencies": {
    "@dudousxd/nestjs-telescope": "^1.11.0",
    "@dudousxd/nestjs-telescope-testing": "^1.11.0",
    "@types/node": "^22",
    "tsup": "^8",
    "typescript": "^5.9.3",
    "vitest": "^3"
  },
  "keywords": ["nestjs", "resilience", "circuit-breaker", "telescope", "observability", "watcher", "extension"]
}
```

- [ ] **Step 2: Create `packages/telescope/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts", "dist", "node_modules"]
}
```

- [ ] **Step 3: Create `packages/telescope/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({ entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true });
```

- [ ] **Step 4: Create `packages/telescope/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 5: Install so the new package's deps resolve**

Run (from repo root `/home/dudousxd/personal/oss/nestjs/nestjs-resilience`): `pnpm install`
Expected: completes; `@dudousxd/nestjs-telescope`, `@dudousxd/nestjs-telescope-testing`, `@dudousxd/nestjs-diagnostics` resolve into `packages/telescope/node_modules`.

- [ ] **Step 6: Write the failing watcher test**

Create `packages/telescope/src/resilience.watcher.spec.ts`:

```ts
import { emit, resetRegistry, setContextAccessor } from '@dudousxd/nestjs-diagnostics';
import { collectWatcherEntries } from '@dudousxd/nestjs-telescope-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ResilienceEntryContent, ResilienceWatcher } from './resilience.watcher';

describe('ResilienceWatcher', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetRegistry();
    setContextAccessor(null);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    setContextAccessor(null);
  });

  it('records a circuit event: type, familyHash=key, failed tag, lifted content', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'payments' });

    expect(recorded).toHaveLength(1);
    const input = recorded[0];
    expect(input?.type).toBe('resilience');
    expect(input?.familyHash).toBe('payments');
    expect(input?.tags).toEqual(['event:circuit-opened', 'key:payments', 'failed']);
    expect(input?.content).toMatchObject<Partial<ResilienceEntryContent>>({
      event: 'circuit-opened',
      key: 'payments',
      target: null,
      index: null,
      error: null,
    });
  });

  it('ignores events from other libraries', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('authz', 'decision', { allow: true });

    expect(recorded).toHaveLength(0);
  });

  it('subscribes to a resilience channel registered before register()', async () => {
    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'a' }); // registers channel, no subscriber yet
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher); // register() loops registeredChannels()
    cleanup = () => watcher.cleanup();

    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'a' });

    expect(recorded).toHaveLength(1); // only the post-subscribe emit
  });

  it('lifts failover target/index/error and groups by event when key absent', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'failover', { type: 'failover', target: 'vonage', index: 1, error: 'boom' });

    const input = recorded[0];
    expect(input?.familyHash).toBe('failover');
    expect(input?.tags).not.toContain('failed');
    expect(input?.content).toMatchObject<Partial<ResilienceEntryContent>>({
      event: 'failover',
      key: null,
      target: 'vonage',
      index: 1,
      error: 'boom',
    });
  });

  it('does not tag circuit-closed as failed', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'circuit-closed', { type: 'circuit-closed', key: 'payments' });

    expect(recorded[0]?.tags).not.toContain('failed');
  });

  it('carries the envelope traceId into content and a trace tag', async () => {
    setContextAccessor({
      traceId: () => 'trace-xyz',
      tenantId: () => undefined,
      userRef: () => undefined,
      get: () => undefined,
    });
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'short-circuited', { type: 'short-circuited', key: 'payments' });

    expect((recorded[0]?.content as ResilienceEntryContent).traceId).toBe('trace-xyz');
    expect(recorded[0]?.tags).toContain('trace:trace-xyz');
  });

  it('stops recording after cleanup()', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    watcher.cleanup();

    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'x' });

    expect(recorded).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm -C packages/telescope test`
Expected: FAIL — cannot resolve `./resilience.watcher` (module not created yet).

- [ ] **Step 8: Implement the watcher**

Create `packages/telescope/src/resilience.watcher.ts`:

```ts
import diagnostics_channel, { type Channel } from 'node:diagnostics_channel';
import {
  CHANNEL_PREFIX,
  type DiagnosticEvent,
  onChannelRegistered,
  registeredChannels,
} from '@dudousxd/nestjs-diagnostics';
import type { RecordInput, Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

/** Telescope entry `type` produced by this watcher. */
export const RESILIENCE_ENTRY_TYPE = 'resilience';

/** Only this library's channels — `aviary:resilience:*`. */
const RESILIENCE_CHANNEL_PREFIX = `${CHANNEL_PREFIX}:resilience:`;

/** Transitions worth a red `failed` tag in the dashboard. */
const FAILED_EVENTS: ReadonlySet<string> = new Set(['circuit-opened', 'short-circuited', 'timeout']);

export type ResilienceEventType =
  | 'circuit-opened'
  | 'circuit-closed'
  | 'circuit-half-open'
  | 'short-circuited'
  | 'failover'
  | 'timeout'
  | 'retry';

/** What a recorded resilience entry looks like in the dashboard. */
export interface ResilienceEntryContent {
  event: string; // a ResilienceEventType, kept as string to tolerate unknown future events
  key: string | null; // breaker key (tenant-aware), when present
  target: string | null; // failover target id, when present
  index: number | null; // failover attempt index, when present
  error: string | null; // error message (failover), when present
  traceId: string | null;
  ts: number;
  payload: unknown; // the full ResilienceEvent, verbatim
}

/**
 * Subscribes to every `aviary:resilience:*` diagnostics channel (current and
 * future) and records one `resilience` Telescope entry per publish. Mirrors the
 * generic DiagnosticWatcher, but scoped to the resilience library.
 */
export class ResilienceWatcher implements Watcher {
  readonly type = RESILIENCE_ENTRY_TYPE;
  private registered = false;
  private offChannelRegistered: (() => void) | null = null;
  private readonly subscriptions = new Map<string, (msg: unknown) => void>();

  register(ctx: WatcherContext): void {
    if (this.registered) return;
    this.registered = true;
    for (const name of registeredChannels()) this.maybeSubscribe(ctx, name);
    this.offChannelRegistered = onChannelRegistered((name) => this.maybeSubscribe(ctx, name));
  }

  cleanup(): void {
    this.offChannelRegistered?.();
    this.offChannelRegistered = null;
    for (const [name, listener] of this.subscriptions) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.subscriptions.clear();
    this.registered = false;
  }

  /** Subscribe once to `name` iff it's a resilience channel. */
  private maybeSubscribe(ctx: WatcherContext, name: string): void {
    if (!name.startsWith(RESILIENCE_CHANNEL_PREFIX)) return;
    if (this.subscriptions.has(name)) return;
    const listener = (msg: unknown) => this.safeRecord(ctx, msg);
    this.subscriptions.set(name, listener);
    const channel: Channel = diagnostics_channel.channel(name);
    channel.subscribe(listener);
  }

  /** Validate + record, swallowing any failure so a producer can never break. */
  private safeRecord(ctx: WatcherContext, msg: unknown): void {
    try {
      if (!isResilienceEvent(msg)) return;
      ctx.record(buildResilienceEntry(msg));
    } catch (err) {
      // NOT rethrown — telescope must never break an emitting code path.
      console.error('ResilienceWatcher: failed to record resilience event:', err);
    }
  }
}

/** A resilience diagnostics envelope — `lib` pinned to `'resilience'`. */
export function isResilienceEvent(msg: unknown): msg is DiagnosticEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.ts === 'number' &&
    m.lib === 'resilience' &&
    typeof m.event === 'string' &&
    'payload' in m &&
    (m.traceId === undefined || typeof m.traceId === 'string')
  );
}

/** Map a resilience envelope to a Telescope `RecordInput`. */
export function buildResilienceEntry(msg: DiagnosticEvent): RecordInput<ResilienceEntryContent> {
  const payload = (typeof msg.payload === 'object' && msg.payload !== null ? msg.payload : {}) as Record<
    string,
    unknown
  >;
  const key = typeof payload.key === 'string' ? payload.key : null;
  const target = payload.target === undefined || payload.target === null ? null : String(payload.target);
  const index = typeof payload.index === 'number' && Number.isFinite(payload.index) ? payload.index : null;
  const rawError = payload.error;
  const error =
    rawError === undefined || rawError === null
      ? null
      : rawError instanceof Error
        ? rawError.message
        : String(rawError);
  const traceId = msg.traceId ?? null;

  const content: ResilienceEntryContent = {
    event: msg.event,
    key,
    target,
    index,
    error,
    traceId,
    ts: msg.ts,
    payload: msg.payload,
  };

  const tags = [
    `event:${msg.event}`,
    ...(key !== null ? [`key:${key}`] : []),
    ...(traceId !== null ? [`trace:${traceId}`] : []),
    ...(FAILED_EVENTS.has(msg.event) ? ['failed'] : []),
  ];

  return {
    type: RESILIENCE_ENTRY_TYPE,
    familyHash: key ?? msg.event,
    tags,
    content,
  };
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm -C packages/telescope test`
Expected: PASS — 7 tests green.

- [ ] **Step 10: Typecheck**

Run: `pnpm -C packages/telescope typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/telescope/package.json packages/telescope/tsconfig.json packages/telescope/tsup.config.ts packages/telescope/vitest.config.ts packages/telescope/src/resilience.watcher.ts packages/telescope/src/resilience.watcher.spec.ts pnpm-lock.yaml
git commit -m "feat(telescope): ResilienceWatcher records aviary:resilience:* events"
```

---

### Task 2: `nestjsResilienceTelescope()` extension + public exports

**Files:**
- Create: `packages/telescope/src/resilience-telescope.extension.ts`
- Create: `packages/telescope/src/index.ts`
- Test: `packages/telescope/src/resilience-telescope.extension.spec.ts`

**Interfaces:**
- Consumes (from Task 1): `RESILIENCE_ENTRY_TYPE`, `type ResilienceEntryContent`, `class ResilienceWatcher`.
- Consumes (from `@dudousxd/nestjs-telescope`): `type TelescopeExtension`, `type Watcher`, `type ExtensionEntryType`, `type DashboardSpec`, `type DataProvider`, `type ExtensionContext`, `type Entry`, `type StorageProvider`, `TELESCOPE_STORAGE`, and (test only) `InMemoryStorageProvider`, `resolveConfig`.
- `StorageProvider.get({ type, limit })` resolves to `{ data: Entry[] }`, newest entries first. `InMemoryStorageProvider.store(entries: Entry[])` seeds it.
- Produces: `function nestjsResilienceTelescope(options?: ResilienceTelescopeOptions): TelescopeExtension` (also the default export); `interface ResilienceTelescopeOptions { topKeysLimit?: number; recentLimit?: number }`.

- [ ] **Step 1: Write the failing extension test**

Create `packages/telescope/src/resilience-telescope.extension.spec.ts`:

```ts
import {
  type Entry,
  type ExtensionContext,
  InMemoryStorageProvider,
  TELESCOPE_STORAGE,
  resolveConfig,
} from '@dudousxd/nestjs-telescope';
import { describe, expect, it } from 'vitest';
import { type ResilienceEntryContent, RESILIENCE_ENTRY_TYPE } from './resilience.watcher';
import { nestjsResilienceTelescope } from './resilience-telescope.extension';

let seq = 0;

function resilienceEntry(content: ResilienceEntryContent): Entry<ResilienceEntryContent> {
  const n = seq++;
  return {
    id: `e${n}`,
    batchId: 'b',
    type: RESILIENCE_ENTRY_TYPE,
    familyHash: content.key ?? content.event,
    content,
    tags: [`event:${content.event}`],
    sequence: n,
    durationMs: null,
    origin: 'http',
    instanceId: 'i',
    traceId: content.traceId,
    spanId: null,
    createdAt: new Date(2026, 0, 1, 0, 0, n),
  };
}

function content(partial: Partial<ResilienceEntryContent> & { event: string }): ResilienceEntryContent {
  return {
    event: partial.event,
    key: partial.key ?? null,
    target: partial.target ?? null,
    index: partial.index ?? null,
    error: partial.error ?? null,
    traceId: partial.traceId ?? null,
    ts: partial.ts ?? 0,
    payload: partial.payload ?? {},
  };
}

async function makeCtx(): Promise<{ ctx: ExtensionContext; storage: InMemoryStorageProvider }> {
  const storage = new InMemoryStorageProvider();
  const ctx: ExtensionContext = {
    config: resolveConfig({}),
    moduleRef: {
      get: (token: unknown) => {
        if (token === TELESCOPE_STORAGE) return storage;
        throw new Error('unknown token');
      },
    } as unknown as ExtensionContext['moduleRef'],
  };
  return { ctx, storage };
}

describe('nestjsResilienceTelescope extension', () => {
  it('contributes the watcher, entry type, dashboard and four providers', () => {
    const ext = nestjsResilienceTelescope();
    expect(ext.name).toBe('nestjs-resilience');

    const fakeCtx = {} as ExtensionContext;
    expect(ext.watchers?.(fakeCtx).map((w) => w.type)).toEqual(['resilience']);
    expect(ext.entryTypes?.(fakeCtx)).toEqual([
      { id: 'resilience', label: 'Resilience', dot: 'bg-rose-400' },
    ]);

    const dashboards = ext.dashboards?.(fakeCtx) ?? [];
    expect(dashboards.map((d) => d.id)).toEqual(['resilience.resilience']);
    expect(dashboards[0]?.panels.map((p) => p.kind)).toEqual(['stat', 'stat', 'topN', 'table']);

    expect(ext.dataProviders?.(fakeCtx).map((p) => p.name)).toEqual([
      'resilience.openCircuits',
      'resilience.failovers',
      'resilience.topKeys',
      'resilience.recentTransitions',
    ]);
  });

  it('openCircuits counts keys whose latest transition is open/half-open', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      resilienceEntry(content({ event: 'circuit-opened', key: 'A', ts: 1 })),
      resilienceEntry(content({ event: 'circuit-opened', key: 'B', ts: 1 })),
      resilienceEntry(content({ event: 'circuit-closed', key: 'B', ts: 2 })), // B recovered
    ]);

    const provider = nestjsResilienceTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'resilience.openCircuits');
    const result = (await provider?.resolve({}, ctx)) as { value: number };

    expect(result.value).toBe(1); // only A
  });

  it('failovers counts failover entries', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      resilienceEntry(content({ event: 'failover', target: 'vonage' })),
      resilienceEntry(content({ event: 'failover', target: 'sns' })),
      resilienceEntry(content({ event: 'circuit-opened', key: 'A' })),
    ]);

    const provider = nestjsResilienceTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'resilience.failovers');
    const result = (await provider?.resolve({}, ctx)) as { value: number };

    expect(result.value).toBe(2);
  });

  it('topKeys ranks keys by circuit-opened count and respects the limit', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      resilienceEntry(content({ event: 'circuit-opened', key: 'A' })),
      resilienceEntry(content({ event: 'circuit-opened', key: 'A' })),
      resilienceEntry(content({ event: 'circuit-opened', key: 'B' })),
      resilienceEntry(content({ event: 'circuit-closed', key: 'A' })), // not counted
    ]);

    const provider = nestjsResilienceTelescope({ topKeysLimit: 1 })
      .dataProviders?.(ctx)
      .find((p) => p.name === 'resilience.topKeys');
    const result = (await provider?.resolve({ limit: 1 }, ctx)) as { items: { label: string; value: number }[] };

    expect(result.items).toEqual([{ label: 'A', value: 2 }]);
  });

  it('recentTransitions returns a table row per entry', async () => {
    const { ctx, storage } = await makeCtx();
    await storage.store([
      resilienceEntry(content({ event: 'failover', target: 'vonage', traceId: 'trace-1' })),
    ]);

    const provider = nestjsResilienceTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'resilience.recentTransitions');
    const result = (await provider?.resolve({}, ctx)) as { rows: Record<string, unknown>[] };

    expect(result.rows).toEqual([{ event: 'failover', key: null, target: 'vonage', traceId: 'trace-1' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/telescope test`
Expected: FAIL — cannot resolve `./resilience-telescope.extension`.

- [ ] **Step 3: Implement the extension**

Create `packages/telescope/src/resilience-telescope.extension.ts`:

```ts
import {
  type DashboardSpec,
  type DataProvider,
  type Entry,
  type ExtensionContext,
  type ExtensionEntryType,
  type StorageProvider,
  TELESCOPE_STORAGE,
  type TelescopeExtension,
  type Watcher,
} from '@dudousxd/nestjs-telescope';
import { RESILIENCE_ENTRY_TYPE, type ResilienceEntryContent, ResilienceWatcher } from './resilience.watcher';

const OPEN_CIRCUITS_PROVIDER = 'resilience.openCircuits';
const FAILOVERS_PROVIDER = 'resilience.failovers';
const TOP_KEYS_PROVIDER = 'resilience.topKeys';
const RECENT_PROVIDER = 'resilience.recentTransitions';

export interface ResilienceTelescopeOptions {
  /** How many circuit keys to surface in the top-N "most-tripped" panel. Default 10. */
  topKeysLimit?: number;
  /** How many recent transitions to list in the table panel. Default 50. */
  recentLimit?: number;
}

/**
 * A `@dudousxd/nestjs-telescope` extension that records resilience state
 * transitions (over the `aviary:resilience:*` diagnostics channels) as
 * `resilience` entries, and adds a "Resilience" dashboard summarising them.
 *
 * ```ts
 * TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] });
 * ```
 */
export function nestjsResilienceTelescope(options: ResilienceTelescopeOptions = {}): TelescopeExtension {
  const topKeysLimit = options.topKeysLimit ?? 10;
  const recentLimit = options.recentLimit ?? 50;

  return {
    name: 'nestjs-resilience',

    watchers(): Watcher[] {
      return [new ResilienceWatcher()];
    },

    entryTypes(): ExtensionEntryType[] {
      return [{ id: RESILIENCE_ENTRY_TYPE, label: 'Resilience', dot: 'bg-rose-400' }];
    },

    dashboards(): DashboardSpec[] {
      return [
        {
          id: 'resilience.resilience',
          label: 'Resilience',
          navGroup: 'Observability',
          panels: [
            { kind: 'stat', title: 'Open circuits', data: { provider: OPEN_CIRCUITS_PROVIDER } },
            { kind: 'stat', title: 'Failovers (recent)', data: { provider: FAILOVERS_PROVIDER } },
            {
              kind: 'topN',
              title: 'Most-tripped circuits',
              data: { provider: TOP_KEYS_PROVIDER, query: { limit: topKeysLimit } },
              limit: topKeysLimit,
            },
            {
              kind: 'table',
              title: 'Recent transitions',
              data: { provider: RECENT_PROVIDER, query: { limit: recentLimit } },
              columns: [
                { key: 'event', label: 'Event' },
                { key: 'key', label: 'Key' },
                { key: 'target', label: 'Target' },
                { key: 'traceId', label: 'Trace' },
              ],
            },
          ],
        },
      ];
    },

    dataProviders(): DataProvider[] {
      return [
        {
          name: OPEN_CIRCUITS_PROVIDER,
          async resolve(_query, ctx) {
            const entries = await loadResilience(ctx);
            const latestByKey = new Map<string, ResilienceEntryContent>();
            for (const entry of entries) {
              const c = entry.content as ResilienceEntryContent | null;
              if (!c || c.key === null) continue;
              const prev = latestByKey.get(c.key);
              if (!prev || c.ts > prev.ts) latestByKey.set(c.key, c);
            }
            let value = 0;
            for (const c of latestByKey.values()) {
              if (c.event === 'circuit-opened' || c.event === 'circuit-half-open') value++;
            }
            return { value };
          },
        },
        {
          name: FAILOVERS_PROVIDER,
          async resolve(_query, ctx) {
            const entries = await loadResilience(ctx);
            let value = 0;
            for (const entry of entries) {
              if ((entry.content as ResilienceEntryContent | null)?.event === 'failover') value++;
            }
            return { value };
          },
        },
        {
          name: TOP_KEYS_PROVIDER,
          async resolve(query, ctx) {
            const limit = numberOr(query?.limit, topKeysLimit);
            const entries = await loadResilience(ctx);
            const counts = new Map<string, number>();
            for (const entry of entries) {
              const c = entry.content as ResilienceEntryContent | null;
              if (!c || c.key === null || c.event !== 'circuit-opened') continue;
              counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
            }
            const items = [...counts.entries()]
              .map(([label, value]) => ({ label, value }))
              .sort((a, b) => b.value - a.value)
              .slice(0, limit);
            return { items };
          },
        },
        {
          name: RECENT_PROVIDER,
          async resolve(query, ctx) {
            const limit = numberOr(query?.limit, recentLimit);
            const entries = await loadResilience(ctx, limit);
            const rows = entries.map((entry) => {
              const c = entry.content as ResilienceEntryContent | null;
              return {
                event: c?.event ?? null,
                key: c?.key ?? null,
                target: c?.target ?? null,
                traceId: c?.traceId ?? null,
              };
            });
            return { rows };
          },
        },
      ];
    },
  };
}

/** Resolve the Telescope store and fetch `resilience` entries (newest first). */
async function loadResilience(ctx: ExtensionContext, limit = 500): Promise<Entry[]> {
  const storage = ctx.moduleRef.get<StorageProvider>(TELESCOPE_STORAGE, { strict: false });
  const page = await storage.get({ type: RESILIENCE_ENTRY_TYPE, limit });
  return page.data;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export default nestjsResilienceTelescope;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C packages/telescope test`
Expected: PASS — extension suite green (and Task 1's watcher suite still green).

- [ ] **Step 5: Create the public `index.ts`**

Create `packages/telescope/src/index.ts`:

```ts
export {
  buildResilienceEntry,
  isResilienceEvent,
  RESILIENCE_ENTRY_TYPE,
  ResilienceWatcher,
} from './resilience.watcher';
export type { ResilienceEntryContent, ResilienceEventType } from './resilience.watcher';
export {
  default,
  nestjsResilienceTelescope,
} from './resilience-telescope.extension';
export type { ResilienceTelescopeOptions } from './resilience-telescope.extension';
```

- [ ] **Step 6: Typecheck and build**

Run: `pnpm -C packages/telescope typecheck`
Expected: no errors.

Run: `pnpm -C packages/telescope build`
Expected: tsup emits `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `dist/index.d.cts`.

- [ ] **Step 7: Commit**

```bash
git add packages/telescope/src/resilience-telescope.extension.ts packages/telescope/src/resilience-telescope.extension.spec.ts packages/telescope/src/index.ts
git commit -m "feat(telescope): nestjsResilienceTelescope extension + public exports"
```

---

### Task 3: README, changeset, and monorepo verification

**Files:**
- Create: `packages/telescope/README.md`
- Create: `.changeset/resilience-telescope.md`

**Interfaces:**
- Consumes: the public exports from Task 2 (`nestjsResilienceTelescope`).
- Produces: nothing code-facing — release metadata + docs.

- [ ] **Step 1: Write the README**

Create `packages/telescope/README.md`:

````markdown
# @dudousxd/nestjs-resilience-telescope

A [`@dudousxd/nestjs-telescope`](https://github.com/DavideCarvalho/nestjs-telescope) extension that
surfaces [`@dudousxd/nestjs-resilience`](https://github.com/DavideCarvalho/nestjs-resilience) state
transitions — circuit opened/closed/half-open, short-circuited, failover, timeout, retry — in the
Telescope dashboard.

It subscribes to the `aviary:resilience:*` diagnostics channels (so it costs nothing until resilience
emits), records one `resilience` entry per transition, and contributes a **Resilience** dashboard:
open circuits, recent failovers, most-tripped circuits, and a table of recent transitions.

## Install

```bash
pnpm add @dudousxd/nestjs-resilience-telescope
```

Requires `@dudousxd/nestjs-telescope` (peer) and `@dudousxd/nestjs-diagnostics`. Make sure resilience
is emitting diagnostics (`ResilienceModule.forRoot({ emit: true })`, the default).

## Usage

```ts
import { TelescopeModule } from '@dudousxd/nestjs-telescope';
import { nestjsResilienceTelescope } from '@dudousxd/nestjs-resilience-telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] }),
  ],
})
export class AppModule {}
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `topKeysLimit` | `10` | How many keys to show in the "Most-tripped circuits" panel. |
| `recentLimit` | `50` | How many transitions to list in the "Recent transitions" table. |

## License

MIT
````

- [ ] **Step 2: Add a changeset**

Create `.changeset/resilience-telescope.md`:

```md
---
"@dudousxd/nestjs-resilience-telescope": minor
---

Add the Telescope extension package: a `ResilienceWatcher` that records `aviary:resilience:*`
diagnostics events as `resilience` entries, plus `nestjsResilienceTelescope()` contributing the
navigable entry type and a Resilience overview dashboard (open circuits, failovers, most-tripped
circuits, recent transitions).
```

- [ ] **Step 3: Verify the whole monorepo builds and tests**

Run (from repo root): `pnpm -r typecheck`
Expected: all packages, including `telescope`, typecheck clean.

Run (from repo root): `pnpm -r test`
Expected: all suites pass; the telescope package reports its watcher + extension specs green.

Run (from repo root): `pnpm -r build`
Expected: every package builds, including `@dudousxd/nestjs-resilience-telescope`.

- [ ] **Step 4: Commit**

```bash
git add packages/telescope/README.md .changeset/resilience-telescope.md
git commit -m "docs(telescope): README + changeset for nestjs-resilience-telescope"
```

---

## Notes for the implementer

- **Extensionless imports.** This monorepo uses `moduleResolution: Bundler` — relative imports have **no** `.js` suffix (`from './resilience.watcher'`). The diagnostics-telescope template uses `.js`; do not copy that.
- **`exactOptionalPropertyTypes: true`.** Build optional fields with conditional spreads (as the `tags` array does) — never `key: undefined`.
- **Channel/publish ordering.** `emit(lib, event, payload)` registers the channel (firing `onChannelRegistered`) *before* it publishes, so a watcher subscribed via the `onChannelRegistered` callback receives that very emit. The "registered before register()" test exercises the `registeredChannels()` loop instead; both paths must work.
- **Reference, not gospel.** `@dudousxd/nestjs-diagnostics/packages/telescope` (the `diagnostics-telescope` package) is the structural template for the watcher, the extension, and both test files. Read it if a telescope type or the `collectWatcherEntries` harness behaves unexpectedly.
- If a telescope export name differs from this plan (e.g. `StorageProvider.get` page shape), trust the installed `@dudousxd/nestjs-telescope` typings and adjust — note the deviation in your report.
