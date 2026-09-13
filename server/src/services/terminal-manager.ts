// server/src/services/terminal-manager.ts
import { randomUUID } from 'node:crypto';
import * as pty from '@lydell/node-pty';

const DEFAULT_DISCONNECT_GRACE_MS = 10 * 60 * 1000;
const MAX_DETACHED_OUTPUT_CHARS = 1_000_000;

interface TerminalSession {
  id: string;
  pty: pty.IPty;
  clientId: string;
  owner: string;
  shell: string;
  attachmentId: symbol | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  outputHandler: ((data: string) => void) | null;
  outputBuffer: string;
  dataDisposable: pty.IDisposable;
}

export class TerminalManager {
  private terminals: Map<string, TerminalSession> = new Map();

  constructor(private readonly disconnectGraceMs = DEFAULT_DISCONNECT_GRACE_MS) {}

  create(clientId: string, cwd?: string, owner = '', attachmentId: symbol | null = null): TerminalSession {
    const id = `term-${randomUUID()}`;

    // Bash is not guaranteed to exist on Windows; COMSPEC points to the system command shell.
    const platformShell = process.platform === 'win32'
      ? process.env.COMSPEC || 'cmd.exe'
      : process.env.SHELL || 'bash';
    const shell = process.env.PI_CLOUD_TERMINAL_SHELL || platformShell;
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: process.env as { [key: string]: string },
    });

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      clientId,
      owner,
      shell: shell.split(/[\\/]/).pop() || shell,
      attachmentId,
      disconnectTimer: null,
      outputHandler: null,
      outputBuffer: '',
      dataDisposable: { dispose() {} },
    };
    session.dataDisposable = ptyProcess.onData((data) => {
      if (session.outputHandler) {
        session.outputHandler(data);
      } else {
        // Keep enough detached output to restore the screen without unbounded memory growth.
        session.outputBuffer = (session.outputBuffer + data).slice(-MAX_DETACHED_OUTPUT_CHARS);
      }
    });
    this.terminals.set(id, session);
    ptyProcess.onExit(() => {
      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
      session.dataDisposable.dispose();
      this.terminals.delete(id);
    });

    return session;
  }

  get(id: string): TerminalSession | undefined {
    return this.terminals.get(id);
  }

  getByClient(clientId: string): TerminalSession[] {
    return Array.from(this.terminals.values())
      .filter(t => t.clientId === clientId);
  }

  attach(id: string, clientId: string, owner: string, attachmentId: symbol): TerminalSession | undefined {
    const session = this.terminals.get(id);
    if (!session || session.clientId !== clientId || session.owner !== owner) return undefined;

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    session.attachmentId = attachmentId;
    session.outputHandler = null;
    return session;
  }

  setOutputHandler(id: string, attachmentId: symbol, handler: (data: string) => void): string | undefined {
    const session = this.terminals.get(id);
    if (!session || session.attachmentId !== attachmentId) return undefined;

    session.outputHandler = handler;
    const bufferedOutput = session.outputBuffer;
    session.outputBuffer = '';
    return bufferedOutput;
  }

  detach(id: string, attachmentId: symbol): void {
    const session = this.terminals.get(id);
    // Ignore a delayed close from a socket that has already been replaced.
    if (!session || session.attachmentId !== attachmentId) return;

    session.attachmentId = null;
    session.outputHandler = null;
    session.disconnectTimer = setTimeout(() => this.dispose(id), this.disconnectGraceMs);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.terminals.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  writeTo(id: string, data: string): void {
    const session = this.terminals.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  dispose(id: string): void {
    const session = this.terminals.get(id);
    if (session) {
      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
      session.dataDisposable.dispose();
      this.terminals.delete(id);
      session.pty.kill();
    }
  }

  disposeByClient(clientId: string): void {
    const sessions = this.getByClient(clientId);
    sessions.forEach(s => this.dispose(s.id));
  }

  disposeAll(): void {
    for (const [id] of this.terminals) {
      this.dispose(id);
    }
  }
}
