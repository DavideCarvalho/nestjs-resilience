---
"@dudousxd/nestjs-resilience": patch
---

Add NestJS 12 to the supported peer range.

`@nestjs/common` and `@nestjs/core` now peer `^10 || ^11 || ^12`, and the dev/test
matrix runs on `@nestjs/*@12.0.1`. No source changes were needed — build, typecheck
and the unit suite pass unchanged on v12.

The dev dependencies pin `^12.0.1` rather than `^12`: `@nestjs/core@12.0.0` shipped
with its peer ranges still declaring `@nestjs/common@^11.0.0`, so resolving to
12.0.0 produces spurious unmet-peer warnings. 12.0.1 corrects them.
