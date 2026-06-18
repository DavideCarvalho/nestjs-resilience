import type { EventSink } from '../events';

type EmitFn = (lib: string, event: string, payload: unknown) => void;

let cached: EmitFn | null | undefined;

/** Resolve nestjs-diagnostics' `emit` lazily; cache null when absent so we never re-require. */
function resolveEmit(): EmitFn | null {
  if (cached !== undefined) return cached;
  try {
    // Indirected require so bundlers don't hard-fail when the optional peer is missing.
    const mod = (eval('require') as NodeRequire)('@dudousxd/nestjs-diagnostics') as { emit: EmitFn };
    cached = typeof mod.emit === 'function' ? mod.emit : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function diagnosticsSink(): EventSink {
  return (event) => {
    const emit = resolveEmit();
    if (!emit) return;
    emit('resilience', event.type, event);
  };
}

/** Test-only reset of the cached emit resolution. */
export function __resetDiagnosticsCache(): void {
  cached = undefined;
}
