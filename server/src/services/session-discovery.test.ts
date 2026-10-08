import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPersistedSessionInfo, readSessionHeader } from './session-discovery.js';

const reads = vi.hoisted(() => ({ bytes: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const read = handle.read.bind(handle);
    handle.read = (async (...args: any[]) => {
      const result = await (read as any)(...args);
      reads.bytes += result.bytesRead;
      return result;
    }) as typeof handle.read;
    return handle;
  } };
});

let directory: string;
const header = { type: 'session', version: 3, id: 'target', timestamp: '2026-08-30T00:00:00.000Z', cwd: '/workspace' };
async function sessionFile(entries: unknown[], name = 'target.jsonl') {
  const path = join(directory, name);
  await writeFile(path, entries.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n'));
  return path;
}
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pi-session-discovery-')); reads.bytes = 0; });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('session discovery', () => {
  it('reads only the header block, not the large transcript', async () => {
    const path = await sessionFile(['', header, 'x'.repeat(2 * 1024 * 1024)]);
    expect(await readSessionHeader(path)).toEqual(header);
    expect(reads.bytes).toBeLessThanOrEqual(4096);
  });

  it('bounds malformed/oversized header probes and handles deleted files', async () => {
    const path = await sessionFile([' '.repeat(70 * 1024), header]);
    expect(await readSessionHeader(path)).toBeUndefined();
    expect(reads.bytes).toBe(64 * 1024);
    expect(await readSessionHeader(join(directory, 'missing.jsonl'))).toBeUndefined();
    expect(await readPersistedSessionInfo(join(directory, 'missing.jsonl'))).toBeUndefined();
  });

  it('handles a header without a newline, malformed lines, and non-session files', async () => {
    expect(await readSessionHeader(await sessionFile([header]))).toEqual(header);
    expect(await readSessionHeader(await sessionFile(['broken', header]))).toEqual(header);
    expect(await readSessionHeader(await sessionFile([{ type: 'message' }, header]))).toBeUndefined();
  });

  it('preserves SDK listing metadata, user-only counts, branches, and name clears', async () => {
    const path = await sessionFile([
      header,
      { type: 'session_info', name: 'Old name' },
      { type: 'message', id: 'user-1', parentId: null, timestamp: '2026-08-30T01:00:00.000Z', message: { role: 'user', content: [{ type: 'image', data: 'abc' }, { type: 'text', text: 'Hello' }] } },
      'malformed JSON',
      { type: 'message', id: 'assistant', parentId: 'user-1', timestamp: '2026-08-30T02:00:00.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Hi' }], timestamp: Date.parse('2026-08-30T02:00:00.000Z') } },
      { type: 'message', id: 'tool', parentId: 'assistant', timestamp: '2026-08-30T04:00:00.000Z', message: { role: 'toolResult', content: [{ type: 'text', text: 'tool output' }], timestamp: Date.parse('2026-08-30T04:00:00.000Z') } },
      { type: 'message', id: 'user-2', parentId: 'user-1', timestamp: '2026-08-30T03:00:00.000Z', message: { role: 'user', content: 'Branch' } },
      { type: 'session_info', name: '  ' },
    ]);
    const [upstream] = await SessionManager.list('/workspace', directory);
    const result = await readPersistedSessionInfo(path);
    expect(result).toEqual({
      id: upstream.id, path, cwd: upstream.cwd, name: upstream.name,
      created: upstream.created.toISOString(), modified: upstream.modified.toISOString(),
      firstMessage: upstream.firstMessage, allMessagesText: upstream.allMessagesText, messageCount: 2,
    });
    expect(await readSessionHeader(path)).toEqual(header);
  });

  it('uses the header creation time for empty sessions and rejects invalid headers', async () => {
    expect(await readPersistedSessionInfo(await sessionFile([header]))).toMatchObject({ messageCount: 0, modified: header.timestamp });
    expect(await readPersistedSessionInfo(await sessionFile([{ type: 'message' }, header]))).toBeUndefined();
  });
});
