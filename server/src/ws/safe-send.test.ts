import { describe, expect, it, vi } from 'vitest';
import { sendJson } from './safe-send.js';

describe('sendJson', () => {
  const OPEN = 1;

  it('does not send to a closed socket', () => {
    const send = vi.fn();
    const socket = { OPEN, readyState: 3, send };

    sendJson(socket as any, { type: 'event' });

    expect(send).not.toHaveBeenCalled();
  });

  it('contains send failures so they cannot interrupt the caller', () => {
    const socket = {
      OPEN,
      readyState: OPEN,
      send: vi.fn(() => { throw new Error('socket closed'); }),
    };

    expect(() => sendJson(socket as any, { type: 'event' })).not.toThrow();
  });
});
