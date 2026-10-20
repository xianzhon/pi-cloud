import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { usePreferences } from './usePreferences';
import { useChat } from './useChat';
import { i18n, setLocale } from '../i18n';

const handlers = new Map<string, (data: any) => void>();
const send = vi.fn<(message: { type: string; payload: any }) => boolean>(() => true);

vi.mock('./useWebSocket', () => ({
  useWebSocket: () => ({
    send,
    clientId: 'client-1',
    on: (type: string, handler: (data: any) => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  }),
}));

function mountChat() {
  let chat: ReturnType<typeof useChat> | undefined;
  const wrapper = mount(defineComponent({
    setup() {
      chat = useChat();
      return () => null;
    },
  }));

  if (!chat) throw new Error('useChat did not initialize');
  return { chat, wrapper };
}

describe('useChat', () => {
  afterEach(() => {
    setLocale('en');
    handlers.clear();
    localStorage.clear();
    send.mockReset();
    vi.restoreAllMocks();
  });

  it('renders compact text, thinking, and interleaved tool argument deltas', () => {
    const { chat, wrapper } = mountChat();
    chat.setViewedSession('session-1');
    const emit = (event: any) => handlers.get('event')?.({ sessionId: 'session-1', event });
    emit({ type: 'message_start', message: { role: 'assistant', responseId: 'r1', timestamp: 123 } });
    for (const [type, delta] of [['thinking_delta', 'Thinking'], ['text_delta', 'Hello'], ['text_delta', ' world']]) {
      emit({ type: 'message_update', assistantMessageEvent: { type, delta } });
    }
    for (const [toolCallId, inputDelta] of [['a', '{"path":'], ['b', '{"other":1}'], ['a', '"file"}']]) {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', toolCallId, toolName: 'read', inputDelta } });
    }
    expect(chat.messages.value.find((message) => message.id === 'r1')).toMatchObject({ content: 'Hello world', thinking: 'Thinking' });
    expect(chat.messages.value.find((message) => message.toolCallId === 'a')).toMatchObject({ toolInput: '{"path":"file"}' });
    expect(chat.messages.value.find((message) => message.toolCallId === 'b')).toMatchObject({ toolInput: '{"other":1}' });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', toolCallId: 'a', toolName: 'read', args: { path: 'file' } } });
    expect(chat.messages.value.find((message) => message.toolCallId === 'a')?.toolInput).toBe(JSON.stringify({ path: 'file' }, null, 2));
    emit({ type: 'message_end', message: { role: 'assistant', responseId: 'r1', provider: 'test', model: 'model', usage: { totalTokens: 10 } } });
    expect(chat.messages.value.find((message) => message.id === 'r1')).toMatchObject({ provider: 'test', model: 'model', usage: { totalTokens: 10 } });
    wrapper.unmount();
  });

  it('defaults to lightweight delivery and fetches details only when requested', async () => {
    const { chat, wrapper } = mountChat();
    const fetchSpy = vi.fn(async (_url: string) => ({ json: async () => ({ messages: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    await chat.loadSessionHistory('session-1');
    expect(send).toHaveBeenCalledWith({ type: 'set_details', payload: { includeDetails: false } });
    usePreferences().setShowDetails(true);
    await nextTick();
    expect(send).toHaveBeenCalledWith({ type: 'set_details', payload: { includeDetails: true } });
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toContain('includeDetails=true');
    await nextTick();
    handlers.get('connected')?.({});
    expect(send).toHaveBeenCalledWith({ type: 'set_details', payload: { includeDetails: true } });
    wrapper.unmount();
  });

  it('defers earlier detail hydration during streaming without losing live text', async () => {
    const { chat, wrapper } = mountChat();
    chat.setViewedSession('session-1');
    const fetchSpy = vi.fn(async (_url: string) => ({ json: async () => ({ messages: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_start' } });
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Still streaming' } } });
    usePreferences().setShowDetails(true);
    await nextTick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(chat.messages.value[0].content).toBe('Still streaming');
    handlers.get('status')?.({ sessionId: 'session-1', status: 'idle' });
    await nextTick();
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toContain('includeDetails=true');
    wrapper.unmount();
  });

  it('recognizes a response whose hidden thinking was omitted instead of showing a false failure', () => {
    const { chat, wrapper } = mountChat();
    handlers.get('event')?.({ event: { type: 'message_end', hasContent: true, message: { role: 'assistant', stopReason: 'stop' } } });
    handlers.get('event')?.({ event: { type: 'agent_settled' } });
    expect(chat.messages.value).toEqual([]);
    wrapper.unmount();
  });

  it('discards a detail history response after Details is disabled', async () => {
    const { chat, wrapper } = mountChat();
    chat.setViewedSession('session-1');
    let resolve!: (value: any) => void;
    const fetchSpy = vi.fn((url: string) => url.includes('includeDetails=true')
      ? new Promise((done) => { resolve = done; })
      : Promise.resolve({ json: async () => ({ messages: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    usePreferences().setShowDetails(true);
    await nextTick();
    usePreferences().setShowDetails(false);
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/sessions/session-1?clientId=client-1', { signal: expect.any(AbortSignal) });
    resolve({ json: async () => ({ messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'Stale detail' }] }] }) });
    await nextTick();
    await nextTick();
    expect(chat.messages.value).toEqual([]);
    wrapper.unmount();
  });

  it('does not overwrite a new live response when an idle detail download finishes', async () => {
    const { chat, wrapper } = mountChat();
    chat.setViewedSession('session-1');
    let resolve!: (value: any) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done; })));
    usePreferences().setShowDetails(true);
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_start' } });
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'New response' } } });
    resolve({ json: async () => ({ messages: [], isStreaming: false }) });
    await nextTick();
    await nextTick();
    expect(chat.isStreaming.value).toBe(true);
    expect(chat.messages.value[0].content).toBe('New response');
    wrapper.unmount();
  });

  it.each(['prompt', 'awaited prompt', 'agent_start', 'streaming_state'])('preserves a completed answer when idle detail history arrives late (%s)', async (start) => {
    const { chat, wrapper } = mountChat();
    chat.setViewedSession('session-1');
    send.mockReturnValue(true);
    const responses: Array<(value: any) => void> = [];
    const fetchSpy = vi.fn(() => new Promise((resolve) => { responses.push(resolve); }));
    vi.stubGlobal('fetch', fetchSpy);
    usePreferences().setShowDetails(true);
    const resolveStale = responses[0];

    if (start === 'prompt' || start === 'awaited prompt') {
      void chat.sendMessage('New question', 'session-1', { awaitAcceptance: start === 'awaited prompt' });
    } else if (start === 'agent_start') {
      handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_start' } });
    } else {
      handlers.get('streaming_state')?.({ sessionId: 'session-1', isStreaming: true });
    }
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Completed answer' } } });
    handlers.get('status')?.({ sessionId: 'session-1', status: 'idle' });
    resolveStale({ json: async () => ({ messages: [], isStreaming: false }) });
    await nextTick();
    await nextTick();

    expect(chat.isStreaming.value).toBe(false);
    expect(chat.messages.value.some((message) => message.content === 'Completed answer')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    responses[1]({ json: async () => ({ messages: [{ role: 'assistant', content: 'Completed answer' }], isStreaming: false }) });
    await nextTick();
    await nextTick();
    expect(chat.messages.value.map((message) => message.content)).toEqual(['Completed answer']);
    wrapper.unmount();
  });

  it('does not resubscribe to a stale session after switching', async () => {
    const { chat, wrapper } = mountChat();
    let resolveA!: (value: any) => void;
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/A?')
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve({ json: async () => ({ messages: [] }) })));
    const pendingA = chat.loadSessionHistory('A');
    await chat.loadSessionHistory('B');
    send.mockClear();
    resolveA({ json: async () => ({ messages: [] }) });
    await pendingA;
    expect(chat.sessionId.value).toBe('B');
    expect(send).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('localizes model failure cards on language changes without translating provider diagnostics', () => {
    const { chat, wrapper } = mountChat();
    handlers.get('event')?.({ event: { type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Provider diagnostic' } } });
    expect(chat.messages.value[0].title).toBe('Model response failed');
    setLocale('zh-CN');
    expect(chat.messages.value[0].title).toBe(i18n.global.t('modelResponse.failed'));
    expect(chat.messages.value[0].content).toBe('Provider diagnostic');
    wrapper.unmount();
  });

  it('does not add optimistic state when the socket cannot send', () => {
    const { chat } = mountChat();
    send.mockReturnValueOnce(false);

    expect(chat.sendMessage('hello pi', 'session-1')).toBe(false);
    expect(chat.messages.value).toEqual([]);
    expect(chat.isStreaming.value).toBe(false);
  });

  it('includes images in an awaited prompt and its optimistic user message', async () => {
    const { chat } = mountChat();
    chat.setViewedSession('session-1');
    const images = [{ type: 'image' as const, data: 'cG5n', mimeType: 'image/png', name: 'diagram.png', size: 3 }];

    const accepted = chat.sendMessage('', 'session-1', { images, awaitAcceptance: true });
    const payload = send.mock.calls.at(-1)?.[0].payload;

    expect(payload).toEqual(expect.objectContaining({
      text: '',
      sessionId: 'session-1',
      images: [{ type: 'image', data: 'cG5n', mimeType: 'image/png', name: 'diagram.png' }],
    }));
    expect(chat.messages.value).toEqual([expect.objectContaining({ role: 'user', content: '', images })]);

    handlers.get('prompt_preflight')?.({
      requestId: payload.requestId,
      accepted: true,
      imagePaths: ['/project/tmp/upload_images/diagram.png'],
    });
    await expect(accepted).resolves.toBe(true);
    expect(chat.messages.value[0].images?.[0].path).toBe('/project/tmp/upload_images/diagram.png');
  });

  it('includes images in steer and follow-up payloads', () => {
    const image = { type: 'image' as const, data: 'cG5n', mimeType: 'image/png' };
    const { chat } = mountChat();

    handlers.get('event')?.({ event: { type: 'agent_start' } });
    chat.sendMessage('steer with image', undefined, { images: [image] });
    expect(send).toHaveBeenLastCalledWith({
      type: 'steer',
      payload: { text: 'steer with image', sessionId: undefined, images: [image] },
    });

    localStorage.setItem('pi-cloud.streamingMessageBehavior', 'followUp');
    const second = mountChat().chat;
    handlers.get('event')?.({ event: { type: 'agent_start' } });
    second.sendMessage('follow up with image', undefined, { images: [image] });
    expect(send).toHaveBeenLastCalledWith({
      type: 'followUp',
      payload: { text: 'follow up with image', sessionId: undefined, images: [image] },
    });
  });

  it('restores image blocks with adjacent text as one user message', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        messages: [{
          id: 'user-image',
          role: 'user',
          timestamp: 2000,
          content: [
            {
              type: 'text',
              text: 'What is this?\n\n[Uploaded image files]\n- /project/tmp/upload_images/chart.png\nThese are local files in the project. Use these paths if the user asks you to inspect, edit, or annotate an uploaded image.',
            },
            { type: 'image', data: 'cG5n', mimeType: 'image/png' },
          ],
        }],
      }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value).toEqual([expect.objectContaining({
      role: 'user',
      content: 'What is this?',
      images: [{
        type: 'image',
        data: 'cG5n',
        mimeType: 'image/png',
        name: 'chart.png',
        path: '/project/tmp/upload_images/chart.png',
      }],
    })]);
  });

  it('derives historical agent time only when the turn has timestamps', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ messages: [
        { role: 'user', content: 'First', timestamp: 1000 },
        { role: 'assistant', content: [{ type: 'text', text: 'Working' }], timestamp: 3000 },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }], timestamp: 4500 },
        { role: 'user', content: 'Again' },
        { role: 'assistant', content: 'No time', timestamp: 8000 },
      ] }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value[1].durationMs).toBeUndefined();
    expect(chat.messages.value[2].durationMs).toBe(3500);
    expect(chat.messages.value[3].timestamp).toBeUndefined();
    expect(chat.messages.value[4].durationMs).toBeUndefined();
  });

  it('restores the server streaming start time and subscribes for cross-device updates', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ messages: [], isStreaming: true, streamingStartedAt: 12_345 }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.isStreaming.value).toBe(true);
    expect(chat.streamingStartedAt.value).toBe(12_345);
    expect(send).toHaveBeenCalledWith({ type: 'watch', payload: { sessionId: 'session-1' } });
  });

  it('marks the agent as streaming immediately after sending a prompt', () => {
    const { chat } = mountChat();

    expect(chat.sendMessage('hello pi')).toBe(true);

    expect(chat.isStreaming.value).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: 'prompt',
      payload: { text: 'hello pi', sessionId: undefined },
    });
  });

  it('can display a slash command while sending a generated prompt and emitting summary content on completion', () => {
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';
    const summaryHandler = vi.fn();
    const speechHandler = vi.fn();
    window.addEventListener('summary-generated', summaryHandler);
    window.addEventListener('assistant-response-completed', speechHandler);

    chat.sendMessage('summarize the session', 'session-1', {
      displayText: '/summary',
      copySummaryOnComplete: true,
    });

    expect(chat.messages.value[0]).toEqual(expect.objectContaining({ role: 'user', content: '/summary' }));
    expect(send).toHaveBeenCalledWith({
      type: 'prompt',
      payload: { text: 'summarize the session', sessionId: 'session-1' },
    });

    handlers.get('event')?.({
      sessionId: 'session-1',
      event: {
        type: 'message_start',
        role: 'assistant',
        message: { responseId: 'assistant-1' },
      },
    });
    handlers.get('event')?.({
      sessionId: 'session-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Session summary' },
      },
    });
    expect(speechHandler).not.toHaveBeenCalled();
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_settled' } });

    expect(chat.messages.value.find((message) => message.id === 'assistant-1')?.durationMs).toBeGreaterThanOrEqual(0);
    expect(summaryHandler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'summary-generated',
      detail: { sessionId: 'session-1', content: 'Session summary' },
    }));
    expect(speechHandler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'assistant-response-completed',
      detail: { sessionId: 'session-1', messageId: 'assistant-1', content: 'Session summary' },
    }));
    window.removeEventListener('summary-generated', summaryHandler);
    window.removeEventListener('assistant-response-completed', speechHandler);
  });

  it('sends steering messages while the agent is streaming by default', () => {
    const { chat } = mountChat();

    handlers.get('event')?.({ event: { type: 'agent_start' } });
    chat.sendMessage('new instruction');

    expect(chat.messages.value).toEqual([
      expect.objectContaining({ role: 'user', content: 'new instruction' }),
    ]);
    expect(send).toHaveBeenCalledWith({
      type: 'steer',
      payload: { text: 'new instruction', sessionId: undefined },
    });
  });

  it('sends follow-up messages while streaming when configured', () => {
    localStorage.setItem('pi-cloud.streamingMessageBehavior', 'followUp');
    const { chat } = mountChat();

    handlers.get('event')?.({ event: { type: 'agent_start' } });
    chat.sendMessage('new instruction');

    expect(send).toHaveBeenCalledWith({
      type: 'followUp',
      payload: { text: 'new instruction', sessionId: undefined },
    });
  });

  it('waits for the agent to settle before marking the session complete', () => {
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';
    chat.sendMessage('hello', 'session-1');
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_end', willRetry: true } });
    expect(chat.isStreaming.value).toBe(true);

    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_settled' } });

    expect(chat.isStreaming.value).toBe(false);
    expect(chat.messages.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'The model completed without returning a response.', status: 'failure' }),
    ]));
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-streaming-state',
      detail: { id: 'session-1', isStreaming: false, completed: true },
    }));
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh-git-status' }));
  });

  it('shows retry progress and removes the transient error after recovery', () => {
    const { chat } = mountChat();
    chat.setViewedSession('session-1');
    chat.sendMessage('hello', 'session-1');

    handlers.get('event')?.({
      sessionId: 'session-1',
      event: { type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '503 model busy' } },
    });
    handlers.get('event')?.({
      sessionId: 'session-1',
      event: { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, errorMessage: '503 model busy' },
    });

    expect(chat.messages.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: '503 model busy', title: 'Model unavailable - retrying (1/3)', status: 'pending' }),
    ]));

    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'auto_retry_end', success: true, attempt: 1 } });
    expect(chat.messages.value).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ content: '503 model busy' }),
    ]));
  });

  it('shows WebSocket model errors in the conversation', () => {
    const { chat } = mountChat();
    chat.setViewedSession('session-1');
    chat.sendMessage('hello', 'session-1');

    handlers.get('error')?.({ sessionId: 'session-1', message: 'Model service unavailable' });

    expect(chat.isStreaming.value).toBe(false);
    expect(chat.messages.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Model service unavailable', title: 'Model response failed', status: 'failure' }),
    ]));
  });

  it('announces successful plan proposals for authoritative report reload', () => {
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    handlers.get('event')?.({
      sessionId: 'session-1',
      event: {
        type: 'tool_execution_end',
        toolCallId: 'proposal-1',
        toolName: 'propose_plan',
        result: { content: [{ type: 'text', text: 'Proposal submitted' }] },
        isError: false,
      },
    });

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plan-report-updated',
      detail: { sessionId: 'session-1' },
    }));
  });

  it('resolves an awaited prompt after server preflight acceptance', async () => {
    send.mockReturnValue(true);
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';

    const accepted = chat.sendMessage('implement plan', 'session-1', {
      awaitAcceptance: true,
      acceptanceTimeoutMs: 1_000,
    });
    const sent = send.mock.calls.at(-1)![0];
    expect(sent.payload.requestId).toEqual(expect.any(String));

    handlers.get('prompt_preflight')?.({
      requestId: sent.payload.requestId,
      sessionId: 'session-1',
      accepted: true,
    });

    await expect(accepted).resolves.toBe(true);
    expect(chat.messages.value).toEqual([
      expect.objectContaining({ role: 'user', content: 'implement plan' }),
    ]);
  });

  it('rolls back an awaited prompt rejected before acceptance', async () => {
    send.mockReturnValue(true);
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';

    const onRejected = vi.fn();
    const accepted = chat.sendMessage('implement plan', 'session-1', {
      awaitAcceptance: true,
      acceptanceTimeoutMs: 1_000,
      onRejected,
    });
    const requestId = send.mock.calls.at(-1)?.[0].payload.requestId;
    handlers.get('prompt_preflight')?.({ requestId, sessionId: 'session-1', accepted: false, message: 'Model changed.' });

    await expect(accepted).resolves.toBe(false);
    expect(onRejected).toHaveBeenCalledWith('Model changed.');
    expect(chat.messages.value).toEqual([]);
    expect(chat.isStreaming.value).toBe(false);
  });

  it('rolls back an awaited prompt when the socket cannot send it', async () => {
    send.mockReturnValue(false);
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';

    await expect(chat.sendMessage('implement plan', 'session-1', { awaitAcceptance: true })).resolves.toBe(false);
    expect(chat.messages.value).toEqual([]);
    expect(chat.isStreaming.value).toBe(false);
  });

  it('asks the session sidebar to refresh when the agent returns to idle', () => {
    mountChat();
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    handlers.get('status')?.({ status: 'idle' });

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh-sessions' }));
  });

  it('does not show an empty assistant placeholder before streamed content arrives', () => {
    const { chat } = mountChat();

    handlers.get('event')?.({
      event: {
        type: 'message_start',
        role: 'assistant',
        message: { responseId: 'assistant-1', timestamp: 1000 },
      },
    });

    expect(chat.messages.value).toEqual([]);

    handlers.get('event')?.({
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      },
    });

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Hello',
      }),
    ]);
  });

  it('attaches memory recall details to the streamed assistant response', () => {
    const { chat } = mountChat();
    chat.setViewedSession('session-1');

    handlers.get('memory_recall')?.({
      sessionId: 'session-1',
      injected: true,
      tokenCount: 42,
      diagnostics: {
        candidateIds: ['memory-1', 'memory-2'],
        rejectedBelowThresholdIds: [],
        redundancyRejectedIds: [],
        selected: [{ id: 'memory-1', score: 1.2, components: { exactEntity: 0.55 } }],
        budgetCeiling: 800,
        usedTokens: 42,
        overflow: false,
        countingMethod: 'local-unicode-v1',
        rankingPolicyVersion: 'adaptive-lexical-v1',
        promptFormatVersion: 'memory-prompt-v2',
      },
      memories: [
        { id: 'memory-1', scope: 'project', category: 'fact', content: 'Keyboard menus clamp at visible bounds', reason: 'query-match' },
        { id: 'memory-2', scope: 'global', category: 'rule', content: 'Keep changes surgical', reason: 'pinned' },
      ],
    });
    handlers.get('event')?.({
      sessionId: 'session-1',
      event: { type: 'message_start', role: 'assistant', message: { responseId: 'assistant-1' } },
    });
    handlers.get('event')?.({
      sessionId: 'session-1',
      event: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Done' } },
    });

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        memory: expect.objectContaining({
          injected: true,
          tokenCount: 42,
          diagnostics: expect.objectContaining({
            budgetCeiling: 800,
            rankingPolicyVersion: 'adaptive-lexical-v1',
          }),
          memories: [
            expect.objectContaining({ id: 'memory-1', reason: 'query-match' }),
            expect.objectContaining({ id: 'memory-2', reason: 'pinned' }),
          ],
        }),
      }),
    ]);
  });

  it('stores token usage and model metadata from completed assistant responses', () => {
    const { chat } = mountChat();

    handlers.get('event')?.({
      event: {
        type: 'message_start',
        role: 'assistant',
        message: { responseId: 'assistant-1', timestamp: 1000 },
      },
    });
    handlers.get('event')?.({
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      },
    });
    handlers.get('event')?.({
      event: {
        type: 'message_end',
        message: {
          role: 'assistant',
          responseId: 'assistant-1',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          usage: {
            input: 1200,
            output: 345,
            cacheRead: 50,
            cacheWrite: 5,
            cost: { total: 0.0123 },
          },
        },
      },
    });

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Hello',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        usage: expect.objectContaining({ input: 1200, output: 345, cacheRead: 50, cacheWrite: 5 }),
      }),
    ]);
  });

  it('reconciles a stale stream from session history after a WebSocket disconnect', async () => {
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';
    chat.sendMessage('hello pi', 'session-1');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        isStreaming: false,
        messages: [{
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Completed while disconnected.' }],
        }],
      }),
    })));

    handlers.get('disconnected')?.(undefined);

    await vi.waitFor(() => {
      expect(chat.isStreaming.value).toBe(false);
    });
    expect(chat.messages.value).toEqual([
      expect.objectContaining({ role: 'assistant', content: 'Completed while disconnected.' }),
    ]);
  });

  it('switches the viewed session before history finishes loading', async () => {
    const { chat } = mountChat();
    chat.addLocalMessage({ role: 'user', content: 'old message' }, 'session-1');
    chat.setViewedSession('session-1');
    let resolveFetch: (value: { json: () => Promise<{ messages: never[] }> }) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve;
    })));

    const loading = chat.loadSessionHistory('session-2');

    expect(chat.messages.value).toEqual([]);
    resolveFetch({ json: async () => ({ messages: [] }) });
    await loading;
    expect(chat.messages.value).toEqual([]);
  });

  it('includes clientId when loading session history', async () => {
    const { chat } = mountChat();
    const fetchSpy = vi.fn(async () => ({
      json: async () => ({ messages: [] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await chat.loadSessionHistory('session-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/session-1?clientId=client-1', { signal: expect.any(AbortSignal) });
  });

  it('appends stored builtin command activity when loading history', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        messages: [],
        activity: [
          { id: 1, kind: 'commit_created', data: { commit: 'abcdef1234567890', message: 'Add feature' }, createdAt: '2026-07-22T00:00:00.000Z' },
          { id: 2, kind: 'pr_created', data: { number: 17, url: 'https://git.example.com/owner/repo/pulls/17', title: 'Add feature', sourceBranch: 'feature/app', targetBranch: 'main', commit: 'abcdef1234567890' }, createdAt: '2026-07-22T00:00:01.000Z' },
          { id: 3, kind: 'branch_deleted', data: { branch: 'feature/app', commit: '1234567890abcdef' }, createdAt: '2026-07-22T00:00:02.000Z' },
        ],
      }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        role: 'assistant',
        kind: 'status',
        title: 'Session activity',
        content: expect.stringContaining('PR #17: Add feature'),
      }),
    ]);
    expect(chat.messages.value[0].content).toContain('Commit `abcdef123456`');
    expect(chat.messages.value[0].content).toContain('https://git.example.com/owner/repo/pulls/17');
    expect(chat.messages.value[0].content).toContain('Branch `feature/app` deleted; last commit: `1234567890abcdef`');
  });

  it('preserves token usage and model metadata when loading assistant history', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        messages: [
          {
            id: 'assistant-history-1',
            role: 'assistant',
            timestamp: 2000,
            provider: 'openai',
            model: 'gpt-4.1',
            usage: { input: 2000, output: 500, cacheRead: 0, cacheWrite: 0 },
            content: [{ type: 'text', text: 'Historical answer' }],
          },
        ],
      }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        role: 'assistant',
        content: 'Historical answer',
        provider: 'openai',
        model: 'gpt-4.1',
        usage: expect.objectContaining({ input: 2000, output: 500 }),
      }),
    ]);
  });

  it('preserves separate thinking blocks when loading completed history', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        messages: [
          {
            id: 'assistant-history-thinking-1',
            role: 'assistant',
            timestamp: 2000,
            content: [
              { type: 'thinking', thinking: 'First thought' },
              { id: 'tool-call-1', type: 'toolCall', name: 'bash', arguments: { command: 'first' } },
            ],
          },
          {
            id: 'tool-result-1',
            role: 'toolResult',
            toolCallId: 'tool-call-1',
            toolName: 'bash',
            content: [{ type: 'text', text: 'first result' }],
          },
          {
            id: 'assistant-history-thinking-2',
            role: 'assistant',
            timestamp: 2001,
            content: [
              { type: 'thinking', thinking: 'Second thought' },
              { type: 'text', text: 'Historical answer' },
            ],
          },
          {
            id: 'assistant-history-thinking-3',
            role: 'assistant',
            timestamp: 2002,
            content: [{ type: 'thinking', thinking: 'Later thought' }],
          },
        ],
      }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value).toEqual([
      expect.objectContaining({ kind: 'thinking', content: 'First thought' }),
      expect.objectContaining({ kind: 'tool_call', toolName: 'bash' }),
      expect.objectContaining({ kind: 'tool_result', toolOutput: 'first result' }),
      expect.objectContaining({ kind: 'thinking', content: 'Second thought' }),
      expect.objectContaining({ kind: 'text', content: 'Historical answer' }),
      expect.objectContaining({ kind: 'thinking', content: 'Later thought' }),
    ]);
  });

  it('attaches read tool input paths to matching history results', async () => {
    const { chat } = mountChat();
    const readPath = '/workspace/project/docs/example.md';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        messages: [
          {
            id: 'assistant-history-tool',
            role: 'assistant',
            timestamp: 2000,
            content: [
              {
                id: 'tool-call-1',
                type: 'toolCall',
                name: 'read',
                arguments: { path: readPath },
              },
            ],
          },
          {
            id: 'tool-result-1',
            role: 'toolResult',
            toolCallId: 'tool-call-1',
            content: [{ type: 'text', text: '# Verification Before Completion\n' }],
          },
        ],
      }),
    })));

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        kind: 'tool_call',
        toolName: 'read',
        toolInput: expect.stringContaining(readPath),
      }),
      expect.objectContaining({
        kind: 'tool_result',
        toolName: 'read',
        toolInput: expect.stringContaining(readPath),
        toolOutput: '# Verification Before Completion\n',
      }),
    ]);
  });

  it('attaches read tool input paths to matching live results', () => {
    const { chat } = mountChat();
    const readPath = '/workspace/project/docs/example.md';

    handlers.get('event')?.({
      event: {
        type: 'tool_execution_start',
        toolCallId: 'read-1',
        toolName: 'read',
        input: { path: readPath },
      },
    });
    handlers.get('event')?.({
      event: {
        type: 'tool_execution_end',
        toolCallId: 'read-1',
        result: { content: [{ type: 'text', text: '# Verification Before Completion\n' }] },
      },
    });

    expect(chat.messages.value).toEqual([
      expect.objectContaining({
        kind: 'tool_call',
        toolName: 'read',
        toolInput: expect.stringContaining(readPath),
      }),
      expect.objectContaining({
        kind: 'tool_result',
        toolName: 'read',
        toolInput: expect.stringContaining(readPath),
      }),
    ]);
  });

  it('routes interleaved streaming events to the matching session', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ messages: [] }),
    })));

    await chat.loadSessionHistory('session-1');
    chat.sendMessage('prompt one', 'session-1');

    await chat.loadSessionHistory('session-2');
    chat.sendMessage('prompt two', 'session-2');

    handlers.get('event')?.({
      sessionId: 'session-1',
      event: {
        type: 'message_start',
        role: 'assistant',
        message: { responseId: 'assistant-1', timestamp: 1000 },
      },
    });
    handlers.get('event')?.({
      sessionId: 'session-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'answer one' },
      },
    });

    expect(chat.messages.value).toEqual([
      expect.objectContaining({ role: 'user', content: 'prompt two' }),
    ]);

    await chat.loadSessionHistory('session-1');

    expect(chat.messages.value).toEqual([
      expect.objectContaining({ role: 'user', content: 'prompt one' }),
      expect.objectContaining({ role: 'assistant', content: 'answer one' }),
    ]);
  });

  it('sends steering messages to the visible streaming session', async () => {
    const { chat } = mountChat();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ messages: [] }),
    })));

    await chat.loadSessionHistory('session-1');
    chat.sendMessage('prompt one', 'session-1');
    await chat.loadSessionHistory('session-2');
    chat.sendMessage('prompt two', 'session-2');

    await chat.loadSessionHistory('session-1');
    chat.steer('adjust session one');

    expect(send).toHaveBeenLastCalledWith({
      type: 'steer',
      payload: { text: 'adjust session one', sessionId: 'session-1' },
    });
  });
});
