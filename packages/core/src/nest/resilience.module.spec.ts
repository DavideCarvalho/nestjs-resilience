import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import type { ResilienceStore } from '../breaker/store';
import { timeout } from '../policies/timeout';
import { wrap } from '../policies/wrap';
import { ResilienceModule } from './resilience.module';
import { ResilienceService } from './resilience.service';
import { RESILIENCE_STORE } from './tokens';

describe('ResilienceModule', () => {
  it('provides ResilienceService and runs a named policy', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ResilienceModule.forRoot({
          policies: { fast: () => wrap(timeout(1000)) },
        }),
      ],
    }).compile();
    const svc = moduleRef.get(ResilienceService);
    await expect(svc.execute('fast', async () => 'ok')).resolves.toBe('ok');
  });

  it('runs an inline policy and a raw op', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ResilienceModule.forRoot()] }).compile();
    const svc = moduleRef.get(ResilienceService);
    await expect(svc.execute(wrap(timeout(1000)), async () => 42)).resolves.toBe(42);
  });

  it('exposes circuit snapshot/reset', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ResilienceModule.forRoot()] }).compile();
    const svc = moduleRef.get(ResilienceService);
    const snap = await svc.circuit('k').snapshot();
    expect(snap.status).toBe('closed');
    await expect(svc.circuit('k').reset()).resolves.toBeUndefined();
  });

  it('reset() closes an open circuit and clears failures', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ResilienceModule.forRoot()] }).compile();
    const svc = moduleRef.get(ResilienceService);
    const store = moduleRef.get<ResilienceStore>(RESILIENCE_STORE);
    await store.record('x', { threshold: 1, cooldownMs: 60_000 }, false, false);
    expect((await svc.circuit('x').snapshot()).status).toBe('open');
    await svc.circuit('x').reset();
    const snap = await svc.circuit('x').snapshot();
    expect(snap.status).toBe('closed');
    expect(snap.failures).toBe(0);
  });

  it('forRootAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ResilienceModule.forRootAsync({
          useFactory: async () => ({ policies: { slow: () => wrap(timeout(500)) } }),
        }),
      ],
    }).compile();
    const svc = moduleRef.get(ResilienceService);
    await expect(svc.execute('slow', async () => 'async-ok')).resolves.toBe('async-ok');
  });

  it('mirrors events to a provided EventEmitter2-style emitter', async () => {
    const events: Array<{ name: string; payload: unknown }> = [];
    const emitter = { emit: (name: string, payload: unknown) => { events.push({ name, payload }); return true; } };
    const moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule.forRoot({ emit: false, eventEmitter: emitter })],
    }).compile();
    const svc = moduleRef.get(ResilienceService);
    svc.sink({ type: 'circuit-opened', key: 'k', failures: 3 });
    expect(events).toEqual([{ name: 'resilience.circuit.opened', payload: { type: 'circuit-opened', key: 'k', failures: 3 } }]);
  });
});
