const CONTEXT_ACCESSOR = Symbol.for('@dudousxd/nestjs-context:accessor');

interface ContextAccessor {
  get(): { tenantId?: string } | undefined;
}

/** Read the current tenant from nestjs-context if its accessor is registered, else undefined. */
export function tenantSuffix(): string | undefined {
  const accessor = (globalThis as Record<symbol, unknown>)[CONTEXT_ACCESSOR] as
    | ContextAccessor
    | undefined;
  return accessor?.get?.()?.tenantId;
}
