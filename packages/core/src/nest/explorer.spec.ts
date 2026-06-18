import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { TimeoutError } from '../errors';
import { CircuitBreaker, Retry, Timeout } from './decorators';
import { ResilienceModule } from './resilience.module';

@Injectable()
class FlakyService {
  calls = 0;
  @Retry({ attempts: 3 })
  async sometimes(): Promise<string> {
    this.calls++;
    if (this.calls < 3) throw new Error('transient');
    return 'ok';
  }

  @CircuitBreaker({ threshold: 2, cooldownMs: 1000, key: 'flaky.always' })
  async always(): Promise<string> {
    throw new Error('down');
  }

  @Timeout(50)
  async slow(): Promise<string> {
    await new Promise((r) => setTimeout(r, 1000));
    return 'too-late';
  }
}

describe('ResilienceExplorer', () => {
  it('@Retry wraps the method so it retries to success', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule.forRoot()],
      providers: [FlakyService],
    }).compile();
    await moduleRef.init();
    const svc = moduleRef.get(FlakyService);
    await expect(svc.sometimes()).resolves.toBe('ok');
    expect(svc.calls).toBe(3);
  });

  it('@CircuitBreaker opens the circuit after threshold failures', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule.forRoot()],
      providers: [FlakyService],
    }).compile();
    await moduleRef.init();
    const svc = moduleRef.get(FlakyService);
    await svc.always().catch(() => {});
    await svc.always().catch(() => {});
    // now open → short-circuits
    await expect(svc.always()).rejects.toThrow(/Circuit/);
  });

  it('@Timeout rejects a method that exceeds the budget', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ResilienceModule.forRoot()],
      providers: [FlakyService],
    }).compile();
    await moduleRef.init();
    const svc = moduleRef.get(FlakyService);
    await expect(svc.slow()).rejects.toBeInstanceOf(TimeoutError);
  });
});
