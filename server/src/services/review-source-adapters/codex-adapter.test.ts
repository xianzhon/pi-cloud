import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexReviewSourceAdapter } from './codex-adapter.js';

function writeJsonl(filePath: string, records: object[]): void {
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n'));
}

describe('CodexReviewSourceAdapter', () => {
  let dataPath: string;
  let adapter: CodexReviewSourceAdapter;

  beforeEach(() => {
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-adapter-'));
    const sessionDir = path.join(dataPath, '2026', '08', '18');
    fs.mkdirSync(sessionDir, { recursive: true });
    writeJsonl(path.join(sessionDir, 'rollout-session-1.jsonl'), [
      { timestamp: '2026-08-18T10:00:00Z', type: 'session_meta', payload: { id: 'session-1', cwd: '/tmp/project' } },
      { timestamp: '2026-08-18T10:00:01Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Internal instructions' }] } },
      { timestamp: '2026-08-18T10:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /tmp/project' }] } },
      { timestamp: '2026-08-18T10:00:03Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Please review this change' }] } },
      { timestamp: '2026-08-18T10:00:04Z', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Inspect the files' }] } },
      { timestamp: '2026-08-18T10:00:05Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'call-exec', arguments: '{"cmd":"git diff"}' } },
      { timestamp: '2026-08-18T10:00:06Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-exec', output: 'Chunk ID: abc123\nWall time: 0.1 seconds\nProcess exited with code 0\nFinal output:\ndiff output' } },
      { timestamp: '2026-08-18T10:00:07Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call-patch', input: 'patch contents' } },
      { timestamp: '2026-08-18T10:00:08Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-patch', output: 'patch applied' } },
      { timestamp: '2026-08-18T10:00:09Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Looks good' }] } },
    ]);
    adapter = new CodexReviewSourceAdapter(dataPath);
  });

  afterEach(() => fs.rmSync(dataPath, { recursive: true, force: true }));

  it('discovers nested sessions and lists their metadata', async () => {
    const sessions = await adapter.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'session-1',
      cwd: '/tmp/project',
      messageCount: 9,
      firstMessage: 'Please review this change',
    });
  });

  it('normalizes Codex messages, reasoning, and tool calls', async () => {
    const transcript = await adapter.getTranscript('session-1');
    expect(transcript.metadata).toEqual({ sessionId: 'session-1', format: 'codex-jsonl' });
    expect(transcript.messages[0]).toMatchObject({ role: 'developer', detailOnly: true });
    expect(transcript.messages[1]).toMatchObject({ role: 'user', detailOnly: true });
    expect(transcript.messages[3].content).toContain('<thinking>');
    expect(transcript.messages[4].content).toContain('<tool_call name="exec_command" id="call-exec">');
    expect(transcript.messages[5].content).toBe('<observation tool_call_id="call-exec">\ndiff output\n</observation>');
    expect(transcript.messages[6].content).toContain('<tool_call name="apply_patch" id="call-patch">');
    expect(transcript.messages[7].content).toContain('<observation tool_call_id="call-patch">');
    expect(transcript.messages[8].content).toBe('Looks good');
  });

  it('searches transcript text and filters by project', async () => {
    await expect(adapter.search('looks good', { projectPath: '/tmp/project' })).resolves.toHaveLength(1);
    await expect(adapter.list({ projectPath: '/tmp/other' })).resolves.toHaveLength(0);
    await expect(adapter.listProjectPaths()).resolves.toEqual(['/tmp/project']);
  });

  it('does not modify Codex sessions', async () => {
    await expect(adapter.delete('session-1')).rejects.toThrow('read-only');
    await expect(adapter.getTranscript('../session')).rejects.toThrow('Invalid review session ID');
  });
});
