import type { SqlDriver, SqlResilienceStoreOptions } from '@dudousxd/nestjs-resilience';
import { SqlResilienceStore } from '@dudousxd/nestjs-resilience';
import type { MikroORM } from '@mikro-orm/core';

export type MikroOrmResilienceStoreOptions = SqlResilienceStoreOptions;

/** Postgres-backed ResilienceStore using a forked MikroORM EntityManager per transaction. */
export class MikroOrmResilienceStore extends SqlResilienceStore {
  constructor(orm: MikroORM, opts: MikroOrmResilienceStoreOptions = {}) {
    super(mikroOrmDriver(orm), opts);
  }
}

function mikroOrmDriver(orm: MikroORM): SqlDriver {
  return {
    placeholders: 'positional',
    transaction: (body) =>
      orm.em.fork().transactional((tx) => {
        const conn = tx.getConnection('write');
        const ctx = tx.getTransactionContext();
        if (!ctx) {
          throw new Error(
            'MikroOrmResilienceStore requires DB transactions for atomic circuit updates; do not set disableTransactions on the MikroORM instance.',
          );
        }
        return body({
          run: async (sql, params) => {
            await conn.execute(sql, params, 'run', ctx);
          },
          all: (sql, params) => conn.execute(sql, params, 'all', ctx) as Promise<unknown[]>,
        });
      }),
    read: (sql, params) => orm.em.getConnection().execute(sql, params, 'all') as Promise<unknown[]>,
    exec: async (sql) => {
      await orm.em.getConnection().execute(sql);
    },
  };
}
