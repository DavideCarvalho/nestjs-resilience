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
    (clock) => new RedisResilienceStore(redis, { clock, keyPrefix: `t${++n}:`, successFastPath: true }),
  );

  runResilienceStoreContract(
    'RedisResilienceStore (successFastPath: false)',
    (clock) =>
      new RedisResilienceStore(redis, { clock, keyPrefix: `nf${++n}:`, successFastPath: false }),
  );

  async function commandStats(): Promise<Record<string, number>> {
    const info = await redis.info('commandstats');
    const out: Record<string, number> = {};
    for (const [, name = '', calls] of info.matchAll(/cmdstat_([^:]+):calls=(\d+)/g))
      out[name] = Number(calls);
    return out;
  }

  async function hsetCalls(): Promise<number> {
    return (await commandStats()).hset ?? 0;
  }

  /** Commands Redis ran during `run` (the trailing INFO call excluded), by name. */
  async function countCommands(run: () => Promise<void>): Promise<Record<string, number>> {
    const before = await commandStats();
    await run();
    const after = await commandStats();
    const diff: Record<string, number> = {};
    for (const [name, calls] of Object.entries(after)) {
      const d = calls - (before[name] ?? 0) - (name === 'info' ? 1 : 0);
      if (d > 0) diff[name] = d;
    }
    return diff;
  }

  const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

  it('writes nothing for successful calls on a clean closed circuit', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new RedisResilienceStore(redis, { keyPrefix: 'clean:', successFastPath: true });
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
    const store = new RedisResilienceStore(redis, { keyPrefix: 'fresh:', successFastPath: true });
    await store.admit('k', cfg);
    await store.record('k', cfg, true, false);
    expect(await redis.exists('fresh:k')).toBe(0);
  });

  it('a success after failures resets the circuit', async () => {
    const cfg = { threshold: 3, cooldownMs: 1000 };
    const store = new RedisResilienceStore(redis, { keyPrefix: 'reset:', successFastPath: true });
    await store.record('k', cfg, false, false);
    await store.record('k', cfg, false, false);
    await store.record('k', cfg, true, false);
    expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 0 });
  });

  describe('Redis cost per call', () => {
    const cfg = { threshold: 5, cooldownMs: 60_000 };
    const N = 50;

    async function healthyCalls(store: RedisResilienceStore) {
      // Warm up: loads the scripts (EVALSHA falls back to EVAL once) and the local health.
      const a = await store.admit('k', cfg);
      await store.record('k', cfg, true, a.probe);
      return countCommands(async () => {
        for (let i = 0; i < N; i++) {
          const adm = await store.admit('k', cfg);
          await store.record('k', cfg, true, adm.probe);
        }
      });
    }

    it('a healthy call costs 2 commands with the fast path (admit only)', async () => {
      const c = await healthyCalls(new RedisResilienceStore(redis, { keyPrefix: 'cost-fp:', successFastPath: true }));
      expect(c).toEqual({ evalsha: N, hmget: N });
      expect(total(c) / N).toBe(2);
    });

    it('a healthy call costs 4 commands without the fast path (one HMGET per script)', async () => {
      const c = await healthyCalls(
        new RedisResilienceStore(redis, { keyPrefix: 'cost-nofp:', successFastPath: false }),
      );
      expect(c).toEqual({ evalsha: 2 * N, hmget: 2 * N });
    });

    it('scripts never read the hash field by field', async () => {
      const store = new RedisResilienceStore(redis, { keyPrefix: 'cost-mixed:', successFastPath: true });
      const once = { threshold: 1, cooldownMs: 0 };
      const c = await countCommands(async () => {
        for (let i = 0; i < 20; i++) {
          const a = await store.admit('k', cfg);
          if (a.allow) await store.record('k', cfg, i % 3 !== 0, a.probe);
        }
        // open → half-open → probe paths
        await store.record('h', once, false, false);
        const p = await store.admit('h', once);
        expect(p.probe).toBe(true);
        await store.record('h', once, true, p.probe);
      });
      expect(c.hget ?? 0).toBe(0);
    });
  });

  describe('success fast path', () => {
    const cfg = { threshold: 3, cooldownMs: 60_000 };

    it('never skips a failure: failures after clean successes still open the circuit', async () => {
      const store = new RedisResilienceStore(redis, { keyPrefix: 'fp-fail:', successFastPath: true });
      for (let i = 0; i < 5; i++) {
        const a = await store.admit('k', cfg);
        await store.record('k', cfg, true, a.probe);
      }
      for (let i = 0; i < 2; i++) {
        const a = await store.admit('k', cfg);
        expect(a.allow).toBe(true);
        expect(await store.record('k', cfg, false, a.probe)).toBe('closed');
      }
      expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 2 });
      const a = await store.admit('k', cfg);
      expect(await store.record('k', cfg, false, a.probe)).toBe('open');
      expect((await store.admit('k', cfg)).allow).toBe(false);
    });

    it('a success after a local failure still reaches Redis and resets the count', async () => {
      const store = new RedisResilienceStore(redis, { keyPrefix: 'fp-reset:', successFastPath: true });
      const a1 = await store.admit('k', cfg); // clean
      const a2 = await store.admit('k', cfg); // clean
      await store.record('k', cfg, false, a2.probe); // failures = 1
      expect(await store.record('k', cfg, true, a1.probe)).toBe('closed');
      expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 0 });
    });

    it('observes a circuit another instance opened on the next admit', async () => {
      const other = new Redis({ host: container.getHost(), port: container.getFirstMappedPort() });
      try {
        const a = new RedisResilienceStore(redis, { keyPrefix: 'fp-fleet:', successFastPath: true });
        const b = new RedisResilienceStore(other, { keyPrefix: 'fp-fleet:', successFastPath: true });
        const first = await a.admit('k', cfg);
        await a.record('k', cfg, true, first.probe);
        const inFlight = await a.admit('k', cfg); // clean when admitted
        for (let i = 0; i < 3; i++) await b.record('k', cfg, false, false);
        // The in-flight success is skipped: it does not close the circuit the other instance opened.
        expect(await a.record('k', cfg, true, inFlight.probe)).toBe('closed');
        expect((await a.snapshot('k')).status).toBe('open');
        const next = await a.admit('k', cfg);
        expect(next).toEqual({ allow: false, probe: false, status: 'open' });
      } finally {
        other.disconnect();
      }
    });

    it('records half-open probe outcomes as before', async () => {
      let now = 0;
      const clock = { now: () => now };
      const store = new RedisResilienceStore(redis, { keyPrefix: 'fp-probe:', clock, successFastPath: true });
      for (let i = 0; i < 3; i++) await store.record('k', cfg, false, false);
      now += cfg.cooldownMs;
      const probe = await store.admit('k', cfg);
      expect(probe).toEqual({ allow: true, probe: true, status: 'half-open' });
      expect(await store.record('k', cfg, false, true)).toBe('open');
      now += cfg.cooldownMs;
      const again = await store.admit('k', cfg);
      expect(again.probe).toBe(true);
      expect(await store.record('k', cfg, true, true)).toBe('closed');
      expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 0 });
      expect(await redis.hget('fp-probe:k', 'probes')).toBe('0');
    });
  });
});
