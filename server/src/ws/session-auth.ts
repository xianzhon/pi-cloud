import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AuthConfig } from '../config/auth.js';
import type { SessionRecord, SessionStore } from '../auth/sessions.js';
import { getSessionFromRequest } from '../auth/request.js';

// Recheck before control messages and close idle sockets on expiry/revocation.
export function bindSocketSession(socket: WebSocket, req: FastifyRequest, config: AuthConfig, sessions: SessionStore, initial: SessionRecord): () => boolean {
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    socket.close(4401, 'Authentication required');
  };
  const unsubscribe = sessions.onRevoked((id) => {
    if (id === initial.id) close();
  });
  const scheduleExpiry = (session: SessionRecord) => {
    if (timer) clearTimeout(timer);
    const delay = Math.min(Date.parse(session.expires_at), Date.parse(session.absolute_expires_at)) - Date.now();
    if (Number.isFinite(delay)) {
      timer = setTimeout(check, Math.max(1, Math.min(delay, 2_147_483_647)));
      timer.unref();
    }
  };
  function check(): boolean {
    if (closed) return false;
    const current = getSessionFromRequest(req, config, sessions);
    if (!current || current.id !== initial.id) {
      close();
      return false;
    }
    scheduleExpiry(current);
    return true;
  }
  socket.on('close', () => {
    closed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  });
  scheduleExpiry(initial);
  return check;
}
