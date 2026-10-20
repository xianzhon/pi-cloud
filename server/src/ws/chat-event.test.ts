import { describe, expect, it } from 'vitest';
import { compactChatEvent } from './chat-event.js';

describe('compactChatEvent', () => {
  it.each(['text', 'thinking'])('keeps %s deltas without growing snapshots or signatures', (kind) => {
    const message = { role: 'assistant', responseId: 'r1', timestamp: 123, content: [{ type: kind, [kind]: 'x'.repeat(100_000), signature: 'secret' }] };
    const event = { type: 'message_update', message, assistantMessageEvent: { type: `${kind}_delta`, contentIndex: 0, delta: 'new', partial: message } };
    const compact = compactChatEvent(event);
    expect(compact).toEqual({
      type: 'message_update',
      message: { role: 'assistant', responseId: 'r1', timestamp: 123 },
      assistantMessageEvent: { type: `${kind}_delta`, contentIndex: 0, delta: 'new' },
    });
    expect(JSON.stringify(compact).length).toBeLessThan(300);
    expect(event.assistantMessageEvent.partial).toBe(message);
  });

  it.each(['text_end', 'thinking_end'])('does not repeat completed content in %s', (type) => {
    expect(compactChatEvent({ type: 'message_update', assistantMessageEvent: { type, content: 'already sent', partial: { content: [] } } }))
      .toMatchObject({ assistantMessageEvent: { type } });
    expect(JSON.stringify(compactChatEvent({ type: 'message_update', assistantMessageEvent: { type, content: 'already sent' } })))
      .not.toContain('already sent');
  });

  it('projects the active tool by contentIndex, sends argument deltas, and retains final arguments', () => {
    const tool = { type: 'toolCall', id: 'second', name: 'write', arguments: { content: 'large code' } };
    const partial = { content: [{ type: 'text', text: 'long thinking' }, { ...tool, id: 'first' }, tool] };
    for (const type of ['toolcall_start', 'toolcall_delta', 'toolcall_end']) {
      const result = compactChatEvent({ type: 'message_update', assistantMessageEvent: { type, contentIndex: 2, delta: 'chunk', partial, ...(type === 'toolcall_end' ? { toolCall: tool } : {}) } });
      expect(result).toMatchObject({ assistantMessageEvent: { type, toolCallId: 'second', toolName: 'write' } });
      const update = (result as any).assistantMessageEvent;
      expect(update).not.toHaveProperty('partial');
      expect(update).not.toHaveProperty('toolCall');
      if (type === 'toolcall_delta') {
        expect(update.inputDelta).toBe('chunk');
        expect(update).not.toHaveProperty('args');
      }
      if (type === 'toolcall_end') expect(update.args).toEqual(tool.arguments);
    }
  });

  it('preserves completed messages, errors, tool execution results, and unknown events', () => {
    for (const event of [
      { type: 'message_end', message: { content: ['full'], usage: { totalTokens: 10 }, stopReason: 'error', errorMessage: 'failed' } },
      { type: 'tool_execution_end', result: { content: ['output'] } },
      { type: 'message_update', assistantMessageEvent: { type: 'custom', partial: 'required' } },
      { type: 'agent_end' },
    ]) expect(compactChatEvent(event)).toBe(event);
  });

  it('makes total streamed text traffic linear rather than quadratic', () => {
    let total = 0;
    for (let i = 1; i <= 1000; i++) {
      const message = { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(i * 20) }] };
      total += JSON.stringify(compactChatEvent({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(20), partial: message } })).length;
    }
    expect(total).toBeLessThan(250_000);
  });
});
