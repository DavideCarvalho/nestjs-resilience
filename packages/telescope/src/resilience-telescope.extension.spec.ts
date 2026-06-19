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

  it('openCircuits uses max-ts regardless of result ordering', async () => {
    const { ctx, storage } = await makeCtx();
    // store the NEWER (closed) transition first, the OLDER (opened) second
    await storage.store([
      resilienceEntry(content({ event: 'circuit-closed', key: 'C', ts: 10 })),
      resilienceEntry(content({ event: 'circuit-opened', key: 'C', ts: 1 })),
    ]);

    const provider = nestjsResilienceTelescope()
      .dataProviders?.(ctx)
      .find((p) => p.name === 'resilience.openCircuits');
    const result = (await provider?.resolve({}, ctx)) as { value: number };

    expect(result.value).toBe(0); // latest transition by ts is 'circuit-closed'
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
