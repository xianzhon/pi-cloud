// server/src/services/terminal-manager.ts
import * as pty from '@lydell/node-pty';

interface TerminalSession {
  id: string;
  pty: pty.IPty;
  clientId: string;
  shell: string;
}

export class TerminalManager {
  private terminals: Map<string, TerminalSession> = new Map();

  create(clientId: string, cwd?: string): TerminalSession {
    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // Bash is not guaranteed to exist on Windows; COMSPEC points to the system command shell.
    const platformShell = process.platform === 'win32'
      ? process.env.COMSPEC || 'cmd.exe'
      : process.env.SHELL || 'bash';
    const shell = process.env.PI_WEBUI_TERMINAL_SHELL || platformShell;
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: process.env as { [key: string]: string },
    });

    const session: TerminalSession = { id, pty: ptyProcess, clientId, shell: shell.split(/[\\/]/).pop() || shell };
    this.terminals.set(id, session);

    return session;
  }

  get(id: string): TerminalSession | undefined {
    return this.terminals.get(id);
  }

  getByClient(clientId: string): TerminalSession[] {
    return Array.from(this.terminals.values())
      .filter(t => t.clientId === clientId);
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
      session.pty.kill();
      this.terminals.delete(id);
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
