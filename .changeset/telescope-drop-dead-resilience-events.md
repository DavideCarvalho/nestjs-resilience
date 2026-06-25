---
"@dudousxd/nestjs-resilience-telescope": patch
---

Drop dead `timeout`/`retry` members from the telescope `ResilienceEventType` union and remove `timeout` from `FAILED_EVENTS`. No resilience policy emits those events, so the watcher never received them — this aligns the telescope integration with the core package, which dropped the same dead event types. The `event` field stays typed as `string`, so unknown future events are still tolerated.
