import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevinReviewSourceAdapter } from './devin-adapter.js';

describe('DevinReviewSourceAdapter', () => {
  let dataPath: string;
  let adapter: DevinReviewSourceAdapter;

  beforeEach(() => {
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-adapter-'));
    const db = new Database(path.join(dataPath, 'sessions.db'));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        working_directory TEXT NOT NULL,
        backend_type TEXT NOT NULL,
        model TEXT NOT NULL,
        agent_mode TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        title TEXT
      );
      INSERT INTO sessions (id, working_directory, backend_type, model, agent_mode, created_at, last_activity_at, title)
      VALUES ('abc-123', '/tmp/project', 'devin', 'kimi', 'normal', 1700000000, 1700000100, 'Test Session');
    `);
    db.close();
    fs.mkdirSync(path.join(dataPath, 'transcripts'));
    fs.writeFileSync(path.join(dataPath, 'transcripts', 'abc-123.json'), JSON.stringify({
      schema_version: 'ATIF-v1.7',
      session_id: 'abc-123',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1700000000 },
        { role: 'assistant', content: 'hi there', timestamp: 1700000050 },
      ],
    }));
    adapter = new DevinReviewSourceAdapter(dataPath);
  });

  afterEach(() => {
    fs.rmSync(dataPath, { recursive: true, force: true });
  });

  it('lists sessions', async () => {
    const sessions = await adapter.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('abc-123');
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].name).toBe('Test Session');
    expect(sessions[0].cwd).toBe('/tmp/project');
  });

  it('searches transcripts', async () => {
    const results = await adapter.search('hello');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('abc-123');
  });

  it('returns transcript', async () => {
    const transcript = await adapter.getTranscript('abc-123');
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[0].role).toBe('user');
  });

  it('rejects session IDs that escape the transcript directory', async () => {
    await expect(adapter.getTranscript('../outside')).rejects.toThrow('Invalid review session ID');
    await expect(adapter.delete('../outside')).rejects.toThrow('Invalid review session ID');
  });

  it('extracts messages from ATIF steps format', async () => {
    const db = new Database(path.join(dataPath, 'sessions.db'));
    db.prepare(`
      INSERT INTO sessions (id, working_directory, backend_type, model, agent_mode, created_at, last_activity_at, title)
      VALUES ('atif-123', '/tmp/project', 'devin', 'kimi', 'normal', 1700000000, 1700000100, 'ATIF Session')
    `).run();
    db.close();
    fs.writeFileSync(path.join(dataPath, 'transcripts', 'atif-123.json'), JSON.stringify({
      schema_version: 'ATIF-v1.7',
      session_id: 'atif-123',
      steps: [
        { step_id: 1, timestamp: '2026-08-17T10:00:00Z', source: 'system', message: 'system context', extra: {} },
        { step_id: 2, timestamp: '2026-08-17T10:00:01Z', source: 'user', message: 'hello devin', extra: {} },
        { step_id: 3, timestamp: '2026-08-17T10:00:02Z', source: 'agent', message: '', reasoning_content: 'thinking', tool_calls: [{ name: 'read', input: { file: 'test.txt' } }], observation: { results: 'file content' }, extra: {} },
        { step_id: 4, timestamp: '2026-08-17T10:00:03Z', source: 'agent', message: 'hi there', extra: {} },
      ],
    }));
    const atifAdapter = new DevinReviewSourceAdapter(dataPath);
    const sessions = await atifAdapter.list();
    const atifSession = sessions.find((s) => s.id === 'atif-123');
    expect(atifSession).toBeDefined();
    expect(atifSession!.messageCount).toBe(4);

    const transcript = await atifAdapter.getTranscript('atif-123');
    expect(transcript.messages).toHaveLength(4);
    expect(transcript.messages[0].role).toBe('assistant');
    expect(transcript.messages[0].content).toBe('system context');
    expect(transcript.messages[1].role).toBe('user');
    expect(transcript.messages[1].content).toBe('hello devin');
    expect(transcript.messages[2].role).toBe('assistant');
    expect(transcript.messages[2].content).toContain('<thinking>');
    expect(transcript.messages[2].content).toContain('<tool_call');
    expect(transcript.messages[3].role).toBe('assistant');
    expect(transcript.messages[3].content).toBe('hi there');
  });

  it('deletes session data', async () => {
    await adapter.delete('abc-123');
    expect(fs.existsSync(path.join(dataPath, 'transcripts', 'abc-123.json'))).toBe(false);
    const db = new Database(path.join(dataPath, 'sessions.db'));
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get('abc-123');
    db.close();
    expect(row).toBeUndefined();
  });

  it('lists distinct project paths from working_directory ordered by recency', async () => {
    const db = new Database(path.join(dataPath, 'sessions.db'));
    db.prepare(`
      INSERT INTO sessions (id, working_directory, backend_type, model, agent_mode, created_at, last_activity_at, title)
      VALUES ('older', '/tmp/project', 'devin', 'kimi', 'normal', 1700000000, 1700000050, 'Older')
    `).run();
    db.prepare(`
      INSERT INTO sessions (id, working_directory, backend_type, model, agent_mode, created_at, last_activity_at, title)
      VALUES ('newer', '/tmp/other', 'devin', 'kimi', 'normal', 1700000000, 1700000200, 'Newer')
    `).run();
    db.close();
    const paths = await adapter.listProjectPaths();
    expect(paths).toEqual(['/tmp/other', '/tmp/project']);
  });
});
