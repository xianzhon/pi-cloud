import { describe, expect, it } from 'vitest';
import { evaluateDurableSignal } from './extraction-gate.js';
import type { ExtractionSource } from './extraction-format.js';

function source(...records: ExtractionSource['evidence']): ExtractionSource {
  return {
    evidence: records,
    text: records.map((record) => `${record.id} ${record.role} ${JSON.stringify(record.text)}`).join('\n'),
  };
}

describe('durable extraction gate', () => {
  it('extracts explicit durable instructions in English or Chinese', () => {
    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'user', text: 'Always include code and message in API errors.',
    }))).toMatchObject({ decision: 'extract', reasonCode: 'durable-language' });

    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'user', text: '以后本项目的 API 错误必须包含 code 和 message。',
    }))).toMatchObject({ decision: 'extract', reasonCode: 'durable-language' });
  });

  it('extracts confirmed decisions, corrections, and reusable outcomes', () => {
    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'assistant', text: 'Verified that worktrees use the base project identity.',
    }))).toMatchObject({ decision: 'extract', reasonCode: 'confirmed-outcome' });

    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'user', text: 'Correction: the API uses cursor pagination, not offsets.',
    }))).toMatchObject({ decision: 'extract', reasonCode: 'correction' });
  });

  it('skips acknowledgements and one-turn workflow instructions', () => {
    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'user', text: '好的，谢谢',
    }))).toMatchObject({ decision: 'skip', reasonCode: 'acknowledgement' });

    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'user', text: 'No need to write a plan, just implement this feature.',
    }))).toMatchObject({ decision: 'skip', reasonCode: 'transient-task' });
  });

  it('skips empty or tool-only deltas but sends ambiguous substantive text to extraction', () => {
    expect(evaluateDurableSignal(source())).toMatchObject({ decision: 'skip', reasonCode: 'empty' });
    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'tool', text: 'edit server/src/index.ts', tool: 'edit', path: 'server/src/index.ts',
    }))).toMatchObject({ decision: 'skip', reasonCode: 'tool-only' });
    expect(evaluateDurableSignal(source({
      id: 'e1', role: 'user', text: 'The task queue behavior around nested projects seems unusual.',
    }))).toMatchObject({ decision: 'extract', reasonCode: 'ambiguous' });
  });
});
