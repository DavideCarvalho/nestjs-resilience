---
"@dudousxd/nestjs-resilience-store-redis": minor
---

`successFastPath` is now opt-in (default `false`): an upgrade keeps sending every outcome to Redis, exactly as before 0.3.0. Pass `successFastPath: true` to skip the `record` round-trip on clean successes (2 instead of 4 Redis commands per healthy call). The one HMGET per script stays on for everyone (4 instead of 8).
