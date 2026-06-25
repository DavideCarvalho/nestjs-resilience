import diagnostics_channel from 'node:diagnostics_channel';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnosticsSink } from './diagnostics';

describe('diagnosticsSink', () => {
  const channel = 'aviary:resilience:circuit-opened';
  const seen: unknown[] = [];
  const handler = (msg: unknown) => seen.push(msg);

  afterEach(() => {
    diagnostics_channel.unsubscribe(channel, handler);
    seen.length = 0;
  });

  it('publishes a resilience event over the diagnostics channel when subscribed', () => {
    diagnostics_channel.subscribe(channel, handler);
    diagnosticsSink()({ type: 'circuit-opened', key: 'sms:twilio', failures: 3 });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { event: string }).event).toBe('circuit-opened');
  });

  it('is a no-op when nobody is subscribed (never throws)', () => {
    expect(() => diagnosticsSink()({ type: 'short-circuited', key: 'k', ms: 100 })).not.toThrow();
  });
});
