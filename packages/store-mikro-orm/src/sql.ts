import type { CircuitState, CircuitStatus } from '@dudousxd/nestjs-resilience';
import { INITIAL_CIRCUIT_STATE } from '@dudousxd/nestjs-resilience';

/** DDL — idempotent, safe to run on every startup. */
export const CIRCUITS_DDL = `
CREATE TABLE IF NOT EXISTS resilience_circuits (
  key        TEXT PRIMARY KEY,
  status     TEXT    NOT NULL DEFAULT 'closed',
  failures   INTEGER NOT NULL DEFAULT 0,
  open_until BIGINT  NOT NULL DEFAULT 0,
  probes     INTEGER NOT NULL DEFAULT 0
);`;

/** Ensure the row exists (no-op if already present). */
export const INSERT_INITIAL = `
INSERT INTO resilience_circuits (key, status, failures, open_until, probes)
VALUES (?, 'closed', 0, 0, 0)
ON CONFLICT (key) DO NOTHING;`;

/** Pessimistic lock — must run inside the same transaction as INSERT_INITIAL. */
export const SELECT_FOR_UPDATE = `
SELECT status, failures, open_until, probes
FROM resilience_circuits
WHERE key = ?
FOR UPDATE;`;

/** Non-locking read for snapshot(). */
export const SELECT_PLAIN = `
SELECT status, failures, open_until, probes
FROM resilience_circuits
WHERE key = ?;`;

/** Persist the new state. Parameters: status, failures, open_until, probes, key. */
export const UPDATE_STATE = `
UPDATE resilience_circuits
SET status = ?, failures = ?, open_until = ?, probes = ?
WHERE key = ?;`;

/** Map a raw Postgres row (or undefined) to a CircuitState. */
export function rowToState(row: Record<string, unknown> | undefined): CircuitState {
  if (!row) return { ...INITIAL_CIRCUIT_STATE };
  return {
    status: row['status'] as CircuitStatus,
    failures: Number(row['failures']),
    openUntil: Number(row['open_until']),
    probes: Number(row['probes']),
  };
}
