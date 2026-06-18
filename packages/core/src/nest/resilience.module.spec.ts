import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { timeout } from '../policies/timeout';
import { wrap } from '../policies/wrap';
import { ResilienceModule } from './resilience.module';
import { ResilienceService } from './resilience.service';

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
});
