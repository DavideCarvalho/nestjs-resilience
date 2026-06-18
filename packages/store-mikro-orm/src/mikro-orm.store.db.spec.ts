import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import { MikroOrmResilienceStore } from './mikro-orm.store';

const skip = !!process.env.SKIP_TESTCONTAINERS;
const suite = skip ? describe.skip : describe;

suite('MikroOrmResilienceStore (real Postgres)', () => {
  let pg: StartedPostgreSqlContainer;
  let orm: import('@mikro-orm/core').MikroORM;
  let n = 0;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();
    const { MikroORM } = await import('@mikro-orm/postgresql');
    orm = await MikroORM.init({
      clientUrl: pg.getConnectionUri(),
      entities: [],
      discovery: { warnWhenNoEntities: false },
    });
    // Create the table once — idempotent, avoids race with per-store ensureSchema calls.
    await new MikroOrmResilienceStore(orm).ensureSchema();
  }, 240_000);

  afterAll(async () => {
    await orm?.close();
    await pg?.stop();
  });

  // Unique table-key namespace per makeStore call: the contract reuses key 'k'. We isolate by
  // prefixing the key inside a wrapper store so each case sees a clean circuit on the shared table.
  runResilienceStoreContract('MikroOrmResilienceStore', (clock) => {
    const prefix = `t${++n}:`;
    const store = new MikroOrmResilienceStore(orm, { clock });
    return new Proxy(store, {
      get(target, p) {
        const orig = (target as unknown as Record<string, unknown>)[p as string];
        if (typeof orig === 'function' && (p === 'admit' || p === 'record' || p === 'snapshot')) {
          return (key: string, ...rest: unknown[]) => (orig as (...a: unknown[]) => unknown).call(target, prefix + key, ...rest);
        }
        return orig;
      },
    }) as MikroOrmResilienceStore;
  });
});
