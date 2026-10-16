import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  buildExtractionSource,
  parseExtractionOutput,
} from './extraction-format.js';
import type { MemoryRecord } from './types.js';
import { hashMemoryContent } from './validation.js';

const entries = [
  {
    type: 'message', id: 'start-id', parentId: null, timestamp: '',
    message: { role: 'user', content: 'Earlier request', timestamp: 1 },
  },
  {
    type: 'message', id: 'user-id', parentId: 'start-id', timestamp: '',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'Always share memory with managed worktrees.' },
        { type: 'text', text: 'Always share memory with managed worktrees.' },
      ],
      timestamp: 2,
    },
  },
  {
    type: 'message', id: 'assistant-id', parentId: 'user-id', timestamp: '',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'private chain of thought' },
        { type: 'text', text: 'I will inspect the server next.' },
        { type: 'text', text: 'Implemented the stable base-project identity.' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'server/src/index.ts' } },
        { type: 'toolCall', id: 'call-2', name: 'edit', arguments: { path: 'server/src/memory/store.ts' } },
      ],
      timestamp: 3,
    },
  },
  {
    type: 'message', id: 'tool-id', parentId: 'assistant-id', timestamp: '',
    message: {
      role: 'toolResult', toolCallId: 'call-1', toolName: 'read',
      content: [{ type: 'text', text: 'raw secret-bearing tool output' }], isError: false, timestamp: 4,
    },
  },
  {
    type: 'compaction', id: 'end-id', parentId: 'tool-id', timestamp: '',
    summary: 'Compaction body should be omitted', firstKeptEntryId: 'user-id', tokensBefore: 100,
  },
] as any[];

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'memory-1', profileId: 'default', projectId: 'project-1', scope: 'project', category: 'decision',
    content: 'Use path IDs', contentHash: 'hash', tags: [], pinned: false, pinnedApplicability: 'always',
    status: 'active', source: 'manual_ui', revision: 1, createdAt: '', updatedAt: '', useCount: 0,
    positiveUtilityCount: 0, negativeUtilityCount: 0, ...overrides,
  };
}

