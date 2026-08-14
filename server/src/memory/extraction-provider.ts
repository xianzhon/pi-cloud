export const EXTRACTION_MAX_OUTPUT_TOKENS = 4_096;
export const EXTRACTION_MAX_CANDIDATES = 8;
export const EXTRACTION_MAX_CONTENT_LENGTH = 220;
export const EXTRACTION_MAX_TAGS = 4;
export const EXTRACTION_MAX_TAG_LENGTH = 24;
export const EXTRACTION_MAX_EVIDENCE_IDS = 4;

export const EXTRACTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: EXTRACTION_MAX_CANDIDATES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'scope', 'category', 'content', 'tags', 'evidenceIds', 'existingMemoryId'],
        properties: {
          operation: { type: 'string', enum: ['new', 'duplicate', 'replace'] },
          scope: { type: 'string', enum: ['project', 'global'] },
          category: { type: 'string', enum: ['rule', 'preference', 'decision', 'fact', 'pitfall'] },
          content: { type: 'string', minLength: 1, maxLength: EXTRACTION_MAX_CONTENT_LENGTH },
          tags: {
            type: 'array',
            maxItems: EXTRACTION_MAX_TAGS,
            items: { type: 'string', minLength: 1, maxLength: EXTRACTION_MAX_TAG_LENGTH },
          },
          evidenceIds: {
            type: 'array',
            minItems: 1,
            maxItems: EXTRACTION_MAX_EVIDENCE_IDS,
            items: { type: 'string', pattern: '^e[1-9][0-9]*$' },
          },
          existingMemoryId: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

interface ExtractionModel {
  provider?: string;
  api?: string;
}

const VERIFIED_NATIVE_SCHEMA_PROVIDERS = new Set(['anthropic', 'google', 'google-vertex', 'openai']);

export interface ExtractionStructuredOutputAdapter {
  method: 'native-json-schema' | 'prompt-json';
  onPayload?: (payload: unknown) => unknown;
}

export function extractionStructuredOutput(model: ExtractionModel): ExtractionStructuredOutputAdapter {
  if (!model.provider || !VERIFIED_NATIVE_SCHEMA_PROVIDERS.has(model.provider)) {
    return { method: 'prompt-json' };
  }
  switch (model.api) {
    case 'openai-responses':
    case 'openai-codex-responses':
    case 'azure-openai-responses':
      return {
        method: 'native-json-schema',
        onPayload: (payload) => mergePayload(payload, {
          text: {
            format: {
              type: 'json_schema',
              name: 'memory_extraction',
              strict: true,
              schema: EXTRACTION_OUTPUT_SCHEMA,
            },
          },
        }),
      };
    case 'openai-completions':
      return {
        method: 'native-json-schema',
        onPayload: (payload) => mergePayload(payload, {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'memory_extraction',
              strict: true,
              schema: EXTRACTION_OUTPUT_SCHEMA,
            },
          },
        }),
      };
    case 'anthropic-messages':
      return {
        method: 'native-json-schema',
        onPayload: (payload) => mergePayload(payload, {
          output_config: {
            format: { type: 'json_schema', schema: EXTRACTION_OUTPUT_SCHEMA },
          },
        }),
      };
    case 'google-generative-ai':
    case 'google-vertex':
      return {
        method: 'native-json-schema',
        onPayload: (payload) => {
          const base = isObject(payload) ? payload : {};
          return {
            ...base,
            config: {
              ...(isObject(base.config) ? base.config : {}),
              responseMimeType: 'application/json',
              responseJsonSchema: EXTRACTION_OUTPUT_SCHEMA,
            },
          };
        },
      };
    default:
      return { method: 'prompt-json' };
  }
}

function mergePayload(payload: unknown, addition: Record<string, unknown>): Record<string, unknown> {
  return { ...(isObject(payload) ? payload : {}), ...addition };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
