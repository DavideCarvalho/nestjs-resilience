---
"@dudousxd/nestjs-resilience": patch
"@dudousxd/nestjs-resilience-store-drizzle": patch
"@dudousxd/nestjs-resilience-store-mikro-orm": patch
"@dudousxd/nestjs-resilience-store-prisma": patch
"@dudousxd/nestjs-resilience-store-redis": patch
"@dudousxd/nestjs-resilience-store-typeorm": patch
"@dudousxd/nestjs-resilience-telescope": patch
---

Deprecated: use NestJS's own [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience). This is the last release; it carries only the deprecation notice and the migration guide. The distributed circuit-breaker state (the store packages) has no official equivalent: the official breaker keeps its state in each process.
