import type { SqlDriver, SqlResilienceStoreOptions } from '@dudousxd/nestjs-resilience';
import { SqlResilienceStore } from '@dudousxd/nestjs-resilience';

/** Structural subset of PrismaClient the adapter needs (avoids importing a generated client type). */
export interface PrismaLike {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<R>(fn: (tx: PrismaLike) => Promise<R>): Promise<R>;
}

export type PrismaResilienceStoreOptions = SqlResilienceStoreOptions;

/** Postgres-backed ResilienceStore using Prisma's raw-query API inside an interactive transaction. */
export class PrismaResilienceStore extends SqlResilienceStore {
  constructor(prisma: PrismaLike, opts: PrismaResilienceStoreOptions = {}) {
    super(prismaDriver(prisma), opts);
  }
}

function prismaDriver(prisma: PrismaLike): SqlDriver {
  return {
    placeholders: 'numbered',
    transaction: (body) =>
      prisma.$transaction((tx) =>
        body({
          run: async (sql, params) => {
            await tx.$executeRawUnsafe(sql, ...params);
          },
          all: (sql, params) => tx.$queryRawUnsafe<unknown[]>(sql, ...params),
        }),
      ),
    read: (sql, params) => prisma.$queryRawUnsafe<unknown[]>(sql, ...params),
    exec: async (sql) => {
      await prisma.$executeRawUnsafe(sql);
    },
  };
}
