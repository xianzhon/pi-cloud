import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useChat } from './useChat';

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
    handlers.clear();
    localStorage.clear();
    send.mockReset();
    vi.restoreAllMocks();
  });

  it('does not add optimistic state when the socket cannot send', () => {
    send.mockReturnValueOnce(false);
    const { chat } = mountChat();

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

    localStorage.setItem('pi-webui.streamingMessageBehavior', 'followUp');
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
    window.addEventListener('summary-generated', summaryHandler);

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
    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_end' } });

    expect(summaryHandler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'summary-generated',
      detail: { sessionId: 'session-1', content: 'Session summary' },
    }));
    window.removeEventListener('summary-generated', summaryHandler);
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
    localStorage.setItem('pi-webui.streamingMessageBehavior', 'followUp');
    const { chat } = mountChat();

    handlers.get('event')?.({ event: { type: 'agent_start' } });
    chat.sendMessage('new instruction');

    expect(send).toHaveBeenCalledWith({
      type: 'followUp',
      payload: { text: 'new instruction', sessionId: undefined },
    });
  });

  it('asks the app to mark a session ready when the agent finishes', () => {
    const { chat } = mountChat();
    chat.sessionId.value = 'session-1';
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');

    handlers.get('event')?.({ sessionId: 'session-1', event: { type: 'agent_end' } });

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-streaming-state',
      detail: { id: 'session-1', isStreaming: false, completed: true },
    }));
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

    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions/session-1?clientId=client-1');
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
