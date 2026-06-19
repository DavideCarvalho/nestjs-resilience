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
