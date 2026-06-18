import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe } from 'vitest';
import { RedisResilienceStore } from './redis.store';

// Skips cleanly when SKIP_TESTCONTAINERS is set (e.g. no Docker). Run with `pnpm -C packages/store-redis test:db`.
const skip = !!process.env.SKIP_TESTCONTAINERS;
const suite = skip ? describe.skip : describe;
const CONTAINER_TIMEOUT = 180_000;

suite('RedisResilienceStore (real Redis)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let n = 0;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis({ host: container.getHost(), port: container.getFirstMappedPort() });
  }, CONTAINER_TIMEOUT);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });

  // Fresh key namespace per makeStore call → the contract's reuse of key 'k' is isolated per case.
  runResilienceStoreContract(
    'RedisResilienceStore',
    (clock) => new RedisResilienceStore(redis, { clock, keyPrefix: `t${++n}:` }),
  );
});
