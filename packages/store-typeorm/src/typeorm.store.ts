import type { SqlDriver, SqlResilienceStoreOptions } from '@dudousxd/nestjs-resilience';
import { SqlResilienceStore } from '@dudousxd/nestjs-resilience';
import type { DataSource } from 'typeorm';

export type TypeOrmResilienceStoreOptions = SqlResilienceStoreOptions;

/** Postgres-backed ResilienceStore using a TypeORM `DataSource` for transactions and queries. */
export class TypeOrmResilienceStore extends SqlResilienceStore {
  constructor(ds: DataSource, opts: TypeOrmResilienceStoreOptions = {}) {
    super(typeOrmDriver(ds), opts);
  }
}

function typeOrmDriver(ds: DataSource): SqlDriver {
  return {
    placeholders: 'numbered',
    transaction: (body) =>
      ds.transaction((em) =>
        body({
          run: async (sql, params) => {
            await em.query(sql, params);
          },
          all: (sql, params) => em.query(sql, params) as Promise<unknown[]>,
        }),
      ),
    read: (sql, params) => ds.query(sql, params) as Promise<unknown[]>,
    exec: async (sql) => {
      await ds.query(sql);
    },
  };
}
