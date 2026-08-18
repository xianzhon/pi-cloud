import * as fs from 'fs';
import * as path from 'path';
import type { ReviewSessionListItem, ReviewSessionTranscript, ReviewSourceAdapter, ReviewSourceListOptions } from '../../types.js';

interface CodexRecord {
  timestamp?: string | number;
  type?: string;
  payload?: Record<string, unknown>;
}

interface CodexSession {
  filePath: string;
  item: ReviewSessionListItem;
}

/** Reads Codex rollout JSONL files without modifying them. */
export class CodexReviewSourceAdapter implements ReviewSourceAdapter {
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
    throw new Error('Codex review sessions are read-only');
  }

  async listProjectPaths(): Promise<string[]> {
    const sessions = await this.list();
    return Array.from(new Set(sessions.map((item) => item.cwd).filter((cwd): cwd is string => Boolean(cwd))));
  }

  private readSessions(): CodexSession[] {
    return this.sessionFiles().flatMap((filePath) => {
      try {
        const records = this.readRecords(filePath);
        if (!records.length) return [];
        const stat = fs.statSync(filePath);
        const metadata = records.find((record) => record.type === 'session_meta')?.payload;
        const messages = this.recordsToMessages(records);
        const timestamps = records.map((record) => this.timestamp(record.timestamp)).filter((value): value is number => value !== undefined);
        const firstUserMessage = messages.find((message) => message.role === 'user' && !message.detailOnly);
        return [{
          filePath,
          item: {
            id: this.stringValue(metadata?.session_id) || this.stringValue(metadata?.id) || this.idFromFile(filePath),
            sourceId: '',
            path: filePath,
            cwd: this.stringValue(metadata?.cwd),
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
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
      }
    };
    visit(this.dataPath);
    return files;
  }

  private findSession(sessionId: string): CodexSession | undefined {
    if (!sessionId || path.basename(sessionId) !== sessionId) throw new Error('Invalid review session ID');
    return this.readSessions().find((session) => session.item.id === sessionId);
  }

  private readTranscript(filePath: string): ReviewSessionTranscript {
    const records = this.readRecords(filePath);
    const metadata = records.find((record) => record.type === 'session_meta')?.payload;
    return {
      messages: this.recordsToMessages(records),
      metadata: {
        sessionId: this.stringValue(metadata?.session_id) || this.stringValue(metadata?.id) || this.idFromFile(filePath),
        format: 'codex-jsonl',
      },
    };
  }

  private readRecords(filePath: string): CodexRecord[] {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as CodexRecord];
      } catch {
        return [];
      }
    });
  }

  private recordsToMessages(records: CodexRecord[]): ReviewSessionTranscript['messages'] {
    const toolNames = new Map<string, string>();

    return records.flatMap((record) => {
      if (record.type !== 'response_item' || !record.payload) return [];
      const payload = record.payload;
      const timestamp = this.timestamp(record.timestamp);
      if (payload.type === 'message') {
        const role = this.stringValue(payload.role);
        if (!role) return [];
        const content = this.contentToText(payload.content);
        if (!content.trim()) return [];
        return [{ role, content, timestamp, detailOnly: role === 'developer' || role === 'system' || this.isContextMessage(content) }];
      }
      if (payload.type === 'reasoning') {
        const content = this.contentToText(payload.summary) || this.contentToText(payload.content);
        return content.trim() ? [{ role: 'assistant', content: `<thinking>\n${content}\n</thinking>`, timestamp }] : [];
      }
      if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
        const name = this.stringValue(payload.name) || 'tool';
        const callId = this.stringValue(payload.call_id) || this.stringValue(payload.id);
        const input = this.stringValue(payload.arguments) ?? this.stringValue(payload.input);
        if (callId) toolNames.set(callId, name);
        const idAttribute = callId ? ` id="${this.escapeAttribute(callId)}"` : '';
        return [{ role: 'assistant', content: `<tool_call name="${this.escapeAttribute(name)}"${idAttribute}>\n${this.formatJson(input)}\n</tool_call>`, timestamp }];
      }
      if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        const callId = this.stringValue(payload.call_id);
        const output = this.messageText(payload.output);
        const toolName = callId ? toolNames.get(callId) : undefined;
        const idAttribute = callId ? ` tool_call_id="${this.escapeAttribute(callId)}"` : '';
        const statusAttribute = toolName === 'exec_command' && /Process exited with code (?!0\b)\d+/.test(output) ? ' status="failure"' : '';
        const displayOutput = toolName === 'exec_command' ? this.commandOutput(output) : output;
        return [{ role: 'assistant', content: `<observation${idAttribute}${statusAttribute}>\n${displayOutput}\n</observation>`, timestamp }];
      }
      return [];
    });
  }

  private contentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((block) => {
      if (!block || typeof block !== 'object') return '';
      const value = block as Record<string, unknown>;
      return this.stringValue(value.text);
    }).filter(Boolean).join('\n\n');
  }

  private isContextMessage(content: string): boolean {
    const text = content.trimStart();
    return text.startsWith('# AGENTS.md instructions for ') || text.startsWith('<environment_context>');
  }

  private escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private commandOutput(output: string): string {
    const match = output.match(/(?:^|\n)(?:Output|Final output):\n([\s\S]*)$/);
    return match ? match[1].replace(/\n$/, '') : output;
  }

  private formatJson(value: string | undefined): string {
    if (!value) return '';
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
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

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private timestamp(value: string | number | undefined): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
  }

  private idFromFile(filePath: string): string {
    const fileName = path.basename(filePath, '.jsonl');
    return fileName.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)?.[0] || fileName;
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
