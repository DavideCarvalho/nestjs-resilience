import { runResilienceStoreContract } from '@dudousxd/nestjs-resilience/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  async function hsetCalls(): Promise<number> {
    const info = await redis.info('commandstats');
    const m = /cmdstat_hset:calls=(\d+)/.exec(info);
    return m ? Number(m[1]) : 0;
  }

  it('writes nothing for successful calls on a clean closed circuit', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new RedisResilienceStore(redis, { keyPrefix: 'clean:' });
    await store.record('k', cfg, false, false);
    await store.record('k', cfg, true, false);
    const before = await redis.hgetall('clean:k');
    const calls = await hsetCalls();
    for (let i = 0; i < 5; i++) {
      const a = await store.admit('k', cfg);
      expect(a.allow).toBe(true);
      expect(await store.record('k', cfg, true, a.probe)).toBe('closed');
    }
    expect(await hsetCalls()).toBe(calls);
    expect(await redis.hgetall('clean:k')).toEqual(before);
  });

  it('does not create a hash for a key that has only ever succeeded', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new RedisResilienceStore(redis, { keyPrefix: 'fresh:' });
    await store.admit('k', cfg);
    await store.record('k', cfg, true, false);
    expect(await redis.exists('fresh:k')).toBe(0);
  });

  it('a success after failures resets the circuit', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new RedisResilienceStore(redis, { keyPrefix: 'reset:' });
    await store.record('k', cfg, false, false);
    await store.record('k', cfg, false, false);
    await store.record('k', cfg, true, false);
    expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 0 });
  });
});
