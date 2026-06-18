# Resilience: @nestjs/event-emitter mirror

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let resilience events be mirrored to an `EventEmitter2`-style emitter for in-app reactions, alongside the diagnostics channel — without core hard-importing `@nestjs/event-emitter`.

**Architecture:** A pure, structurally-typed `eventEmitterSink(emitter)` maps each `ResilienceEvent` to a dotted event name (`circuit-opened` → `resilience.circuit.opened`) and emits it. A `combineSinks(...sinks)` fans one event out to many sinks. `ResilienceService` composes the diagnostics sink with an event-emitter sink when a `eventEmitter` is supplied via module options (the user passes their `EventEmitter2`, e.g. through `forRootAsync` injecting it). Core never imports `@nestjs/event-emitter` — the emitter is a structural `{ emit(name, ...values) }`.

## Global Constraints
- TS strict + exactOptionalPropertyTypes; module ESNext / Bundler; extensionless imports.
- Core stays zero-runtime-dep and the MAIN barrel must remain free of any `@nestjs/event-emitter` import (the sink takes a structural emitter, so nothing is imported). After this change, `grep vitest packages/core/dist/index.js` stays 0 AND there is no `@nestjs/event-emitter` import in `dist/index.js`.
- Commits end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: eventEmitterSink + combineSinks

**Files:** Create `packages/core/src/integration/event-emitter.ts`, `packages/core/src/integration/event-emitter.spec.ts`; Modify `packages/core/src/events.ts`, `packages/core/src/index.ts`.

- [ ] **Step 1:** Add `combineSinks` to `packages/core/src/events.ts` (append, keep existing):
```ts
/** Fan one event out to several sinks (errors in one do not stop the others). */
export function combineSinks(...sinks: EventSink[]): EventSink {
  const active = sinks.filter((s): s is EventSink => typeof s === 'function');
  if (active.length === 0) return noopSink;
  if (active.length === 1) return active[0] as EventSink;
  return (event) => {
    for (const s of active) {
      try {
        s(event);
      } catch {
        // a misbehaving sink must not break the others or the policy
      }
    }
  };
}
```

- [ ] **Step 2:** Write `packages/core/src/integration/event-emitter.ts`:
```ts
import type { EventSink, ResilienceEvent } from '../events';

/** Structural subset of EventEmitter2 — avoids importing @nestjs/event-emitter into core. */
export interface EventEmitterLike {
  emit(event: string, ...values: unknown[]): unknown;
}

/** Map a ResilienceEvent type to a dotted event name: `circuit-opened` → `resilience.circuit.opened`. */
export function resilienceEventName(type: string): string {
  return `resilience.${type.replace(/-/g, '.')}`;
}

/** An EventSink that mirrors each ResilienceEvent to an EventEmitter2-style emitter. */
export function eventEmitterSink(emitter: EventEmitterLike): EventSink {
  return (event: ResilienceEvent) => {
    emitter.emit(resilienceEventName(event.type), event);
  };
}
```

- [ ] **Step 3:** Write `packages/core/src/integration/event-emitter.spec.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { combineSinks } from '../events';
import { eventEmitterSink, resilienceEventName } from './event-emitter';

describe('eventEmitterSink', () => {
  it('mirrors events as dotted resilience.* names with the event payload', () => {
    const emit = vi.fn();
    const sink = eventEmitterSink({ emit });
    sink({ type: 'circuit-opened', key: 'sms:twilio', failures: 3 });
    expect(emit).toHaveBeenCalledWith('resilience.circuit.opened', { type: 'circuit-opened', key: 'sms:twilio', failures: 3 });
  });

  it('maps every event type', () => {
    expect(resilienceEventName('circuit-half-open')).toBe('resilience.circuit.half.open');
    expect(resilienceEventName('short-circuited')).toBe('resilience.short.circuited');
    expect(resilienceEventName('retry')).toBe('resilience.retry');
  });
});

describe('combineSinks', () => {
  it('fans one event out to every sink', () => {
    const a = vi.fn();
    const b = vi.fn();
    const sink = combineSinks(a, b);
    const ev = { type: 'timeout', key: 'k', ms: 100 } as const;
    sink(ev);
    expect(a).toHaveBeenCalledWith(ev);
    expect(b).toHaveBeenCalledWith(ev);
  });

  it('isolates a throwing sink so the others still fire', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const sink = combineSinks(bad, good);
    expect(() => sink({ type: 'retry', key: 'k' })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4:** Export from `packages/core/src/index.ts` (append):
```ts
export { combineSinks } from './events';
export { eventEmitterSink, resilienceEventName } from './integration/event-emitter';
export type { EventEmitterLike } from './integration/event-emitter';
```
(Note: `combineSinks` is added to the existing `events` export line area — if `events` already has a `export {...} from './events'` line, add `combineSinks` to it; otherwise add the line above.)

- [ ] **Step 5:** Gate: `pnpm -C packages/core test event-emitter` (pass), `pnpm -C packages/core test` (full suite green), `pnpm -C packages/core typecheck` (0), `pnpm -C packages/core build` (and confirm `grep -c '@nestjs/event-emitter' packages/core/dist/index.js` → 0 and `grep -c vitest packages/core/dist/index.js` → 0).

- [ ] **Step 6:** Commit `packages/core/src/integration/event-emitter.ts packages/core/src/integration/event-emitter.spec.ts packages/core/src/events.ts packages/core/src/index.ts` — `feat(core): eventEmitterSink + combineSinks for mirroring resilience events`.

---

### Task 2: wire into ResilienceService + module option + docs

**Files:** Modify `packages/core/src/nest/resilience.module.ts`, `packages/core/src/nest/resilience.service.ts`, `packages/core/src/nest/resilience.module.spec.ts`, `packages/core/README.md`; Create `.changeset/resilience-event-emitter.md`.

- [ ] **Step 1:** Add the option to `ResilienceModuleOptions` in `resilience.module.ts` (add the import + field):
```ts
import type { EventEmitterLike } from '../integration/event-emitter';
// inside interface ResilienceModuleOptions:
  /** Mirror resilience events to an EventEmitter2-style emitter (e.g. @nestjs/event-emitter). */
  eventEmitter?: EventEmitterLike;
