---
'@dudousxd/nestjs-resilience-store-redis': minor
---

Cut the Redis commands per circuit-breaker call. The `cbAdmit` and `cbRecord` scripts now read the circuit hash with one `HMGET` instead of up to three `HGET`s, and a new `successFastPath` option (default `true`) skips the `record` script for a success when the store's latest `admit` saw a clean closed circuit. A healthy call goes from 8 commands to 2 (4 with `successFastPath: false`). Failures and half-open probe outcomes are always recorded, and `admit` still reads Redis on every call.
