import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ReviewSessionListItem, ReviewSessionTranscript, ReviewSourceAdapter, ReviewSourceListOptions } from '../../types.js';

interface DevinSessionRow {
  id: string;
  working_directory: string;
  created_at: number;
  last_activity_at: number;
  title: string | null;
}

export class DevinReviewSourceAdapter implements ReviewSourceAdapter {
  private dbPath: string;
  private transcriptsDir: string;

  constructor(dataPath: string) {
    this.dbPath = path.join(dataPath, 'sessions.db');
    this.transcriptsDir = path.join(dataPath, 'transcripts');
  }

  async list(options: ReviewSourceListOptions = {}): Promise<ReviewSessionListItem[]> {
    if (!fs.existsSync(this.dbPath)) return [];
    const db = new Database(this.dbPath);
    try {
      const rows = db.prepare(`
        SELECT id, working_directory, created_at, last_activity_at, title
        FROM sessions
        ORDER BY last_activity_at DESC
      `).all() as DevinSessionRow[];
      const items = rows.map((row) => this.toListItem(row));
      return this.applyListOptions(items, options);
    } finally {
      db.close();
    }
  }

  async search(query: string, options: ReviewSourceListOptions = {}): Promise<ReviewSessionListItem[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.list(options);
    const sessions = await this.list();
    const results: ReviewSessionListItem[] = [];
    for (const session of sessions) {
      let matched = false;
      if (session.name?.toLowerCase().includes(normalized)) matched = true;
      if (session.firstMessage?.toLowerCase().includes(normalized)) matched = true;
      if (!matched) {
        try {
          const transcript = await this.getTranscript(session.id);
          const text = this.transcriptToText(transcript);
          if (text.toLowerCase().includes(normalized)) matched = true;
        } catch {
          // ignore missing transcript
        }
      }
      if (matched) results.push(session);
    }
    return this.applyListOptions(results, options);
  }

  async getTranscript(sessionId: string): Promise<ReviewSessionTranscript> {
    const transcriptPath = this.getTranscriptPath(sessionId);
    if (!fs.existsSync(transcriptPath)) {
      throw new Error(`Transcript not found for session ${sessionId}`);
    }
    const raw = JSON.parse(fs.readFileSync(transcriptPath, 'utf8')) as Record<string, unknown>;
    const messages = this.extractMessages(raw);
    return { messages, metadata: { sessionId, rawSchema: raw.schema_version } };
  }

  async delete(sessionId: string): Promise<void> {
    const transcriptPath = this.getTranscriptPath(sessionId);
    if (fs.existsSync(transcriptPath)) fs.unlinkSync(transcriptPath);
    if (fs.existsSync(this.dbPath)) {
      const db = new Database(this.dbPath);
      try {
        for (const table of ['message_nodes', 'prompt_history', 'tool_call_state', 'rendered_commits']) {
          try {
            db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
          } catch {
            // ignore missing tables
          }
        }
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      } finally {
        db.close();
      }
    }
  }

  async listProjectPaths(): Promise<string[]> {
    if (!fs.existsSync(this.dbPath)) return [];
    const db = new Database(this.dbPath);
    try {
      const rows = db.prepare(`
        SELECT DISTINCT working_directory
        FROM sessions
        ORDER BY last_activity_at DESC
      `).all() as Array<{ working_directory: string }>;
      return Array.from(new Set(rows.map((row) => this.normalizePath(row.working_directory)).filter((p) => p.trim())));
    } finally {
      db.close();
    }
  }

  private toListItem(row: DevinSessionRow): ReviewSessionListItem {
    const transcriptPath = path.join(this.transcriptsDir, `${row.id}.json`);
    let messageCount = 0;
    let firstMessage: string | undefined;
    if (fs.existsSync(transcriptPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(transcriptPath, 'utf8')) as Record<string, unknown>;
        const messages = this.extractMessages(raw);
        messageCount = messages.length;
        firstMessage = this.messageToText(messages[0]);
      } catch {
        // ignore parse errors
      }
    }
    return {
      id: row.id,
      sourceId: '',
      name: row.title || undefined,
      path: transcriptPath,
      cwd: row.working_directory,
      created: new Date(row.created_at * 1000).toISOString(),
      modified: new Date(row.last_activity_at * 1000).toISOString(),
      messageCount,
      firstMessage,
    };
  }

  private extractMessages(raw: Record<string, unknown>): ReviewSessionTranscript['messages'] {
    if (Array.isArray(raw.messages) && raw.messages.length > 0) {
      return raw.messages.map((message: any) => ({
        role: String(message.role || 'unknown'),
        content: message.content,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined,
      }));
    }

    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    return steps.map((step: any) => this.devinStepToMessage(step)).filter((message) => message.content !== '');
  }

  private devinStepToMessage(step: any): ReviewSessionTranscript['messages'][number] {
    const source = String(step.source || 'unknown');
    const role = source === 'user' ? 'user' : 'assistant';
    let timestamp: number | undefined;
    if (typeof step.timestamp === 'string') {
      timestamp = new Date(step.timestamp).getTime();
    } else if (typeof step.timestamp === 'number') {
      timestamp = step.timestamp;
    }

    const parts: string[] = [];
    if (typeof step.message === 'string' && step.message.trim()) {
      parts.push(step.message);
    }
    if (typeof step.reasoning_content === 'string' && step.reasoning_content.trim()) {
      parts.push(`<thinking>\n${step.reasoning_content}\n</thinking>`);
    }
    if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
      for (const toolCall of step.tool_calls) {
        const name = toolCall.name || toolCall.tool_name || 'tool';
        const input = typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input);
        parts.push(`<tool_call name="${name}">\n${input}\n</tool_call>`);
      }
    }
    if (step.observation && typeof step.observation === 'object') {
      const observation = typeof step.observation.results === 'string'
        ? step.observation.results
        : JSON.stringify(step.observation);
      if (observation.trim()) parts.push(`<observation>\n${observation}\n</observation>`);
    }

    return { role, content: parts.join('\n\n'), timestamp };
  }

  private messageToText(message: ReviewSessionTranscript['messages'][number] | undefined): string | undefined {
    if (!message) return undefined;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((item: any) => (typeof item === 'string' ? item : item?.text))
        .filter(Boolean)
        .join('\n');
    }
    return undefined;
  }

  private transcriptToText(transcript: ReviewSessionTranscript): string {
    return transcript.messages.map((message) => this.messageToText(message) || '').join('\n');
  }

  private applyListOptions(items: ReviewSessionListItem[], options: ReviewSourceListOptions): ReviewSessionListItem[] {
    let result = items;
    if (options.projectPath && options.projectPath !== '~') {
      const normalizedProject = this.normalizePath(options.projectPath);
      result = result.filter((item) => {
        if (!item.cwd) return false;
        const normalizedCwd = this.normalizePath(item.cwd);
        return normalizedCwd === normalizedProject || normalizedCwd.startsWith(this.ensureTrailingSlash(normalizedProject));
      });
    }
    if (options.offset !== undefined || options.limit !== undefined) {
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 30;
      result = result.slice(offset, offset + limit);
    }
    return result;
  }

  private getTranscriptPath(sessionId: string): string {
    if (!sessionId || path.basename(sessionId) !== sessionId) {
      throw new Error('Invalid review session ID');
    }
    return path.join(this.transcriptsDir, `${sessionId}.json`);
  }

  private normalizePath(value: string): string {
    if (value.startsWith('~')) {
      return path.join(os.homedir(), value.slice(1));
    }
    return path.resolve(value);
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
  }
}
