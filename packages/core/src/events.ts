export type ResilienceEventType =
  | 'circuit-opened'
  | 'circuit-closed'
  | 'circuit-half-open'
  | 'short-circuited'
  | 'failover'
  | 'timeout'
  | 'retry';

export interface ResilienceEvent {
  type: ResilienceEventType;
  key?: string;
  [extra: string]: unknown;
}

export type EventSink = (event: ResilienceEvent) => void;

export const noopSink: EventSink = () => {};
