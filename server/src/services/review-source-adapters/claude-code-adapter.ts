import * as fs from 'fs';
import * as path from 'path';
import type { ReviewSessionListItem, ReviewSessionTranscript, ReviewSourceAdapter, ReviewSourceListOptions } from '../../types.js';

interface ClaudeRecord {
  type?: string;
  sessionId?: string;
  session_id?: string;
  cwd?: string;
  timestamp?: string | number;
  aiTitle?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface ClaudeSession {
  filePath: string;
  item: ReviewSessionListItem;
}

/** Reads Claude Code's local JSONL history without modifying its files. */
export class ClaudeCodeReviewSourceAdapter implements ReviewSourceAdapter {
  constructor(private dataPath: string) {}

  async list(options: ReviewSourceListOptions = {}): Promise<ReviewSessionListItem[]> {
    const items = this.readSessions()
      .map((session) => session.item)
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return this.applyListOptions(items, options);
  }

  async search(query: string, options: ReviewSourceListOptions = {}): Promise<ReviewSessionListItem[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.list(options);

    const matches = this.readSessions().filter(({ item, filePath }) => {
      if (item.name?.toLowerCase().includes(normalized) || item.firstMessage?.toLowerCase().includes(normalized)) return true;
      return this.readTranscript(filePath).messages.some((message) => this.messageText(message.content).toLowerCase().includes(normalized));
    }).map((session) => session.item).sort((a, b) => b.modified.localeCompare(a.modified));
    return this.applyListOptions(matches, options);
  }

  async getTranscript(sessionId: string): Promise<ReviewSessionTranscript> {
    const session = this.findSession(sessionId);
    if (!session) throw new Error(`Transcript not found for session ${sessionId}`);
    return this.readTranscript(session.filePath);
  }

  async delete(_sessionId: string): Promise<void> {
    throw new Error('Claude Code review sessions are read-only');
  }

  async listProjectPaths(): Promise<string[]> {
    const sessions = await this.list();
    return Array.from(new Set(sessions.map((item) => item.cwd).filter((cwd): cwd is string => Boolean(cwd))));
  }

  private readSessions(): ClaudeSession[] {
    return this.sessionFiles().flatMap((filePath) => {
      try {
        const records = this.readRecords(filePath);
        if (!records.length) return [];
        const stat = fs.statSync(filePath);
        const sessionRecord = records.find((record) => record.sessionId || record.session_id);
        const sessionId = sessionRecord?.sessionId || sessionRecord?.session_id || path.basename(filePath, '.jsonl');
        const cwd = records.find((record) => record.cwd)?.cwd;
        const timestamps = records.map((record) => this.timestamp(record.timestamp)).filter((value): value is number => value !== undefined);
        const messages = this.recordsToMessages(records);
        const title = [...records].reverse().find((record) => typeof record.aiTitle === 'string')?.aiTitle;
        const firstUserMessage = messages.find((message) => message.role === 'user');
        return [{
          filePath,
          item: {
            id: sessionId,
            sourceId: '',
            name: title,
            path: filePath,
            cwd,
            created: new Date(timestamps.length ? Math.min(...timestamps) : stat.birthtimeMs).toISOString(),
            modified: new Date(timestamps.length ? Math.max(...timestamps) : stat.mtimeMs).toISOString(),
            messageCount: messages.length,
            firstMessage: firstUserMessage ? this.messageText(firstUserMessage.content) : undefined,
          },
        }];
      } catch {
        return [];
      }
    });
  }

  private sessionFiles(): string[] {
    if (!fs.existsSync(this.dataPath)) return [];
    const files: string[] = [];
    const addJsonlFiles = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(directory, entry.name));
      }
    };
    addJsonlFiles(this.dataPath);
    for (const entry of fs.readdirSync(this.dataPath, { withFileTypes: true })) {
      if (entry.isDirectory()) addJsonlFiles(path.join(this.dataPath, entry.name));
    }
    return files;
  }

  private findSession(sessionId: string): ClaudeSession | undefined {
    if (!sessionId || path.basename(sessionId) !== sessionId) throw new Error('Invalid review session ID');
    return this.readSessions().find((session) => session.item.id === sessionId);
  }

  private readTranscript(filePath: string): ReviewSessionTranscript {
    const records = this.readRecords(filePath);
    return {
      messages: this.recordsToMessages(records),
      metadata: { sessionId: path.basename(filePath, '.jsonl'), format: 'claude-code-jsonl' },
    };
  }

  private readRecords(filePath: string): ClaudeRecord[] {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as ClaudeRecord];
      } catch {
        return [];
      }
    });
  }

  private recordsToMessages(records: ClaudeRecord[]): ReviewSessionTranscript['messages'] {
    return records.flatMap((record) => {
      if ((record.type !== 'user' && record.type !== 'assistant') || record.isMeta || record.isSidechain || !record.message) return [];
      const content = this.contentToText(record.message.content);
      if (!content.trim()) return [];
      const role = record.type === 'user' && this.containsOnlyToolResults(record.message.content)
        ? 'assistant'
        : record.type;
      return [{
        role,
        content,
        timestamp: this.timestamp(record.timestamp),
      }];
    });
  }

  private containsOnlyToolResults(content: unknown): boolean {
    return Array.isArray(content)
      && content.length > 0
      && content.every((block) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_result');
  }

  private contentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return this.messageText(content);
    return content.map((block) => {
      if (!block || typeof block !== 'object') return this.messageText(block);
      const value = block as Record<string, unknown>;
      if (value.type === 'text' && typeof value.text === 'string') return value.text;
      if (value.type === 'thinking' && typeof value.thinking === 'string') return `<thinking>\n${value.thinking}\n</thinking>`;
      if (value.type === 'tool_use') {
        const name = typeof value.name === 'string' ? value.name : 'tool';
        return `<tool_call name="${name.replace(/"/g, '&quot;')}">\n${this.messageText(value.input)}\n</tool_call>`;
      }
      if (value.type === 'tool_result') return `<observation>\n${this.contentToText(value.content)}\n</observation>`;
      return '';
    }).filter(Boolean).join('\n\n');
  }

  private messageText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private timestamp(value: string | number | undefined): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
  }

  private applyListOptions(items: ReviewSessionListItem[], options: ReviewSourceListOptions): ReviewSessionListItem[] {
    let result = items;
    if (options.projectPath && options.projectPath !== '~') {
      const projectPath = path.resolve(options.projectPath);
      result = result.filter((item) => item.cwd && (path.resolve(item.cwd) === projectPath || path.resolve(item.cwd).startsWith(`${projectPath}${path.sep}`)));
    }
    const offset = options.offset ?? 0;
    return options.offset !== undefined || options.limit !== undefined
      ? result.slice(offset, offset + (options.limit ?? 30))
      : result;
  }
}
