import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_MAX_CANDIDATES,
  EXTRACTION_MAX_CONTENT_LENGTH,
  EXTRACTION_MAX_EVIDENCE_IDS,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  EXTRACTION_MAX_TAG_LENGTH,
  EXTRACTION_MAX_TAGS,
  extractionStructuredOutput,
} from './extraction-provider.js';
import { estimateTokens } from './recall.js';

const official = (provider: string, api: string) => ({ provider, api });

const schemaExpectation = expect.objectContaining({
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
});

describe('extraction structured-output adapter', () => {
  it('fits the schema maximum within the configured output allowance', () => {
    const candidate = {
      operation: 'new', scope: 'project', category: 'fact',
      content: '界'.repeat(EXTRACTION_MAX_CONTENT_LENGTH),
      tags: Array.from({ length: EXTRACTION_MAX_TAGS }, () => '界'.repeat(EXTRACTION_MAX_TAG_LENGTH)),
      evidenceIds: Array.from({ length: EXTRACTION_MAX_EVIDENCE_IDS }, (_, index) => `e${index + 1}`),
      existingMemoryId: null,
    };
    const maximumOutput = JSON.stringify({
      candidates: Array.from({ length: EXTRACTION_MAX_CANDIDATES }, () => candidate),
    });

    expect(estimateTokens(maximumOutput)).toBeLessThanOrEqual(EXTRACTION_MAX_OUTPUT_TOKENS);
  });

  it('uses native JSON schema for OpenAI responses payloads', () => {
    const adapter = extractionStructuredOutput(official('openai', 'openai-responses'));
    const payload = adapter.onPayload?.({ model: 'gpt-test', input: [] });

    expect(adapter.method).toBe('native-json-schema');
    expect(payload).toEqual(expect.objectContaining({
      text: {
        format: expect.objectContaining({
          type: 'json_schema',
          name: 'memory_extraction',
          strict: true,
          schema: schemaExpectation,
        }),
      },
    }));
  });

  it('uses provider-appropriate schema fields and preserves existing payload fields', () => {
    const openAi = extractionStructuredOutput(official('openai', 'openai-completions'));
    expect(openAi.onPayload?.({ model: 'gpt-test', temperature: 0 })).toEqual(expect.objectContaining({
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: expect.objectContaining({ schema: schemaExpectation }),
      },
    }));

    const anthropic = extractionStructuredOutput(official('anthropic', 'anthropic-messages'));
    expect(anthropic.onPayload?.({ model: 'claude-test', max_tokens: 10 })).toEqual(expect.objectContaining({
      max_tokens: 10,
      output_config: { format: { type: 'json_schema', schema: schemaExpectation } },
    }));
  });

  it('adds Google schemas to the SDK config object for both official adapters', () => {
    for (const [provider, api] of [
      ['google', 'google-generative-ai'],
      ['google-vertex', 'google-vertex'],
    ]) {
      const adapter = extractionStructuredOutput(official(provider, api));
      expect(adapter.onPayload?.({ model: 'gemini-test', contents: [], config: { temperature: 0 } })).toEqual(
        expect.objectContaining({
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseJsonSchema: schemaExpectation,
          },
        }),
      );
    }
  });

  it('falls back to prompt-requested JSON for unverified compatibility providers', () => {
    expect(extractionStructuredOutput(official('custom', 'custom-api'))).toEqual({ method: 'prompt-json' });
    expect(extractionStructuredOutput(official('minimax', 'anthropic-messages'))).toEqual({ method: 'prompt-json' });
    expect(extractionStructuredOutput(official('deepseek', 'openai-completions'))).toEqual({ method: 'prompt-json' });
  });
});
