import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeCodeReviewSourceAdapter } from './claude-code-adapter.js';

function writeJsonl(filePath: string, records: object[]): void {
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n'));
}

describe('ClaudeCodeReviewSourceAdapter', () => {
  let dataPath: string;
  let adapter: ClaudeCodeReviewSourceAdapter;

  beforeEach(() => {
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-adapter-'));
    const projectDir = path.join(dataPath, '-tmp-project');
    fs.mkdirSync(projectDir);
    writeJsonl(path.join(projectDir, 'session-1.jsonl'), [
      { type: 'ai-title', aiTitle: 'Review the change', sessionId: 'session-1', cwd: '/tmp/project', timestamp: '2026-08-18T10:00:00Z' },
      { type: 'user', sessionId: 'session-1', cwd: '/tmp/project', timestamp: '2026-08-18T10:00:01Z', message: { role: 'user', content: 'Please review this' } },
      { type: 'assistant', sessionId: 'session-1', cwd: '/tmp/project', timestamp: '2026-08-18T10:00:02Z', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'Inspect the files' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
      ] } },
      { type: 'user', sessionId: 'session-1', cwd: '/tmp/project', timestamp: '2026-08-18T10:00:03Z', message: { role: 'user', content: [
        { type: 'tool_result', content: 'file contents' },
      ] } },
      { type: 'assistant', sessionId: 'session-1', cwd: '/tmp/project', timestamp: '2026-08-18T10:00:04Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Looks good' }] } },
      { type: 'assistant', sessionId: 'session-1', cwd: '/tmp/project', isSidechain: true, timestamp: '2026-08-18T10:00:05Z', message: { role: 'assistant', content: 'subagent detail' } },
    ]);
    adapter = new ClaudeCodeReviewSourceAdapter(dataPath);
  });

  afterEach(() => fs.rmSync(dataPath, { recursive: true, force: true }));

  it('lists sessions with metadata from JSONL records', async () => {
    const sessions = await adapter.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'session-1',
      name: 'Review the change',
      cwd: '/tmp/project',
      messageCount: 4,
      firstMessage: 'Please review this',
    });
  });

  it('normalizes Claude content blocks for review rendering', async () => {
    const transcript = await adapter.getTranscript('session-1');
    expect(transcript.messages).toHaveLength(4);
    expect(transcript.messages[1].content).toContain('<thinking>');
    expect(transcript.messages[1].content).toContain('<tool_call name="Read">');
    expect(transcript.messages[2]).toMatchObject({ role: 'assistant' });
    expect(transcript.messages[2].content).toContain('<observation>');
    expect(transcript.messages[3].content).toBe('Looks good');
  });

  it('searches transcript text and filters by project', async () => {
    await expect(adapter.search('looks good', { projectPath: '/tmp/project' })).resolves.toHaveLength(1);
    await expect(adapter.list({ projectPath: '/tmp/other' })).resolves.toHaveLength(0);
    await expect(adapter.listProjectPaths()).resolves.toEqual(['/tmp/project']);
  });

  it('does not modify Claude Code sessions', async () => {
    await expect(adapter.delete('session-1')).rejects.toThrow('read-only');
    await expect(adapter.getTranscript('../session')).rejects.toThrow('Invalid review session ID');
  });
});
