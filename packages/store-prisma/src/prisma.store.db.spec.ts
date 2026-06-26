import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import type { PrismaLike } from './prisma.store';
import { PrismaResilienceStore } from './prisma.store';

const skip = !!process.env.SKIP_TESTCONTAINERS;
const suite = skip ? describe.skip : describe;

suite('PrismaResilienceStore (real Postgres)', () => {
  let pg: StartedPostgreSqlContainer;
  let prisma: PrismaLike & { $disconnect(): Promise<void> };
  let n = 0;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    const mod = (await import('../node_modules/.prisma/resilience-client/index.js')) as unknown as {
      PrismaClient: new (opts: unknown) => PrismaLike & { $disconnect(): Promise<void> };
    };
    prisma = new mod.PrismaClient({ datasources: { db: { url: pg.getConnectionUri() } } });
    // Create the table once — idempotent, avoids race with per-store ensureSchema calls.
    await new PrismaResilienceStore(prisma).ensureSchema();
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pg?.stop();
  });

  // Unique table-key namespace per makeStore call: the contract reuses key 'k'. We isolate by
  // prefixing the key inside a wrapper store so each case sees a clean circuit on the shared table.
  runResilienceStoreContract('PrismaResilienceStore', (clock) => {
    const prefix = `t${++n}:`;
    const store = new PrismaResilienceStore(prisma, { clock });
    return new Proxy(store, {
      get(target, p) {
        const orig = (target as unknown as Record<string, unknown>)[p as string];
        if (typeof orig === 'function' && (p === 'admit' || p === 'record' || p === 'snapshot')) {
          return (key: string, ...rest: unknown[]) =>
            (orig as (...a: unknown[]) => unknown).call(target, prefix + key, ...rest);
        }
        return orig;
      },
    }) as PrismaResilienceStore;
  });
});