describe('extraction format', () => {
  it('builds compact stable evidence records and drops duplicates and routine narration', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');

    expect(source.text).toContain('e1 user');
    expect(source.text).toContain('e2 assistant');
    expect(source.text).toContain('e3 tool');
    expect(source.text).toContain('Always share memory with managed worktrees.');
    expect(source.text).toContain('Implemented the stable base-project identity.');
    expect(source.text).toContain('edit server/src/memory/store.ts');
    expect(source.text).not.toContain('I will inspect');
    expect(source.text).not.toContain('read server/src/index.ts');
    expect(source.text).not.toContain('Earlier request');
    expect(source.text).not.toContain('private chain of thought');
    expect(source.text).not.toContain('raw secret-bearing tool output');
    expect(source.text).not.toContain('Compaction body should be omitted');
    expect(source.evidence).toEqual([
      { id: 'e1', role: 'user', text: 'Always share memory with managed worktrees.' },
      { id: 'e2', role: 'assistant', text: 'Implemented the stable base-project identity.' },
      { id: 'e3', role: 'tool', text: 'edit server/src/memory/store.ts', tool: 'edit', path: 'server/src/memory/store.ts' },
    ]);
  });

  it('retains declarative assistant facts while excluding future intent', () => {
    const source = buildExtractionSource([
      {
        type: 'message', id: 'fact', parentId: null, timestamp: '',
        message: {
          role: 'assistant', timestamp: 1,
          content: [
            { type: 'text', text: 'The server is built with Fastify.' },
            { type: 'text', text: 'I will update the route next.' },
          ],
        },
      },
    ] as any, undefined, 'fact');

    expect(source.evidence).toEqual([
      { id: 'e1', role: 'assistant', text: 'The server is built with Fastify.' },
    ]);
  });

  it.each([
    'Confirmed: the Docker runtime now uses Alpine; the image build removes npm cache and unused Ace distributions.',
    '已确认：Docker 运行时采用 Alpine；镜像构建会清理 npm 缓存和未使用的 Ace 发行文件。',
  ])('retains confirmed Docker configuration as evidence, not just mutation paths: %s', (summary) => {
    const source = buildExtractionSource([
      {
        type: 'message', id: 'docker-user', parentId: null, timestamp: '',
        message: { role: 'user', content: 'Reduce the Docker image size.', timestamp: 1 },
      },
      {
        type: 'message', id: 'docker-summary', parentId: 'docker-user', timestamp: '',
        message: { role: 'assistant', timestamp: 2, content: [
          { type: 'text', text: 'I am checking the image layers.' },
          { type: 'text', text: summary },
          { type: 'toolCall', id: 'edit-docker', name: 'edit', arguments: { path: 'Dockerfile' } },
        ] },
      },
      {
        type: 'message', id: 'docker-end', parentId: 'docker-summary', timestamp: '',
        message: { role: 'toolResult', toolCallId: 'build', toolName: 'bash',
          content: [{ type: 'text', text: 'Temporary image measurement: 123 MB. Raw build output.' }],
          isError: false, timestamp: 3 },
      },
    ] as any, undefined, 'docker-end');

    expect(source.evidence).toContainEqual(expect.objectContaining({ role: 'assistant', text: summary }));
    const prompt = buildExtractionPrompt(source, []);
    expect(prompt).toContain(summary);
    expect(prompt).not.toContain('checking the image layers');
    expect(prompt).not.toContain('Temporary image measurement');
    const parsed = parseExtractionOutput(JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'fact',
      content: 'The Docker runtime uses Alpine.', tags: ['docker'], evidenceIds: ['e2'],
    }, {
      operation: 'new', scope: 'project', category: 'fact',
      content: 'The Docker image build removes npm cache and unused Ace distributions.',
      tags: ['docker'], evidenceIds: ['e2'],
    }] }), source, []);
    expect(parsed.valid.map((candidate) => candidate.content)).toEqual([
      'The Docker runtime uses Alpine.',
      'The Docker image build removes npm cache and unused Ace distributions.',
    ]);
    expect(parsed.discarded).toBe(0);
  });

  it('accepts a legitimate empty result for a one-off Docker task without inventing facts', () => {
    const source = buildExtractionSource([{
      type: 'message', id: 'docker-task', parentId: null, timestamp: '',
      message: { role: 'user', content: 'Just inspect the Docker image size for this run.', timestamp: 1 },
    }] as any, undefined, 'docker-task');

    expect(parseExtractionOutput('{"candidates":[]}', source, [])).toEqual({
      valid: [], emittedCount: 0, discarded: 0,
    });
    expect(parseExtractionOutput(JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'rule',
      content: 'Inspect Docker image size on every run.', tags: [], evidenceIds: ['e1'],
    }] }), source, []).valid).toEqual([]);
  });

  it('keeps the latest durable evidence when normalized input exceeds the cap', () => {
    const entries = Array.from({ length: 65 }, (_, index) => ({
      type: 'message', id: `m${index + 1}`, parentId: index ? `m${index}` : null, timestamp: '',
      message: {
        role: 'user', timestamp: index + 1,
        content: index === 64 ? 'Always run the final verification command.' : `Working note ${index + 1}`,
      },
    }));

    const source = buildExtractionSource(entries as any, undefined, 'm65');

    expect(source.evidence).toHaveLength(64);
    expect(source.evidence.at(-1)).toMatchObject({
      id: 'e64', role: 'user', text: 'Always run the final verification command.',
    });
  });

  it('supports a full branch and rejects invalid ranges', () => {
    expect(buildExtractionSource(entries as any, undefined, 'end-id').text).toContain('Earlier request');
    expect(() => buildExtractionSource(entries as any, 'missing', 'end-id')).toThrow(/starting leaf/i);
    expect(() => buildExtractionSource(entries as any, 'end-id', 'user-id')).toThrow(/before ending/i);
    expect(() => buildExtractionSource(entries as any, 'start-id', 'missing')).toThrow(/ending leaf/i);
  });

  it('builds a strict prompt with source and nearby memory', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');
    const prompt = buildExtractionPrompt(source, [memory()]);

    expect(prompt).toContain('strict JSON');
    expect(prompt).toContain('managed worktrees');
    expect(prompt).toContain('"id":"m1"');
    expect(prompt).not.toContain('memory-1');
    expect(prompt).toContain('evidenceIds');
    expect(prompt).toContain('new | duplicate | replace');
  });

  it('parses strict plain or fenced JSON candidates and resolves evidence IDs', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');
    const payload = {
      candidates: [{
        operation: 'new', scope: 'project', category: 'decision',
        content: 'Managed worktrees share base-project memory', tags: ['worktree'],
        evidenceIds: ['e1', 'e2'],
      }],
    };

    const parsed = parseExtractionOutput(JSON.stringify(payload), source, []);
    expect(parsed.valid).toEqual([expect.objectContaining({
      evidenceIds: ['e1', 'e2'],
      evidence: 'Always share memory with managed worktrees. Implemented the stable base-project identity.',
    })]);
    expect(parseExtractionOutput(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``, source, []).valid).toHaveLength(1);
    expect(() => parseExtractionOutput(`Here is the JSON:\n${JSON.stringify(payload)}\nDone.`, source, []))
      .toThrow(/valid JSON/i);
  });

  it('discards new candidates that exactly duplicate searched live memories', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');
    const existing = memory({
      content: 'Managed worktrees share base-project memory',
      contentHash: hashMemoryContent('Managed worktrees share base-project memory'),
    });
    const duplicateNew = JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'decision',
      content: '  managed worktrees share base-project memory ', tags: ['worktree'],
      evidenceIds: ['e1'],
    }] });

    expect(parseExtractionOutput(duplicateNew, source, [existing])).toEqual({ valid: [], emittedCount: 1, discarded: 1 });
  });

  it('requires known existing IDs and matching replacement scope', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');
    const unknown = JSON.stringify({ candidates: [{
      operation: 'replace', scope: 'project', category: 'decision', content: 'Stable identity', tags: [],
      evidenceIds: ['e2'], existingMemoryId: 'missing',
    }] });
    const wrongScope = JSON.stringify({ candidates: [{
      operation: 'replace', scope: 'global', category: 'decision', content: 'Stable identity', tags: [],
      evidenceIds: ['e2'], existingMemoryId: 'm1',
    }] });

    expect(parseExtractionOutput(unknown, source, [memory()])).toEqual({ valid: [], emittedCount: 1, discarded: 1 });
    expect(parseExtractionOutput(wrongScope, source, [memory()])).toEqual({ valid: [], emittedCount: 1, discarded: 1 });
  });

  it('requires durable user evidence for rules and preferences', () => {
    const source = buildExtractionSource([
      ...entries,
      {
        type: 'message', id: 'task-instruction-id', parentId: 'end-id', timestamp: '',
        message: { role: 'user', content: 'no need to write design doc, just implement the code.', timestamp: 5 },
      },
    ] as any, 'start-id', 'task-instruction-id');
    const assistantRule = JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'rule', content: 'Use stable identity', tags: [],
      evidenceIds: ['e2'],
    }] });
    const transientRule = JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'rule', content: 'Implement code without writing design docs', tags: [],
      evidenceIds: ['e4'],
    }] });
    const userRule = JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'rule', content: 'Share memory with worktrees', tags: [],
      evidenceIds: ['e1'],
    }] });

    expect(parseExtractionOutput(assistantRule, source, []).valid).toHaveLength(0);
    expect(parseExtractionOutput(transientRule, source, []).valid).toHaveLength(0);
    expect(parseExtractionOutput(userRule, source, []).valid).toHaveLength(1);
  });

  it('discards secrets, unsupported evidence, and malformed candidates', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');
    const output = JSON.stringify({ candidates: [
      {
        operation: 'new', scope: 'project', category: 'fact',
        content: `API_KEY=${'sk-' + 'a'.repeat(32)}`, tags: [],
        evidenceIds: ['e2'],
      },
      {
        operation: 'new', scope: 'project', category: 'fact',
        content: 'Unsupported fact', tags: [], evidenceIds: ['missing'],
      },
      { operation: 'unknown' },
    ] });

    expect(parseExtractionOutput(output, source, [])).toEqual({ valid: [], emittedCount: 3, discarded: 3 });
  });

  it('throws for malformed roots and discards candidate properties outside the schema', () => {
    const source = buildExtractionSource(entries as any, 'start-id', 'end-id');
    expect(() => parseExtractionOutput('not json', source, [])).toThrow(/valid JSON/i);
    expect(() => parseExtractionOutput('{"items":[]}', source, [])).toThrow(/candidates array/i);
    expect(() => parseExtractionOutput('{"candidates":[],"extra":true}', source, [])).toThrow(/top-level/i);
    expect(parseExtractionOutput(JSON.stringify({ candidates: [{
      operation: 'new', scope: 'project', category: 'fact', content: 'Unexpected field', tags: [],
      evidenceIds: ['e1'], extra: true,
    }] }), source, [])).toEqual({ valid: [], emittedCount: 1, discarded: 1 });
  });
});
