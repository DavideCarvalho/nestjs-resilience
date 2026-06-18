import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { InMemoryResilienceStore } from '../breaker/in-memory.store';
import type { ResilienceStore } from '../breaker/store';
import type { Policy } from '../policy';
import { ResilienceService } from './resilience.service';
import { RESILIENCE_OPTIONS, RESILIENCE_STORE } from './tokens';

export interface ResilienceModuleOptions {
  store?: ResilienceStore;
  policies?: Record<string, () => Policy>;
  global?: boolean;
  /** Emit diagnostics events. Default true. */
  emit?: boolean;
}

export interface ResilienceModuleAsyncOptions {
  global?: boolean;
  inject?: unknown[];
  useFactory: (...args: unknown[]) => Promise<ResilienceModuleOptions> | ResilienceModuleOptions;
}

@Module({})
export class ResilienceModule {
  static forRoot(options: ResilienceModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: RESILIENCE_OPTIONS, useValue: options },
      { provide: RESILIENCE_STORE, useValue: options.store ?? new InMemoryResilienceStore() },
      ResilienceService,
    ];
    return {
      module: ResilienceModule,
      global: options.global ?? true,
      providers,
      exports: [ResilienceService, RESILIENCE_STORE],
    };
  }

  static forRootAsync(options: ResilienceModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: RESILIENCE_OPTIONS, useFactory: options.useFactory, inject: options.inject as never },
      {
        provide: RESILIENCE_STORE,
        useFactory: (opts: ResilienceModuleOptions) => opts.store ?? new InMemoryResilienceStore(),
        inject: [RESILIENCE_OPTIONS],
      },
      ResilienceService,
    ];
    return {
      module: ResilienceModule,
      global: options.global ?? true,
      providers,
      exports: [ResilienceService, RESILIENCE_STORE],
    };
  }
}
