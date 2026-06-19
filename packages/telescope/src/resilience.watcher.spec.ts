import { emit, resetRegistry, setContextAccessor } from '@dudousxd/nestjs-diagnostics';
import { collectWatcherEntries } from '@dudousxd/nestjs-telescope-testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ResilienceEntryContent, ResilienceWatcher } from './resilience.watcher';

describe('ResilienceWatcher', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    resetRegistry();
    setContextAccessor(null);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    setContextAccessor(null);
  });

  it('records a circuit event: type, familyHash=key, failed tag, lifted content', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'payments' });

    expect(recorded).toHaveLength(1);
    const input = recorded[0];
    expect(input?.type).toBe('resilience');
    expect(input?.familyHash).toBe('payments');
    expect(input?.tags).toEqual(['event:circuit-opened', 'key:payments', 'failed']);
    expect(input?.content).toMatchObject<Partial<ResilienceEntryContent>>({
      event: 'circuit-opened',
      key: 'payments',
      target: null,
      index: null,
      error: null,
    });
  });

  it('ignores events from other libraries', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('authz', 'decision', { allow: true });

    expect(recorded).toHaveLength(0);
  });

  it('subscribes to a resilience channel registered before register()', async () => {
    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'a' }); // registers channel, no subscriber yet
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher); // register() loops registeredChannels()
    cleanup = () => watcher.cleanup();

    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'a' });

    expect(recorded).toHaveLength(1); // only the post-subscribe emit
  });

  it('lifts failover target/index/error and groups by event when key absent', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'failover', { type: 'failover', target: 'vonage', index: 1, error: 'boom' });

    const input = recorded[0];
    expect(input?.familyHash).toBe('failover');
    expect(input?.tags).not.toContain('failed');
    expect(input?.content).toMatchObject<Partial<ResilienceEntryContent>>({
      event: 'failover',
      key: null,
      target: 'vonage',
      index: 1,
      error: 'boom',
    });
  });

  it('does not tag circuit-closed as failed', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'circuit-closed', { type: 'circuit-closed', key: 'payments' });

    expect(recorded[0]?.tags).not.toContain('failed');
  });

  it('carries the envelope traceId into content and a trace tag', async () => {
    setContextAccessor({
      traceId: () => 'trace-xyz',
      tenantId: () => undefined,
      userRef: () => undefined,
      get: () => undefined,
    });
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    cleanup = () => watcher.cleanup();

    emit('resilience', 'short-circuited', { type: 'short-circuited', key: 'payments' });

    expect((recorded[0]?.content as ResilienceEntryContent).traceId).toBe('trace-xyz');
    expect(recorded[0]?.tags).toContain('trace:trace-xyz');
  });

  it('stops recording after cleanup()', async () => {
    const watcher = new ResilienceWatcher();
    const { recorded } = await collectWatcherEntries(watcher);
    watcher.cleanup();

    emit('resilience', 'circuit-opened', { type: 'circuit-opened', key: 'x' });

    expect(recorded).toHaveLength(0);
  });
});
