import { describe, expect, it, vi } from 'vitest';
import { RedisResilienceStore } from './redis.store';

// Minimal fake: only the methods snapshot() and defineCommand touch.
function fakeRedis(hmgetReply: (string | null)[]) {
  return {
    defineCommand: vi.fn(),
    cbAdmit: vi.fn(),
    cbRecord: vi.fn(),
    hmget: vi.fn(async (..._args: unknown[]) => hmgetReply),
  };
}

describe('RedisResilienceStore.snapshot', () => {
  it('returns the closed default for a never-seen key (no openUntil field)', async () => {
    const redis = fakeRedis([null, null, null]);
    const store = new RedisResilienceStore(redis as never, { keyPrefix: 'p:' });
    const snap = await store.snapshot('k');
    expect(snap).toEqual({ status: 'closed', failures: 0 });
    expect(snap.openUntil).toBeUndefined();
    // applied the prefix
    expect(redis.hmget).toHaveBeenCalledWith('p:k', 'status', 'failures', 'openUntil');
  });

  it('parses an open snapshot with failures and openUntil', async () => {
    const redis = fakeRedis(['open', '3', '5000']);
    const store = new RedisResilienceStore(redis as never);
    expect(await store.snapshot('k')).toEqual({ status: 'open', failures: 3, openUntil: 5000 });
  });

  it('omits openUntil when it is 0', async () => {
    const redis = fakeRedis(['closed', '0', '0']);
    const store = new RedisResilienceStore(redis as never);
    expect(await store.snapshot('k')).toEqual({ status: 'closed', failures: 0 });
  });
});

describe('RedisResilienceStore success fast path', () => {
  const cfg = { threshold: 3, cooldownMs: 1000 };

  type AdmitReply = [number, number, string, number];

  /** Resolve the i-th `cbAdmit` call, in whatever order the test needs. */
  function reply(redis: ReturnType<typeof deferredRedis>, i: number, value: AdmitReply): void {
    const resolve = redis.admits[i];
    if (!resolve) throw new Error(`cbAdmit call ${i} was not made`);
    resolve(value);
  }

  function deferredRedis() {
    const admits: Array<(reply: AdmitReply) => void> = [];
    return {
      admits,
      defineCommand: vi.fn(),
      cbAdmit: vi.fn(() => new Promise<AdmitReply>((resolve) => admits.push(resolve))),
      cbRecord: vi.fn(async () => 'closed'),
      hmget: vi.fn(),
    };
  }

  it('skips the record round-trip for a success after a clean admit', async () => {
    const redis = deferredRedis();
    const store = new RedisResilienceStore(redis as never);
    const p = store.admit('k', cfg);
    reply(redis, 0, [1, 0, 'closed', 1]);
    await p;
    expect(await store.record('k', cfg, true, false)).toBe('closed');
    expect(redis.cbRecord).not.toHaveBeenCalled();
  });

  it('always sends failures, probe outcomes, and successes after a dirty admit', async () => {
    const redis = deferredRedis();
    const store = new RedisResilienceStore(redis as never);
    const p = store.admit('k', cfg);
    reply(redis, 0, [1, 0, 'closed', 1]);
    await p;
    await store.record('k', cfg, false, false);
    await store.record('k', cfg, true, true);
    // the failure cleared the local clean mark, so this success goes to Redis too
    await store.record('k', cfg, true, false);
    expect(redis.cbRecord).toHaveBeenCalledTimes(3);
    const dirty = store.admit('k', cfg);
    reply(redis, 1, [1, 0, 'closed', 0]);
    await dirty;
    await store.record('k', cfg, true, false);
    expect(redis.cbRecord).toHaveBeenCalledTimes(4);
  });

  it('an admit in flight when a failure is sent cannot mark the circuit clean', async () => {
    const redis = deferredRedis();
    const store = new RedisResilienceStore(redis as never);
    const stale = store.admit('k', cfg); // read by Redis before the failure below lands
    await store.record('k', cfg, false, false);
    reply(redis, 0, [1, 0, 'closed', 1]);
    await stale;
    await store.record('k', cfg, true, false);
    expect(redis.cbRecord).toHaveBeenCalledTimes(2);
  });

  it('an older admit reply does not overwrite a newer one', async () => {
    const redis = deferredRedis();
    const store = new RedisResilienceStore(redis as never);
    const older = store.admit('k', cfg);
    const newer = store.admit('k', cfg);
    reply(redis, 1, [1, 0, 'closed', 0]);
    await newer;
    reply(redis, 0, [1, 0, 'closed', 1]);
    await older;
    await store.record('k', cfg, true, false);
    expect(redis.cbRecord).toHaveBeenCalledTimes(1);
  });

  it('sends every outcome when successFastPath is false', async () => {
    const redis = deferredRedis();
    const store = new RedisResilienceStore(redis as never, { successFastPath: false });
    const p = store.admit('k', cfg);
    reply(redis, 0, [1, 0, 'closed', 1]);
    await p;
    await store.record('k', cfg, true, false);
    expect(redis.cbRecord).toHaveBeenCalledTimes(1);
  });
});
