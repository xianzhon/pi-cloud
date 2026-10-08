import { parseSessionEntries, type SessionHeader } from '@earendil-works/pi-coding-agent';
import { open, readFile, stat } from 'node:fs/promises';
import type { SessionInfo } from '../types.js';

// Discovery only needs the header, not the potentially very large transcript.
export async function readSessionHeader(path: string): Promise<SessionHeader | undefined> {
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) return undefined;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let length = 0;
    let lineStart = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, Math.min(4096, buffer.length - length), length);
      length += bytesRead;
      let newline = buffer.indexOf(10, lineStart);
      while (newline >= 0 && newline < length) {
        const entry = parseSessionEntries(buffer.toString('utf8', lineStart, newline))[0];
        if (entry) return entry.type === 'session' ? entry : undefined;
        lineStart = newline + 1;
        newline = buffer.indexOf(10, lineStart);
      }
      if (!bytesRead) {
        const entry = parseSessionEntries(buffer.toString('utf8', lineStart, length))[0];
        return entry?.type === 'session' ? entry : undefined;
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await file.close();
  }
}

// Read only the selected file, without opening/migrating a mutable SDK session.
export async function readPersistedSessionInfo(path: string): Promise<SessionInfo | undefined> {
  try {
    const [content, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const entries = parseSessionEntries(content);
    const header = entries[0];
    if (header?.type !== 'session' || typeof header.id !== 'string') return undefined;
    let name: string | undefined;
    let firstMessage: string | undefined;
    let messageCount = 0;
    let lastActivity = 0;
    const allMessages: string[] = [];
    for (const entry of entries.slice(1)) {
      if (entry.type === 'session_info') name = entry.name?.trim() || undefined;
      if (entry.type !== 'message') continue;
      const message = entry.message;
      if (message.role === 'user') messageCount++;
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      if (!('content' in message)) continue;
      const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.parse(entry.timestamp);
      if (Number.isFinite(timestamp)) lastActivity = Math.max(lastActivity, timestamp);
      const content: string | readonly { type: string; text?: string }[] = message.content;
      const text = typeof content === 'string'
        ? content
        : content.filter((block) => block.type === 'text').map((block) => block.text).join(' ');
      if (!text) continue;
      allMessages.push(text);
      if (!firstMessage && message.role === 'user') firstMessage = text;
    }
    const headerTime = Date.parse(header.timestamp);
    return {
      id: header.id,
      path,
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      name: name === '(no messages)' ? undefined : name,
      created: new Date(header.timestamp).toISOString(),
      modified: new Date(lastActivity > 0 ? lastActivity : Number.isFinite(headerTime) ? headerTime : stats.mtimeMs).toISOString(),
      messageCount,
      firstMessage: firstMessage === '(no messages)' ? undefined : firstMessage,
      allMessagesText: allMessages.join(' '),
    };
  } catch {
    return undefined;
  }
}
