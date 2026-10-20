import { describe, expect, it } from 'vitest';
import { projectChatEvent, projectChatMessages } from './chat-projection.js';

const messages = [
  { role: 'user', content: [{ type: 'text', text: 'Question' }, { type: 'image', data: 'image', mimeType: 'image/png' }] },
  { role: 'assistant', responseId: 'r1', timestamp: 123, provider: 'test', model: 'test', usage: { totalTokens: 42 }, stopReason: 'stop', content: [
    { type: 'thinking', thinking: 'PRIVATE THINKING', thinkingSignature: 'SIGNATURE' },
    { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'PRIVATE ARGS' } },
    { type: 'text', text: 'Answer', textSignature: 'SIGNATURE' },
  ] },
  { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'PRIVATE RESULT' }] },
  { role: 'assistant', stopReason: 'error', errorMessage: 'Provider failed', content: [] },
];

describe('lightweight chat projection', () => {
  it('omits thinking, tool messages and signatures without mutating the session', () => {
    const result = projectChatMessages(messages, false);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toMatchObject({ responseId: 'r1', usage: { totalTokens: 42 }, content: [{ type: 'text', text: 'Answer' }] });
    expect(result[2]).toMatchObject({ stopReason: 'error', errorMessage: 'Provider failed' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SIGNATURE/);
    expect(messages[1].content).toHaveLength(3);
    expect(projectChatMessages(messages, true)).toBe(messages);
  });

  it('filters every payload-bearing lifecycle event, not just token updates', () => {
    const assistant = messages[1];
    for (const event of [
      { type: 'message_start', message: assistant },
      { type: 'message_end', message: assistant },
      { type: 'agent_end', messages },
      { type: 'turn_end', message: assistant, toolResults: [messages[2]] },
      { type: 'auto_compaction_end', result: { summary: 'PRIVATE RESULT' } },
    ]) {
      expect(JSON.stringify(projectChatEvent(event, false))).not.toMatch(/PRIVATE|SIGNATURE/);
      expect(projectChatEvent(event, true)).toBe(event);
    }
  });

  it.each(['thinking_delta', 'toolcall_delta', 'thinking_start', 'toolcall_end'])('drops %s completely', (type) => {
    expect(projectChatEvent({ type: 'message_update', assistantMessageEvent: { type, delta: 'PRIVATE' } }, false)).toBeNull();
  });

  it('retains text deltas, tool status, failures, and completion signals', () => {
    expect(projectChatEvent({ type: 'message_update', message: messages[1], assistantMessageEvent: { type: 'text_delta', delta: 'Answer', contentIndex: 2, partial: messages[1] } }, false))
      .toMatchObject({ assistantMessageEvent: { type: 'text_delta', delta: 'Answer' } });
    expect(projectChatEvent({ type: 'tool_execution_update', partialResult: 'PRIVATE' }, false)).toBeNull();
    expect(projectChatEvent({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'propose_plan', result: 'PRIVATE', isError: true }, false))
      .toEqual({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'propose_plan', isError: true });
    expect(projectChatEvent({ type: 'message_end', message: messages[3] }, false)).toMatchObject({ message: { errorMessage: 'Provider failed' } });
    expect(projectChatEvent({ type: 'agent_settled', messages }, false)).toEqual({ type: 'agent_settled' });
  });
});
