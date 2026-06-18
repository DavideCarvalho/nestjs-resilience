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
