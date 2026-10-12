import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase, type PiCloudDatabase } from '../db/database.js';
import { SessionStore } from '../auth/sessions.js';
import { bindSocketSession } from './session-auth.js';

class Socket extends EventEmitter {
  close = vi.fn(() => this.emit('close'));
}

describe('WebSocket session authentication', () => {
  let db: PiCloudDatabase;
  let sessions: SessionStore;
  beforeEach(() => {
    vi.useFakeTimers();
    db = openPiCloudDatabase(':memory:');
    sessions = new SessionStore(db, 'session');
  });
  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });
  function connect(ttlHours = 1, maxLifetimeHours?: number) {
    const { token } = sessions.createSession({ username: 'me', ttlHours, maxLifetimeHours });
    const socket = new Socket();
    const check = bindSocketSession(socket as any, { cookies: { session: token } } as any, { cookieName: 'session' } as any, sessions, sessions.validateToken(token)!);
    return { token, socket, check };
  }

  it('closes all sockets for a revoked cookie immediately, but not other sessions', () => {
    const first = connect();
    const other = connect();
    const secondSocket = new Socket();
    bindSocketSession(secondSocket as any, { cookies: { session: first.token } } as any, { cookieName: 'session' } as any, sessions, sessions.validateToken(first.token)!);
    sessions.revokeToken(first.token);
    expect(first.socket.close).toHaveBeenCalledWith(4401, 'Authentication required');
    expect(secondSocket.close).toHaveBeenCalledOnce();
    expect(first.check()).toBe(false);
    expect(other.check()).toBe(true);
    other.socket.emit('close');
  });

  it('closes idle sockets when the session expires', () => {
    const { socket, check } = connect(1 / 3600);
    vi.advanceTimersByTime(1000);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(check()).toBe(false);
  });

  it('honors HTTP renewal but never exceeds the absolute lifetime', () => {
    const { token, socket, check } = connect(1 / 3600, 2 / 3600);
    vi.advanceTimersByTime(600);
    sessions.validateToken(token, { ttlHours: 1 / 3600 });
    vi.advanceTimersByTime(400);
    expect(check()).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(check()).toBe(false);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('stops timers and revocation callbacks after a normal close', () => {
    const { token, socket } = connect(1 / 3600);
    socket.emit('close');
    sessions.revokeToken(token);
    vi.advanceTimersByTime(1000);
    expect(socket.close).not.toHaveBeenCalled();
  });
});
