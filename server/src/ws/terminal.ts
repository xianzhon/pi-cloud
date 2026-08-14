// server/src/ws/terminal.ts
import type { FastifyInstance } from 'fastify';
import { isAllowedRequestOrigin } from '../auth/origin.js';
import { getRequestContext, getSessionFromRequest } from '../auth/request.js';
import { terminalManager } from '../services/terminal-manager.js';
import { resolveAllowedPath } from '../utils/path-security.js';

export async function terminalWebSocket(app: FastifyInstance) {
  app.get('/ws/terminal', { websocket: true }, async (socket, req) => {
    const { clientId, cwd } = req.query as { 
      clientId?: string; 
      cwd?: string 
    };

    if (!clientId) {
      socket.send(JSON.stringify({ 
        type: 'error', 
        message: 'clientId required' 
      }));
      socket.close();
      return;
    }

    const auth = app.authServices;
    const context = getRequestContext(req, auth.authConfig.trustProxy);
    if (!isAllowedRequestOrigin(req)) {
      auth.audit.record({ type: 'websocket_origin_rejected', status: 'failure', ...context, metadata: { path: '/ws/terminal', origin: req.headers.origin } });
      socket.send(JSON.stringify({ type: 'error', message: 'Origin not allowed' }));
      socket.close();
      return;
    }

    const session = getSessionFromRequest(req, auth.authConfig, auth.sessions);
    if (!session) {
      auth.audit.record({ type: 'websocket_auth_failure', status: 'failure', ...context, metadata: { path: '/ws/terminal' } });
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      socket.close();
      return;
    }

    let resolvedCwd: string;
    try {
      resolvedCwd = await resolveAllowedPath(cwd || process.cwd());
    } catch (error) {
      auth.audit.record({ type: 'terminal_cwd_rejected', status: 'failure', username: session.username, ...context, metadata: { cwd } });
      socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Terminal cwd not allowed' }));
      socket.close();
      return;
    }

    auth.audit.record({ type: 'terminal_opened', status: 'success', username: session.username, ...context, metadata: { cwd: resolvedCwd } });

    let terminalId: string | null = null;

    const terminal = terminalManager.create(clientId, resolvedCwd);
    terminalId = terminal.id;

    terminal.pty.onData((data) => {
      socket.send(JSON.stringify({ 
        type: 'output', 
        terminalId: terminal.id,
        data 
      }));
    });

    terminal.pty.onExit(({ exitCode }) => {
      socket.send(JSON.stringify({ 
        type: 'exit', 
        terminalId: terminal.id,
        exitCode 
      }));
    });

    socket.send(JSON.stringify({ 
      type: 'created', 
      terminalId: terminal.id,
      shell: terminal.shell
    }));

    socket.on('message', (rawData: Buffer) => {
      try {
        const message = JSON.parse(rawData.toString());
        
        switch (message.type) {
          case 'input':
            if (message.terminalId === terminal.id && typeof message.data === 'string') {
              terminalManager.writeTo(terminal.id, message.data);
            }
            break;
          case 'resize':
            if (message.terminalId === terminal.id && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
              terminalManager.resize(terminal.id, message.cols, message.rows);
            }
            break;
        }
      } catch (error) {
        console.error('Terminal message error:', error);
      }
    });

    socket.on('close', () => {
      // Only dispose the terminal associated with this WebSocket connection
      if (terminalId) {
        terminalManager.dispose(terminalId);
      }
    });
  });
}
