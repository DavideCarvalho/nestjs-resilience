import { FakeClock } from '@dudousxd/nestjs-resilience';
import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
          return (key: string, ...rest: unknown[]) =>
            (orig as (...a: unknown[]) => unknown).call(target, prefix + key, ...rest);
        }
        return orig;
      },
    }) as TypeOrmResilienceStore;
  });

  it('leaves the row untouched across successful calls on a closed circuit', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new TypeOrmResilienceStore(ds, { clock: new FakeClock() });
    const xmin = async () =>
      (
        (await ds.query('SELECT xmin::text AS v FROM resilience_circuits WHERE key = $1', [
          'clean',
        ])) as { v: string }[]
      )[0]?.v;
    await store.record('clean', cfg, false, false);
    await store.record('clean', cfg, true, false);
    const before = await xmin();
    expect(before).toBeDefined();
    for (let i = 0; i < 5; i++) {
      const a = await store.admit('clean', cfg);
      expect(a.allow).toBe(true);
      await store.record('clean', cfg, true, a.probe);
    }
    expect(await xmin()).toBe(before);
    expect(await store.snapshot('clean')).toEqual({ status: 'closed', failures: 0 });
  });

  it('does not create a row for a key that has only ever succeeded', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new TypeOrmResilienceStore(ds);
    await store.admit('fresh', cfg);
    await store.record('fresh', cfg, true, false);
    const rows = await ds.query('SELECT 1 FROM resilience_circuits WHERE key = $1', ['fresh']);
    expect(rows).toHaveLength(0);
  });
});
