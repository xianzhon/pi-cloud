import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, buildExtractionSource, parseExtractionOutput } from './legacy-extraction.js';
import { hashMemoryContent } from './validation.js';

const entries = [
  { id: 'before', type: 'message', message: { role: 'user', content: 'before' } },
  { id: 'start', type: 'branch' },
  { id: 'u1', type: 'message', message: { role: 'user', content: [{ type: 'text', text: ' Always use pnpm. ' }, { type: 'image', data: 'x' }, { type: 'text', text: ' ' }] } },
  { id: 'a1', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: ' Updated config. ' }, { type: 'toolCall', name: 'read', arguments: { filePath: '/repo/a b.ts' } }, { type: 'toolCall', name: 'bash', arguments: {} }] } },
  { id: 'other', type: 'message', message: { role: 'system', content: 'ignored' } },
  { id: 'end', type: 'message', message: { role: 'user', content: 'Remember this for future tasks.' } },
] as any[];

const existing = {
  id: 'memory-1', scope: 'project', category: 'fact', content: 'Existing fact',
  contentHash: hashMemoryContent('Existing fact'), status: 'active',
} as any;

function candidate(overrides = {}) {
  return {
    operation: 'new', scope: 'project', category: 'fact', content: 'Use pnpm for this repository.',
    tags: [' package ', 'package'], evidence: 'Always use pnpm.', existingMemoryId: null, ...overrides,
  };
}

describe('legacy extraction parsing', () => {
  const source = buildExtractionSource(entries as any, 'start', 'end');

  it('builds extraction source from user, assistant, and tool entries', () => {
    expect(source.text).toContain('[User] Always use pnpm.');
    expect(source.text).toContain('[Assistant] Updated config.');
    expect(source.text).toContain('[Assistant tool] read path=/repo/a b.ts');
    expect(source.text).toContain('[Assistant tool] bash');
    expect(source.evidence).toHaveLength(3);
    expect(buildExtractionSource(entries as any, undefined, 'u1').text).toContain('before');
  });

  it('rejects invalid branch boundaries', () => {
    expect(() => buildExtractionSource(entries as any, undefined, 'missing')).toThrow('ending leaf');
    expect(() => buildExtractionSource(entries as any, 'missing', 'end')).toThrow('starting leaf is not');
    expect(() => buildExtractionSource(entries as any, 'end', 'start')).toThrow('must be before');
  });

  it('escapes source and memories in the extraction prompt', () => {
    const prompt = buildExtractionPrompt({ text: '<unsafe>&', evidence: [] }, [{ ...existing, content: '<fact>' }]);
    expect(prompt).toContain('\\u003cunsafe\\u003e\\u0026');
    expect(prompt).not.toContain('<unsafe>');
    expect(prompt).toContain('"id":"memory-1"');
  });

  it('accepts fenced and embedded JSON candidates', () => {
    const fenced = parseExtractionOutput(`\`\`\`json\n${JSON.stringify({ candidates: [candidate()] })}\n\`\`\``, source, []);
    expect(fenced.valid[0]).toMatchObject({ operation: 'new', scope: 'project', tags: ['package'] });
    const embedded = parseExtractionOutput(`prose {bad} then ${JSON.stringify({ candidates: [candidate({ category: 'rule', scope: 'global', content: 'Always use pnpm.' })] })} trailing`, source, []);
    expect(embedded.valid).toHaveLength(1);
  });

  it('accepts duplicate and replacement operations against matching memories', () => {
    const output = parseExtractionOutput(JSON.stringify({ candidates: [
      candidate({ operation: 'duplicate', existingMemoryId: existing.id, content: 'Existing fact' }),
      candidate({ operation: 'replace', existingMemoryId: existing.id, content: 'Replacement fact' }),
    ] }), source, [existing]);
    expect(output.valid.map((item) => item.operation)).toEqual(['duplicate', 'replace']);
  });

  it('discards malformed and unsafe candidates and caps output at twenty', () => {
    const invalid = [
      null,
      candidate({ operation: 'bad' }), candidate({ scope: 'bad' }), candidate({ category: 'bad' }),
      candidate({ content: 1 }), candidate({ evidence: 1 }), candidate({ tags: [1] }),
      candidate({ scope: 'global', category: 'fact' }),
      candidate({ existingMemoryId: 'memory-1' }),
      candidate({ operation: 'replace', existingMemoryId: 'missing' }),
      candidate({ operation: 'replace', existingMemoryId: 'memory-1', scope: 'global', category: 'rule' }),
      candidate({ content: '' }),
      candidate({ evidence: 'not present' }),
      candidate({ category: 'rule', evidence: 'Updated config.' }),
      candidate({ category: 'preference', evidence: 'Do not format this response.' }),
      candidate({ category: 'rule', evidence: 'Always use pnpm.', content: 'Existing fact' }),
    ];
    const result = parseExtractionOutput(JSON.stringify({ candidates: [...invalid, ...Array.from({ length: 10 }, () => candidate())] }), source, [existing]);
    expect(result.discarded).toBeGreaterThanOrEqual(invalid.length);
    expect(result.valid.length).toBeGreaterThan(0);
  });

  it('allows explicit durable rule language and ignores archived duplicates', () => {
    const durable = candidate({ category: 'preference', evidence: 'Remember this for future tasks.', content: 'Keep this preference.' });
    expect(parseExtractionOutput(JSON.stringify({ candidates: [durable] }), source, []).valid).toHaveLength(1);
    expect(parseExtractionOutput(JSON.stringify({ candidates: [candidate({ content: 'Existing fact' })] }), source, [{ ...existing, status: 'archived' }]).valid).toHaveLength(1);
    expect(parseExtractionOutput(JSON.stringify({ candidates: [candidate({ content: 'Existing fact' })] }), source, [existing]).valid).toHaveLength(0);
  });

  it('rejects non-object and invalid JSON output', () => {
    expect(() => parseExtractionOutput('[]', source, [])).toThrow('candidates array');
    expect(() => parseExtractionOutput('{"value":1}', source, [])).toThrow('candidates array');
    expect(() => parseExtractionOutput('not json {bad', source, [])).toThrow('not valid JSON');
  });
});