```

- [ ] **Step 2:** Compose sinks in `resilience.service.ts`. Replace the `this.sink = ...` line and imports:
```ts
import { type EventSink, combineSinks, noopSink } from '../events';
import { eventEmitterSink } from '../integration/event-emitter';
// ...in the constructor:
    const base = options.emit === false ? noopSink : diagnosticsSink();
    this.sink = options.eventEmitter ? combineSinks(base, eventEmitterSink(options.eventEmitter)) : base;
```

- [ ] **Step 3:** Add a test to `resilience.module.spec.ts` (inside the existing describe):
```ts
it('mirrors events to a provided EventEmitter2-style emitter', async () => {
  const events: Array<{ name: string; payload: unknown }> = [];
  const emitter = { emit: (name: string, payload: unknown) => { events.push({ name, payload }); return true; } };
  const moduleRef = await Test.createTestingModule({
    imports: [ResilienceModule.forRoot({ emit: false, eventEmitter: emitter })],
  }).compile();
  const svc = moduleRef.get(ResilienceService);
  svc.sink({ type: 'circuit-opened', key: 'k', failures: 3 });
  expect(events).toEqual([{ name: 'resilience.circuit.opened', payload: { type: 'circuit-opened', key: 'k', failures: 3 } }]);
});
```
(`emit: false` isolates the assertion to the event-emitter sink, so the diagnostics sink — a no-op when nobody is subscribed — doesn't interfere.)

- [ ] **Step 4:** Gate: `pnpm -C packages/core test resilience.module` (pass), `pnpm -C packages/core test` (full green), `typecheck` (0), `build`. Confirm dist main barrel still has no `@nestjs/event-emitter` import.

- [ ] **Step 5:** README (core): add an "Event-emitter mirror" subsection — resilience events can be mirrored to `@nestjs/event-emitter` by passing your `EventEmitter2` as `eventEmitter`, idiomatically via `forRootAsync`:
```ts
ResilienceModule.forRootAsync({
  inject: [EventEmitter2],
  useFactory: (ee: EventEmitter2) => ({ eventEmitter: ee }),
});
// then: @OnEvent('resilience.circuit.opened') handles a payload of type ResilienceEvent
```
Note events are named `resilience.<type-dotted>` (e.g. `resilience.circuit.opened`), and the payload is the `ResilienceEvent`. Also mention `eventEmitterSink`/`combineSinks` are exported for manual composition.

- [ ] **Step 6:** Changeset `.changeset/resilience-event-emitter.md`:
```md
---
"@dudousxd/nestjs-resilience": minor
---

Add an optional @nestjs/event-emitter mirror: pass an EventEmitter2-style `eventEmitter` to `ResilienceModule` (or use the exported `eventEmitterSink`/`combineSinks`) to receive resilience events as `resilience.<type>` (e.g. `resilience.circuit.opened`) alongside the diagnostics channel. Core does not import @nestjs/event-emitter — the emitter is structurally typed.
```

- [ ] **Step 7:** Commit `packages/core/src/nest/resilience.module.ts packages/core/src/nest/resilience.service.ts packages/core/src/nest/resilience.module.spec.ts packages/core/README.md .changeset/resilience-event-emitter.md` — `feat(core): wire optional event-emitter mirror into ResilienceModule/Service`.

---

## Self-Review
- `eventEmitterSink` is pure, structural — no `@nestjs/event-emitter` import in core. ✅
- `combineSinks` fans out and isolates throwing sinks. ✅
- Service composes diagnostics + event-emitter when opted in; main barrel stays import-clean. ✅

## Notes for the implementer
- The whole point is NO hard import of `@nestjs/event-emitter` in core — the emitter is a structural `{ emit(name, ...values) }`. Verify the built `dist/index.js` does not import it.
- `emit: false` in the module test isolates the assertion to the event-emitter sink.
