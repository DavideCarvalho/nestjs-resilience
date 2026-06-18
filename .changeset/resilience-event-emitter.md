---
"@dudousxd/nestjs-resilience": minor
---

Add an optional @nestjs/event-emitter mirror: pass an EventEmitter2-style `eventEmitter` to `ResilienceModule` (or use the exported `eventEmitterSink`/`combineSinks`) to receive resilience events as `resilience.<type>` (e.g. `resilience.circuit.opened`) alongside the diagnostics channel. Core does not import @nestjs/event-emitter — the emitter is structurally typed.
