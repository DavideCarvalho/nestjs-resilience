import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DrizzleResilienceStore } from './drizzle.store';
import { CIRCUITS_DDL, resilienceSchema } from './schema';

// Fresh in-memory SQLite per makeStore call → each contract case is isolated.
runResilienceStoreContract('DrizzleResilienceStore', (clock) => {
  const sqlite = new Database(':memory:');
  sqlite.exec(CIRCUITS_DDL);
  const db = drizzle(sqlite, { schema: resilienceSchema });
  return new DrizzleResilienceStore(db, { clock });
});

describe('DrizzleResilienceStore.snapshot', () => {
  it('returns the closed default for a never-seen key', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(CIRCUITS_DDL);
    const db = drizzle(sqlite, { schema: resilienceSchema });
    const store = new DrizzleResilienceStore(db);
    expect(await store.snapshot('nope')).toEqual({ status: 'closed', failures: 0 });
  });
});
