// server/src/services/terminal-manager.ts
import { randomUUID } from 'node:crypto';
import * as pty from '@lydell/node-pty';

const DEFAULT_DISCONNECT_GRACE_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BUFFER_CHARS = 1_000_000;

export interface TerminalOutputChunk {
  seq: number;
  data: string;
}

export interface TerminalReplay {
  chunks: TerminalOutputChunk[];
  truncated: boolean;
}

interface TerminalSession {
  id: string;
  resumeToken: string;
  pty: pty.IPty;
  clientId: string;
  owner: string;
  shell: string;
  attachmentId: symbol | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  outputHandler: ((chunk: TerminalOutputChunk) => void) | null;
  outputBuffer: TerminalOutputChunk[];
  outputBufferChars: number;
  nextOutputSeq: number;
  acknowledgedSeq: number;
  oldestChunkTruncated: boolean;
  dataDisposable: pty.IDisposable | null;
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
      resumeToken: randomUUID(),
      pty: ptyProcess,
      clientId,
      owner,
      shell: shell.split(/[\\/]/).pop() || shell,
      attachmentId,
      disconnectTimer: null,
      outputHandler: null,
      outputBuffer: [],
      outputBufferChars: 0,
      nextOutputSeq: 1,
      acknowledgedSeq: 0,
      oldestChunkTruncated: false,
      dataDisposable: null,
    };
    session.dataDisposable = ptyProcess.onData((data) => {
      const chunk = { seq: session.nextOutputSeq++, data };
      // Keep a separate object in the ring because an oversized buffered chunk may be sliced.
      session.outputBuffer.push({ ...chunk });
      session.outputBufferChars += data.length;

      while (session.outputBuffer.length > 1 && session.outputBufferChars > MAX_OUTPUT_BUFFER_CHARS) {
        const removed = session.outputBuffer.shift()!;
        session.outputBufferChars -= removed.data.length;
        session.oldestChunkTruncated = false;
      }
      if (session.outputBufferChars > MAX_OUTPUT_BUFFER_CHARS) {
        const excess = session.outputBufferChars - MAX_OUTPUT_BUFFER_CHARS;
        session.outputBuffer[0].data = session.outputBuffer[0].data.slice(excess);
        session.outputBufferChars = MAX_OUTPUT_BUFFER_CHARS;
        session.oldestChunkTruncated = true;
      }

      session.outputHandler?.(chunk);
    });
    this.terminals.set(id, session);
    ptyProcess.onExit(() => {
      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
      session.dataDisposable?.dispose();
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

  attach(id: string, resumeToken: string, clientId: string, owner: string, attachmentId: symbol): TerminalSession | undefined {
    const session = this.terminals.get(id);
    if (!session || session.resumeToken !== resumeToken || session.clientId !== clientId || session.owner !== owner) return undefined;

    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    session.attachmentId = attachmentId;
    session.outputHandler = null;
    return session;
  }

  setOutputHandler(
    id: string,
    attachmentId: symbol,
    afterSeq: number,
    handler: (chunk: TerminalOutputChunk) => void,
  ): TerminalReplay | undefined {
    const session = this.terminals.get(id);
    if (!session || session.attachmentId !== attachmentId) return undefined;

    session.outputHandler = handler;
    const firstChunk = session.outputBuffer[0];
    return {
      chunks: session.outputBuffer.filter(chunk => chunk.seq > afterSeq),
      truncated: Boolean(firstChunk && (afterSeq < firstChunk.seq - 1 || (afterSeq < firstChunk.seq && session.oldestChunkTruncated))),
    };
  }

  acknowledge(id: string, attachmentId: symbol, seq: number): void {
    const session = this.terminals.get(id);
    if (!session || session.attachmentId !== attachmentId || !Number.isSafeInteger(seq)) return;
    session.acknowledgedSeq = Math.max(session.acknowledgedSeq, Math.min(seq, session.nextOutputSeq - 1));
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
    if (session) session.pty.resize(cols, rows);
  }

  writeTo(id: string, data: string): void {
    const session = this.terminals.get(id);
    if (session) session.pty.write(data);
  }

  dispose(id: string): void {
    const session = this.terminals.get(id);
    if (!session) return;

    if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
    session.dataDisposable?.dispose();
    this.terminals.delete(id);
    session.pty.kill();
  }

  disposeByClient(clientId: string): void {
    this.getByClient(clientId).forEach(session => this.dispose(session.id));
  }

  disposeAll(): void {
    for (const [id] of this.terminals) this.dispose(id);
  }
}
