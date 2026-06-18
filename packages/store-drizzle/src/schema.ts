import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per circuit key. status/openUntil/probes/failures mirror core's CircuitState. */
export const circuits = sqliteTable('resilience_circuits', {
  key: text('key').primaryKey(),
  status: text('status').notNull(),
  failures: integer('failures').notNull(),
  openUntil: integer('open_until').notNull(),
  probes: integer('probes').notNull(),
});

export const resilienceSchema = { circuits };

/** Raw DDL for tests / manual setup (no migration tool required). */
export const CIRCUITS_DDL = `
CREATE TABLE IF NOT EXISTS resilience_circuits (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  failures INTEGER NOT NULL,
  open_until INTEGER NOT NULL,
  probes INTEGER NOT NULL
);`;
