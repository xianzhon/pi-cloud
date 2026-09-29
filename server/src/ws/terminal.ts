// server/src/ws/terminal.ts
import type { FastifyInstance } from 'fastify';
import { isAllowedRequestOrigin } from '../auth/origin.js';
import { getRequestContext, getSessionFromRequest } from '../auth/request.js';
import { resolveAllowedPath } from '../utils/path-security.js';

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_SOCKET_BUFFER_BYTES = 1_000_000;

export async function terminalWebSocket(app: FastifyInstance) {
  const terminalManager = app.services.terminals;
  app.get('/ws/terminal', { websocket: true }, async (socket, req) => {
    const {
      clientId,
      cwd,
      terminalId: requestedTerminalId,
      resumeToken,
      lastSeq: rawLastSeq,
    } = req.query as {
      clientId?: string;
      cwd?: string;
      terminalId?: string;
      resumeToken?: string;
      lastSeq?: string;
    };
    const parsedLastSeq = Number(rawLastSeq);
    const lastSeq = Number.isSafeInteger(parsedLastSeq) && parsedLastSeq >= 0 ? parsedLastSeq : 0;

    const safeSend = (message: object): boolean => {
      if (socket.readyState !== 1) return false;
      if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
        req.log.warn({ bufferedAmount: socket.bufferedAmount }, 'Closing slow terminal WebSocket client');
        socket.terminate();
        return false;
      }
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        req.log.warn({ err: error }, 'Terminal WebSocket send failed');
        socket.terminate();
        return false;
      }
    };

    if (!clientId) {
      safeSend({ type: 'error', message: 'clientId required' });
      socket.close();
      return;
    }

    const auth = app.authServices;
    const context = getRequestContext(req, auth.authConfig.trustProxy);
    if (!isAllowedRequestOrigin(req)) {
      auth.audit.record({ type: 'websocket_origin_rejected', status: 'failure', ...context, metadata: { path: '/ws/terminal', origin: req.headers.origin } });
      safeSend({ type: 'error', message: 'Origin not allowed' });
      socket.close();
      return;
    }

    const session = getSessionFromRequest(req, auth.authConfig, auth.sessions);
    if (!session) {
      auth.audit.record({ type: 'websocket_auth_failure', status: 'failure', ...context, metadata: { path: '/ws/terminal' } });
      safeSend({ type: 'error', message: 'Authentication required' });
      socket.close();
      return;
    }

    const attachmentId = Symbol('terminal-websocket');
    let terminal: ReturnType<typeof terminalManager.create>;
    let resolvedCwd: string | undefined;

    if (requestedTerminalId) {
      const existingTerminal = resumeToken
        ? terminalManager.attach(requestedTerminalId, resumeToken, clientId, session.username, attachmentId)
        : undefined;
      if (!existingTerminal) {
        safeSend({ type: 'error', message: 'Terminal is no longer available' });
        socket.close(4404, 'Terminal not found');
        return;
      }
      terminal = existingTerminal;
    } else {
      try {
        resolvedCwd = await resolveAllowedPath(cwd || process.cwd());
      } catch (error) {
        auth.audit.record({ type: 'terminal_cwd_rejected', status: 'failure', username: session.username, ...context, metadata: { cwd } });
        safeSend({ type: 'error', message: error instanceof Error ? error.message : 'Terminal cwd not allowed' });
        socket.close();
        return;
      }
      terminal = terminalManager.create(clientId, resolvedCwd, session.username, attachmentId);
    }

    const terminalId = terminal.id;
    auth.audit.record({
      type: requestedTerminalId ? 'terminal_reattached' : 'terminal_opened',
      status: 'success',
      username: session.username,
      ...context,
      metadata: { terminalId, ...(resolvedCwd ? { cwd: resolvedCwd } : {}) },
    });

    safeSend({
      type: requestedTerminalId ? 'reattached' : 'created',
      terminalId,
      resumeToken: terminal.resumeToken,
      shell: terminal.shell,
    });

    const replay = terminalManager.setOutputHandler(terminalId, attachmentId, lastSeq, (chunk) => {
      safeSend({ type: 'output', terminalId, ...chunk });
    });
    if (replay?.truncated) safeSend({ type: 'output_truncated', terminalId });
    for (const chunk of replay?.chunks ?? []) safeSend({ type: 'output', terminalId, ...chunk });

    const exitDisposable = terminal.pty.onExit(({ exitCode }) => {
      if (terminal.attachmentId === attachmentId) safeSend({ type: 'exit', terminalId, exitCode });
    });

    let receivedPong = true;
    socket.on('pong', () => {
      receivedPong = true;
    });
    const heartbeat = setInterval(() => {
      if (socket.readyState !== 1) return;
      if (!receivedPong) {
        req.log.warn({ terminalId }, 'Terminating unresponsive terminal WebSocket');
        socket.terminate();
        return;
      }
      receivedPong = false;
      try {
        socket.ping();
      } catch (error) {
        req.log.warn({ err: error }, 'Terminal WebSocket ping failed');
        socket.terminate();
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    socket.on('message', (rawData: Buffer) => {
      try {
        const message = JSON.parse(rawData.toString());
        // A replaced socket must not be able to control or dispose the new attachment.
        if (terminal.attachmentId !== attachmentId) return;

        switch (message.type) {
          case 'input':
            if (message.terminalId === terminalId && typeof message.data === 'string') {
              terminalManager.writeTo(terminalId, message.data);
            }
            break;
          case 'resize':
            if (message.terminalId === terminalId && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
              terminalManager.resize(terminalId, message.cols, message.rows);
            }
            break;
          case 'ack':
            if (message.terminalId === terminalId && Number.isSafeInteger(message.seq)) {
              terminalManager.acknowledge(terminalId, attachmentId, message.seq);
            }
            break;
          case 'dispose':
            if (message.terminalId === terminalId) terminalManager.dispose(terminalId);
            break;
        }
      } catch (error) {
        req.log.warn({ err: error }, 'Invalid terminal WebSocket message');
      }
    });

    socket.on('error', (error) => {
      req.log.warn({ err: error, terminalId }, 'Terminal WebSocket error');
    });

    socket.on('close', (code, reason) => {
      clearInterval(heartbeat);
      exitDisposable.dispose();
      terminalManager.detach(terminalId, attachmentId);
      req.log.info({ terminalId, code, reason: reason.toString() }, 'Terminal WebSocket closed');
    });
  });
}
