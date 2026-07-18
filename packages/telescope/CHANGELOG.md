# @dudousxd/nestjs-resilience-telescope

## 0.2.1

### Patch Changes

- 468bbd6: Metadata: package description no longer lists the removed `timeout`/`retry` events (only circuit-breaker / failover are recorded).

## 0.2.0

### Minor Changes

- 308b0db: Add the Telescope extension package: a `ResilienceWatcher` that records `aviary:resilience:*`
  diagnostics events as `resilience` entries, plus `nestjsResilienceTelescope()` contributing the
  navigable entry type and a Resilience overview dashboard (open circuits, failovers, most-tripped
  circuits, recent transitions).

### Patch Changes

- 6c6b859: Ship TanStack Intent agent skills (SKILL.md) inside the package.
- ee6a78e: Drop dead `timeout`/`retry` members from the telescope `ResilienceEventType` union and remove `timeout` from `FAILED_EVENTS`. No resilience policy emits those events, so the watcher never received them — this aligns the telescope integration with the core package, which dropped the same dead event types. The `event` field stays typed as `string`, so unknown future events are still tolerated.
