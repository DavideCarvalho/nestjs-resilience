import diagnostics_channel, { type Channel } from 'node:diagnostics_channel';
import {
  CHANNEL_PREFIX,
  type DiagnosticEvent,
  onChannelRegistered,
  registeredChannels,
} from '@dudousxd/nestjs-diagnostics';
import type { RecordInput, Watcher, WatcherContext } from '@dudousxd/nestjs-telescope';

/** Telescope entry `type` produced by this watcher. */
export const RESILIENCE_ENTRY_TYPE = 'resilience';

/** Only this library's channels — `aviary:resilience:*`. */
const RESILIENCE_CHANNEL_PREFIX = `${CHANNEL_PREFIX}:resilience:`;

/** Transitions worth a red `failed` tag in the dashboard. */
const FAILED_EVENTS: ReadonlySet<string> = new Set(['circuit-opened', 'short-circuited']);

export type ResilienceEventType =
  | 'circuit-opened'
  | 'circuit-closed'
  | 'circuit-half-open'
  | 'short-circuited'
  | 'failover';

/** What a recorded resilience entry looks like in the dashboard. */
export interface ResilienceEntryContent {
  event: string; // a ResilienceEventType, kept as string to tolerate unknown future events
  key: string | null; // breaker key (tenant-aware), when present
  target: string | null; // failover target id, when present
  index: number | null; // failover attempt index, when present
  error: string | null; // error message (failover), when present
  traceId: string | null;
  ts: number;
  payload: unknown; // the full ResilienceEvent, verbatim
}

/**
 * Subscribes to every `aviary:resilience:*` diagnostics channel (current and
 * future) and records one `resilience` Telescope entry per publish. Mirrors the
 * generic DiagnosticWatcher, but scoped to the resilience library.
 */
export class ResilienceWatcher implements Watcher {
  readonly type = RESILIENCE_ENTRY_TYPE;
  private registered = false;
  private offChannelRegistered: (() => void) | null = null;
  private readonly subscriptions = new Map<string, (msg: unknown) => void>();

  register(ctx: WatcherContext): void {
    if (this.registered) return;
    this.registered = true;
    for (const name of registeredChannels()) this.maybeSubscribe(ctx, name);
    this.offChannelRegistered = onChannelRegistered((name) => this.maybeSubscribe(ctx, name));
  }

  cleanup(): void {
    this.offChannelRegistered?.();
    this.offChannelRegistered = null;
    for (const [name, listener] of this.subscriptions) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.subscriptions.clear();
    this.registered = false;
  }

  /** Subscribe once to `name` iff it's a resilience channel. */
  private maybeSubscribe(ctx: WatcherContext, name: string): void {
    if (!name.startsWith(RESILIENCE_CHANNEL_PREFIX)) return;
    if (this.subscriptions.has(name)) return;
    const listener = (msg: unknown) => this.safeRecord(ctx, msg);
    this.subscriptions.set(name, listener);
    const channel: Channel = diagnostics_channel.channel(name);
    channel.subscribe(listener);
  }

  /** Validate + record, swallowing any failure so a producer can never break. */
  private safeRecord(ctx: WatcherContext, msg: unknown): void {
    try {
      if (!isResilienceEvent(msg)) return;
      ctx.record(buildResilienceEntry(msg));
    } catch (err) {
      // NOT rethrown — telescope must never break an emitting code path.
      console.error('ResilienceWatcher: failed to record resilience event:', err);
    }
  }
}

/** A resilience diagnostics envelope — `lib` pinned to `'resilience'`. */
export function isResilienceEvent(msg: unknown): msg is DiagnosticEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.ts === 'number' &&
    m.lib === 'resilience' &&
    typeof m.event === 'string' &&
    'payload' in m &&
    (m.traceId === undefined || typeof m.traceId === 'string')
  );
}

/** Map a resilience envelope to a Telescope `RecordInput`. */
export function buildResilienceEntry(msg: DiagnosticEvent): RecordInput<ResilienceEntryContent> {
  const payload = (
    typeof msg.payload === 'object' && msg.payload !== null ? msg.payload : {}
  ) as Record<string, unknown>;
  const key = typeof payload.key === 'string' ? payload.key : null;
  const target =
    payload.target === undefined || payload.target === null ? null : String(payload.target);
  const index =
    typeof payload.index === 'number' && Number.isFinite(payload.index) ? payload.index : null;
  const rawError = payload.error;
  const error =
    rawError === undefined || rawError === null
      ? null
      : rawError instanceof Error
        ? rawError.message
        : String(rawError);
  const traceId = msg.traceId ?? null;

  const content: ResilienceEntryContent = {
    event: msg.event,
    key,
    target,
    index,
    error,
    traceId,
    ts: msg.ts,
    payload: msg.payload,
  };

  const tags = [
    `event:${msg.event}`,
    ...(key !== null ? [`key:${key}`] : []),
    ...(traceId !== null ? [`trace:${traceId}`] : []),
    ...(FAILED_EVENTS.has(msg.event) ? ['failed'] : []),
  ];

  return {
    type: RESILIENCE_ENTRY_TYPE,
    familyHash: key ?? msg.event,
    tags,
    content,
  };
}
