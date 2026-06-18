import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import { DataSource } from 'typeorm';
import { TypeOrmResilienceStore } from './typeorm.store';

const skip = !!process.env.SKIP_TESTCONTAINERS;
const suite = skip ? describe.skip : describe;

suite('TypeOrmResilienceStore (real Postgres)', () => {
  let pg: StartedPostgreSqlContainer;
  let ds: DataSource;
  let n = 0;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    ds = new DataSource({ type: 'postgres', url: pg.getConnectionUri() });
    await ds.initialize();
    // Create the table once — idempotent, avoids race with per-store ensureSchema calls.
    await new TypeOrmResilienceStore(ds).ensureSchema();
  }, 240_000);

  afterAll(async () => {
    await ds?.destroy();
    await pg?.stop();
  });

  // Unique table-key namespace per makeStore call: the contract reuses key 'k'. We isolate by
  // prefixing the key inside a wrapper store so each case sees a clean circuit on the shared table.
  runResilienceStoreContract('TypeOrmResilienceStore', (clock) => {
    const prefix = `t${++n}:`;
    const store = new TypeOrmResilienceStore(ds, { clock });
    return new Proxy(store, {
      get(target, p) {
        const orig = (target as unknown as Record<string, unknown>)[p as string];
        if (typeof orig === 'function' && (p === 'admit' || p === 'record' || p === 'snapshot')) {
          return (key: string, ...rest: unknown[]) => (orig as (...a: unknown[]) => unknown).call(target, prefix + key, ...rest);
        }
        return orig;
      },
    }) as TypeOrmResilienceStore;
  });
});
