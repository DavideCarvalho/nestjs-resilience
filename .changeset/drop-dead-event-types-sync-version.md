---
"@dudousxd/nestjs-resilience": minor
---

Drop the dead `'timeout'` and `'retry'` members from the public `ResilienceEventType`
union — no policy ever emitted them (only `circuit-opened`/`circuit-closed`/`circuit-half-open`/
`short-circuited` and `failover` are emitted), so the type now reflects reality. `timeout` and
`retry` remain valid *policy* names; only the dead event-type members are removed.

Also sync the exported `VERSION` const with `package.json` (was stale at `0.1.0`). A new
`scripts/sync-version.mjs` is chained into the `version` (`changeset version`) script so future
release bumps keep `src/index.ts` and `package.json` in lockstep; it also doubles as a `--check`
drift guard.
