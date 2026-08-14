import { describe, expect, it } from 'vitest';
import { extractLastAssistantText } from './weixin-gateway.js';

describe('extractLastAssistantText', () => {
  it('extracts text content from the latest assistant message', () => {
    expect(extractLastAssistantText([
      { role: 'assistant', content: [{ type: 'text', text: 'older response' }] },
      { role: 'user', content: 'Please inspect the image.' },
      { role: 'assistant', content: [{ type: 'text', text: 'latest response' }] },
    ])).toBe('latest response');
  });

  it('falls back to content fields in assistant message parts', () => {
    expect(extractLastAssistantText([
      { role: 'assistant', content: [{ type: 'text', content: 'fallback response' }] },
    ])).toBe('fallback response');
  });
});
