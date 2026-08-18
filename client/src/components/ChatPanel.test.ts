import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ChatPanel from './ChatPanel.vue';

enableAutoUnmount(afterEach);

type TestChatMessage = {
  id: string;
  role: string;
  content: string;
  thinking?: string;
  kind?: string;
  status?: string;
  title?: string;
  toolName?: string;
  timestamp?: number;
  hasTextContent?: boolean;
  images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string; path?: string }>;
};

const chatMessages = ref<TestChatMessage[]>([]);
const chatIsStreaming = ref(false);
const addLocalMessage = vi.fn((message) => {
  const localMessage = { ...message, id: `local-${chatMessages.value.length}`, timestamp: Date.now() };
  chatMessages.value.push(localMessage);
  return localMessage;
});
const sendMessage = vi.fn<(text: string, sessionId?: string, options?: any) => boolean | Promise<boolean>>(() => true);
const abort = vi.fn();
const loadSessionHistory = vi.fn();
const toggleThinking = vi.fn();
const clearMessages = vi.fn();
vi.mock('../composables/useChat', () => ({
  useChat: () => ({
    messages: chatMessages,
    isStreaming: chatIsStreaming,
    hideThinkingBlock: ref(false),
    addLocalMessage,
    sendMessage,
    abort,
    toggleThinking,
    loadSessionHistory,
    clearMessages,
  }),
}));

vi.mock('./MessageBubble.vue', () => ({
  default: {
    template: '<div class="message-bubble-stub">{{ message.content }}<button v-if="message.images?.[0]?.path" class="annotate-stub" @click="$emit(\'annotate\', message.images[0])">Annotate</button></div>',
    props: ['message', 'hideThinkingBlock'],
    emits: ['annotate'],
  },
}));

vi.mock('./SlashCommandMenu.vue', () => ({
  default: {
    props: ['commands', 'activeIndex'],
    emits: ['select'],
    template: '<div class="slash-menu"><button v-for="command in commands" :key="command.id" @click="$emit(\'select\', command)">{{ command.label }}</button></div>',
  },
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    chatMessages.value = [];
    chatIsStreaming.value = false;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    localStorage.clear();
    sessionStorage.removeItem('pi-webui-message-input-height');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the profile default provider and model before a session exists', () => {
    const wrapper = mount(ChatPanel, { props: { modelInfo: 'openai / gpt-5.4' } });

    expect(wrapper.find('.composer-model-selector').text()).toBe('openai / gpt-5.4');
  });

  it('clears the input divider highlight when pointer capture is lost or the window blurs', async () => {
    const wrapper = mount(ChatPanel);
    const handle = wrapper.find('.input-resize-handle');
    Object.defineProperties(handle.element, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    });

    await handle.trigger('pointerdown', { clientY: 200, pointerId: 1 });
    expect(handle.classes()).toContain('is-resizing');

    await handle.trigger('lostpointercapture', { pointerId: 1 });
    expect(handle.classes()).not.toContain('is-resizing');

    await handle.trigger('pointerdown', { clientY: 200, pointerId: 2 });
    window.dispatchEvent(new Event('blur'));
    await wrapper.vm.$nextTick();
    expect(handle.classes()).not.toContain('is-resizing');
  });

  it('does not start deferred requests after unmount', () => {
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 1;
    }));
    const fetchMock = vi.mocked(fetch);
    const wrapper = mount(ChatPanel, { props: { sessionId: 'session-1', clientId: 'client-1' } });

    wrapper.unmount();
    idleCallback?.({ didTimeout: false, timeRemaining: () => 50 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens new-session configuration from draft model and skill controls', async () => {
    const configureNewSession = vi.fn();
    const wrapper = mount(ChatPanel, { props: { configureNewSession } });

    expect(wrapper.find('.composer-model-selector').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('.composer-skill-selector').attributes('disabled')).toBeUndefined();

    await wrapper.find('.composer-model-selector').trigger('click');
    await wrapper.find('.composer-skill-selector').trigger('click');

    expect(configureNewSession).toHaveBeenCalledTimes(2);
  });

  it('attaches valid picker images, rejects invalid files, and sends an image-only message after acceptance', async () => {
    sendMessage.mockResolvedValueOnce(true);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).includes('/status')
        ? { model: { provider: 'test', id: 'vision', input: ['text', 'image'] } }
        : {},
    ), { status: 200 })));
    const wrapper = mount(ChatPanel, { props: { sessionId: 'session-1', clientId: 'client-1' } });
    await vi.waitFor(() => expect((wrapper.vm as any).sessionStatus?.model?.input).toContain('image'));
    const input = wrapper.find('input[type="file"]');
    const png = new File([new Uint8Array([1, 2, 3])], 'diagram.png', { type: 'image/png' });
    const svg = new File(['<svg/>'], 'diagram.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input.element, 'files', { configurable: true, value: [png, svg] });

    await input.trigger('change');
    await vi.waitFor(() => expect(wrapper.findAll('.attachment-item')).toHaveLength(1));

    expect(wrapper.text()).toContain('diagram.png');
    expect(wrapper.text()).toContain('diagram.svg isn’t supported');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith('', 'session-1', expect.objectContaining({
      awaitAcceptance: true,
      images: [expect.objectContaining({ type: 'image', mimeType: 'image/png', name: 'diagram.png', size: 3 })],
    }));
    expect(wrapper.findAll('.attachment-item')).toHaveLength(0);
  });

  it('fills the composer with a project-relative annotation prompt without sending it', async () => {
    chatMessages.value = [{
      id: 'image-message',
      role: 'user',
      content: 'Review this chart',
      images: [{
        type: 'image',
        data: 'cG5n',
        mimeType: 'image/png',
        name: 'chart.png',
        path: '/project/tmp/upload_images/chart.png',
      }],
    }];
    const wrapper = mount(ChatPanel, {
      attachTo: document.body,
      props: { sessionId: 'session-1', clientId: 'client-1' },
    });

    await wrapper.find('.annotate-stub').trigger('click');
    await flushPromises();

    expect(wrapper.find('textarea').element.value).toBe(
      'Annotate the image at "tmp/upload_images/chart.png", preserve the original image, save the annotated copy beside it in tmp/upload_images/ with "-annotated-HHMMSS" before the extension, using the server local time at annotation. After saving it, show the output path as inline code, not as a Markdown link, so I can open it in the editor.',
    );
    expect(document.activeElement).toBe(wrapper.find('textarea').element);
    expect(sendMessage).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('blocks attached images when model capability is unknown and opens the model selector', async () => {
    const wrapper = mount(ChatPanel, { props: { sessionId: 'session-1', clientId: 'client-1' } });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' })],
    });

    await input.trigger('change');
    await vi.waitFor(() => expect(wrapper.find('.attachment-item').exists()).toBe(true));

    expect(wrapper.find('.send-btn').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('This model can’t read images');
    await wrapper.find('.switch-model-btn').trigger('click');
    expect((wrapper.vm as any).modelSelectorOpen).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uses the attachment validation path for paste and drop and enforces the four-image limit', async () => {
    const wrapper = mount(ChatPanel);
    const textarea = wrapper.find('textarea');
    const png = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });

    await textarea.trigger('paste', { clipboardData: { files: [png('pasted.png')] } });
    await vi.waitFor(() => expect(wrapper.findAll('.attachment-item')).toHaveLength(1));
    await wrapper.find('.composer-shell').trigger('drop', { dataTransfer: { files: [png('one.png'), png('two.png'), png('three.png'), png('extra.png')] } });
    await vi.waitFor(() => expect(wrapper.findAll('.attachment-item')).toHaveLength(4));

    expect(wrapper.text()).toContain('You can attach up to 4 images.');
    await wrapper.findAll('.attachment-remove')[0].trigger('click');
    expect(wrapper.findAll('.attachment-item')).toHaveLength(3);
    expect(wrapper.find('.attachment-error').exists()).toBe(false);
  });

  it('keeps text and attachments when server preflight rejects an image message', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).includes('/status')
        ? { model: { provider: 'test', id: 'vision', input: ['text', 'image'] } }
        : {},
    ), { status: 200 })));
    sendMessage.mockImplementationOnce(async (_text, _sessionId, options) => {
      options.onRejected('The active model no longer accepts images.');
      return false;
    });
    const wrapper = mount(ChatPanel, { props: { sessionId: 'session-1', clientId: 'client-1' } });
    await vi.waitFor(() => expect((wrapper.vm as any).sessionStatus?.model?.input).toContain('image'));
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([1])], 'retry.png', { type: 'image/png' })],
    });
    await input.trigger('change');
    await vi.waitFor(() => expect(wrapper.find('.attachment-item').exists()).toBe(true));
    await wrapper.find('textarea').setValue('Please inspect this');

    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Please inspect this');
    expect(wrapper.text()).toContain('retry.png');
    expect(wrapper.text()).toContain('The active model no longer accepts images.');
  });

  it('labels image-capable models in the existing selector', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(
      String(input).includes('/models')
        ? { models: [
            { provider: 'test', id: 'vision', input: ['text', 'image'] },
            { provider: 'test', id: 'text', input: ['text'] },
          ] }
        : {},
    ), { status: 200 })));
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1', clientId: 'client-1' },
      global: { stubs: { Teleport: true } },
    });

    await (wrapper.vm as any).openModelSelector();
    await flushPromises();

    expect(wrapper.findAll('.model-capability')).toHaveLength(1);
    expect(wrapper.find('.model-capability').text()).toBe('Images');
    expect(wrapper.find('.model-capability').element.parentElement?.classList.contains('model-name-row')).toBe(true);
    expect(wrapper.find('.model-option-main').findAll(':scope > *')).toHaveLength(2);
  });

  it('restores the resized composer height after remounting', async () => {
    sessionStorage.setItem('pi-webui-message-input-height', '144');

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect((wrapper.find('#chat-input').element as HTMLTextAreaElement).style.height).toBe('144px');
    wrapper.unmount();
  });

  it('adds a file reference to the composer', async () => {
    const wrapper = mount(ChatPanel);
    await wrapper.find('textarea').setValue('Please review');

    wrapper.vm.addFileReference('src/demo.ts');
    await nextTick();

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Please review @src/demo.ts');
    wrapper.unmount();
  });

  it('submits an external prompt and clears it only after a successful send', async () => {
    const wrapper = mount(ChatPanel, { props: { sessionId: 'session-1' } });

    await expect(wrapper.vm.submitExternalPrompt('queued prompt')).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledWith('queued prompt', 'session-1');
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('preserves an external prompt when the socket cannot send', async () => {
    sendMessage.mockReturnValueOnce(false);
    const wrapper = mount(ChatPanel, { props: { sessionId: 'session-1' } });

    await expect(wrapper.vm.submitExternalPrompt('retry this prompt')).resolves.toBe(false);

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('retry this prompt');
    wrapper.unmount();
  });

  it('creates a session before sending the first message when no session is active', async () => {
    const ensureSession = vi.fn().mockResolvedValue('session-1');
    const wrapper = mount(ChatPanel, {
      props: { ensureSession },
    });

    await wrapper.find('textarea').setValue('hello pi');
    await wrapper.find('textarea').trigger('keydown.enter');
    await nextTick();

    expect(ensureSession).toHaveBeenCalledWith(undefined, 'hello pi');
    expect(sendMessage).toHaveBeenCalledWith('hello pi', 'session-1');
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  it('announces the first prompt immediately for an existing idle session', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1' },
    });

    await wrapper.find('textarea').setValue('first prompt after new');
    await wrapper.find('.send-btn').trigger('click');
    await nextTick();

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-first-message',
      detail: {
        id: 'session-1',
        firstMessage: 'first prompt after new',
      },
    }));
  });

  it('hides stop while idle', async () => {
    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.find('.stop-btn').exists()).toBe(false);
  });

  it('shows stop enabled immediately after sending the first message', async () => {
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1' },
    });

    await wrapper.find('textarea').setValue('hello pi');
    await wrapper.find('.send-btn').trigger('click');
    chatIsStreaming.value = true;
    await nextTick();

    const stopButton = wrapper.find('.stop-btn');
    expect(stopButton.exists()).toBe(true);
    expect(stopButton.attributes('disabled')).toBeUndefined();
  });

  it('renders stop above send while streaming', async () => {
    chatIsStreaming.value = true;
    const wrapper = mount(ChatPanel);
    await nextTick();

    const buttons = wrapper.findAll('.composer-actions > button');
    expect(buttons.map((button) => button.classes()[0])).toEqual(['send-btn', 'stop-btn']);
  });

  it('copies the last response messages with /copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    chatMessages.value = [
      { id: 'user-1', role: 'user', content: 'question 1' },
      { id: 'assistant-1', role: 'assistant', content: 'old answer' },
      { id: 'user-2', role: 'user', content: 'question 2' },
      { id: 'assistant-2', role: 'assistant', content: 'part one' },
      { id: 'assistant-3', role: 'assistant', content: 'part two' },
    ];
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1' },
    });

    await wrapper.find('textarea').setValue('/copy');
    await wrapper.find('.send-btn').trigger('click');
    await nextTick();

    expect(writeText).toHaveBeenCalledWith('part one\n\npart two');
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
    expect(addLocalMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      kind: 'status',
      status: 'success',
      title: 'Copied',
    }), 'session-1');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows the safe fallback message for an oversized /diff response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/git/diff')) {
        return new Response(JSON.stringify({
          cwd: '/repo',
          oversized: true,
          maxBytes: 256 * 1024,
          message: 'The Git output is too large to show safely. Inspect it with Git in the terminal or another Git client.',
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ commands: [] }), { status: 200 });
    }));
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1', projectPath: '/repo' },
    });

    await wrapper.find('textarea').setValue('/diff');
    await wrapper.find('.send-btn').trigger('click');
    await flushPromises();

    expect(chatMessages.value.at(-1)?.content).toContain('too large to show safely');
    expect(chatMessages.value.at(-1)?.content).toContain('terminal or another Git client');
    expect(chatMessages.value.at(-1)?.content).not.toContain('````diff');
    wrapper.unmount();
  });

  it('shows a local failure when /copy has no response messages', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1' },
    });

    await wrapper.find('textarea').setValue('/copy');
    await wrapper.find('.send-btn').trigger('click');
    await nextTick();

    expect(writeText).not.toHaveBeenCalled();
    expect(addLocalMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: 'No response messages to copy yet.',
      kind: 'status',
      status: 'failure',
      title: 'Copy failed',
    }), 'session-1');
  });

  it('keeps send available while streaming and uses a separate stop button', async () => {
    chatIsStreaming.value = true;
    chatMessages.value = [
      { id: 'partial', role: 'assistant', content: 'partial answer' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    const sendButton = wrapper.find('.send-btn');
    const stopButton = wrapper.find('.stop-btn');
    expect(sendButton.text()).toBe('Send');
    expect(stopButton.text()).toBe('Stop');

    await wrapper.find('textarea').setValue('new instruction');
    await sendButton.trigger('click');
    expect(sendMessage).toHaveBeenCalledWith('new instruction', undefined);

    await stopButton.trigger('click');
    expect(abort).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('partial answer');
  });

  it('keeps the streaming indicator in thinking mode for read-only tools', async () => {
    chatIsStreaming.value = true;
    chatMessages.value = [
      { id: 'tool-call-1', role: 'assistant', content: 'read input', kind: 'tool_call', toolName: 'read' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.find('.streaming-label').text()).toBe('Thinking');

    wrapper.unmount();
  });

  it('shows composing in the streaming indicator when code editing starts', async () => {
    chatIsStreaming.value = true;
    chatMessages.value = [
      { id: 'tool-call-1', role: 'assistant', content: 'edit input', kind: 'tool_call', toolName: 'edit' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.find('.streaming-label').text()).toBe('Composing');

    wrapper.unmount();
  });

  it('auto-grows the chat input up to a capped height', async () => {
    const wrapper = mount(ChatPanel);
    await nextTick();

    const textarea = wrapper.find('textarea');
    Object.defineProperty(textarea.element, 'scrollHeight', {
      configurable: true,
      value: 340,
    });

    await textarea.setValue('line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10');
    await textarea.trigger('input');
    await nextTick();

    expect((textarea.element as HTMLTextAreaElement).style.height).toBe('276px');
    expect((textarea.element as HTMLTextAreaElement).style.overflowY).toBe('auto');
  });

  it('deletes the previous word with Ctrl+Backspace', async () => {
    const wrapper = mount(ChatPanel);
    await nextTick();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('echo hello   world');
    (textarea.element as HTMLTextAreaElement).setSelectionRange(18, 18);

    await textarea.trigger('keydown', { key: 'Backspace', ctrlKey: true });
    await nextTick();

    expect((textarea.element as HTMLTextAreaElement).value).toBe('echo hello   ');
    expect((textarea.element as HTMLTextAreaElement).selectionStart).toBe(13);
  });

  it('deletes spaces and the previous word with Ctrl+Backspace after whitespace', async () => {
    const wrapper = mount(ChatPanel);
    await nextTick();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('echo hello   ');
    (textarea.element as HTMLTextAreaElement).setSelectionRange(13, 13);

    await textarea.trigger('keydown', { key: 'Backspace', ctrlKey: true });
    await nextTick();

    expect((textarea.element as HTMLTextAreaElement).value).toBe('echo ');
    expect((textarea.element as HTMLTextAreaElement).selectionStart).toBe(5);
  });

  it('shrinks the chat input after sending a multiline message', async () => {
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1' },
    });
    await nextTick();

    const textarea = wrapper.find('textarea');
    Object.defineProperty(textarea.element, 'scrollHeight', {
      configurable: true,
      value: 160,
    });

    await textarea.setValue('line 1\nline 2\nline 3');
    await textarea.trigger('input');
    await nextTick();
    expect((textarea.element as HTMLTextAreaElement).style.height).toBe('160px');

    Object.defineProperty(textarea.element, 'scrollHeight', {
      configurable: true,
      value: 48,
    });

    await wrapper.find('.send-btn').trigger('click');
    await nextTick();

    expect(sendMessage).toHaveBeenCalledWith('line 1\nline 2\nline 3', 'session-1');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
    expect((textarea.element as HTMLTextAreaElement).style.height).toBe('48px');
    expect((textarea.element as HTMLTextAreaElement).style.overflowY).toBe('hidden');
  });

  it('clears messages when sessionId becomes undefined', async () => {
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1' },
    });

    await nextTick();
    expect(loadSessionHistory).toHaveBeenCalledWith('session-1');

    clearMessages.mockClear();
    await wrapper.setProps({ sessionId: undefined });
    await nextTick();

    expect(clearMessages).toHaveBeenCalledOnce();
  });

  it('defaults to deleting the original branch when switching', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/git/branches')) {
        return new Response(JSON.stringify({ current: 'feature/old', branches: ['feature/old', 'main'] }), { status: 200 });
      }
      if (url.includes('/api/git/status')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url === '/api/git/switch-branch') {
        return new Response(JSON.stringify({ name: 'main' }), { status: 200 });
      }
      return new Response(JSON.stringify({ commands: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(ChatPanel, {
      attachTo: document.body,
      props: { sessionId: 'session-1', clientId: 'client-1', projectPath: '/repo' },
    });

    try {
      await (wrapper.vm as unknown as { openBranchDialog: () => Promise<void> }).openBranchDialog();
      await flushPromises();
      const deleteCheckbox = Array.from(document.querySelectorAll<HTMLLabelElement>('.branch-checkbox-row'))
        .find((label) => label.textContent?.includes('Delete the original local branch'))
        ?.querySelector<HTMLInputElement>('input');
      expect(deleteCheckbox?.checked).toBe(true);

      const switchButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.skill-selector-actions .send-btn'))
        .find((button) => button.textContent?.includes('Switch branch'));
      await switchButton?.click();
      await flushPromises();

      const switchCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/git/switch-branch');
      expect(JSON.parse(String(switchCall?.[1]?.body))).toMatchObject({
        cwd: '/repo',
        name: 'main',
        deleteOriginal: true,
        sessionId: 'session-1',
      });
    } finally {
      wrapper.unmount();
    }
  });

  it('remembers the last branch selection for switch and base modes', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/git/branches')) {
        return new Response(JSON.stringify({ current: 'feature/old', branches: ['feature/old', 'main'] }), { status: 200 });
      }
      if (url.includes('/api/git/status')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ commands: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(ChatPanel, {
      attachTo: document.body,
      props: { sessionId: 'session-1', clientId: 'client-1', projectPath: '/repo' },
    });

    try {
      const vm = wrapper.vm as unknown as {
        openBranchDialog: () => Promise<void>;
        closeBranchDialog: () => void;
      };
      await vm.openBranchDialog();
      await flushPromises();
      await document.querySelector<HTMLInputElement>('#branch-switch-select')?.click();
      Array.from(document.querySelectorAll<HTMLButtonElement>('.custom-select-option'))
        .find((option) => option.textContent === 'main')?.click();
      await nextTick();
      vm.closeBranchDialog();
      await vm.openBranchDialog();
      await flushPromises();
      expect(document.querySelector<HTMLInputElement>('#branch-switch-select')?.value).toBe('main');

      document.querySelector<HTMLInputElement>('input[type="radio"][value="base"]')?.click();
      await nextTick();
      expect(document.querySelector<HTMLInputElement>('#branch-base-select')?.value).toBe('main');
      await document.querySelector<HTMLInputElement>('#branch-base-select')?.click();
      Array.from(document.querySelectorAll<HTMLButtonElement>('.custom-select-option'))
        .find((option) => option.textContent === 'feature/old')?.click();
      await nextTick();
      vm.closeBranchDialog();
      await vm.openBranchDialog();
      await flushPromises();
      document.querySelector<HTMLInputElement>('input[type="radio"][value="base"]')?.click();
      await nextTick();
      expect(document.querySelector<HTMLInputElement>('#branch-base-select')?.value).toBe('feature/old');

      // A different project should use its own branch selection rather than /repo's saved value.
      await wrapper.setProps({ projectPath: '/other-repo' });
      await vm.openBranchDialog();
      await flushPromises();
      expect(document.querySelector<HTMLInputElement>('#branch-switch-select')?.value).toBe('main');

      await wrapper.setProps({ projectPath: '/repo' });
      await vm.openBranchDialog();
      await flushPromises();
      expect(document.querySelector<HTMLInputElement>('#branch-switch-select')?.value).toBe('feature/old');
    } finally {
      wrapper.unmount();
    }
  });

  it('loads slash commands with active session context on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commands: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    mount(ChatPanel, {
      props: { sessionId: 'session-1', clientId: 'client-1' },
    });
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/slash-commands?sessionId=session-1&clientId=client-1');
  });

  it('reloads slash commands when the active session context changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commands: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(ChatPanel, {
      props: { clientId: 'client-1' },
    });
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    fetchMock.mockClear();
    await wrapper.setProps({ sessionId: 'session-1' });
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/slash-commands?sessionId=session-1&clientId=client-1');
  });

  it('shows slash suggestions and inserts a selected command', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        commands: [
          {
            id: 'skill-frontend-design',
            label: 'skill:frontend-design',
            insertText: '/skill:frontend-design ',
            description: 'Use frontend design skill',
            category: 'skill',
            aliases: ['ui'],
          },
        ],
      }),
    }));

    const wrapper = mount(ChatPanel);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textarea = wrapper.find('textarea');
    await textarea.setValue('/ui');
    (textarea.element as HTMLTextAreaElement).selectionStart = 3;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 3;
    await textarea.trigger('input');
    await nextTick();

    expect(wrapper.find('.slash-menu').exists()).toBe(true);

    Object.defineProperty(textarea.element, 'scrollHeight', {
      configurable: true,
      value: 72,
    });

    await wrapper.find('.slash-menu button').trigger('click');
    await nextTick();

    expect((textarea.element as HTMLTextAreaElement).value).toBe('/skill:frontend-design ');
    expect((textarea.element as HTMLTextAreaElement).style.height).toBe('72px');
  });

  it('shows the file search loading menu while files are still being fetched', async () => {
    let resolveFileSearch: ((value: { ok: boolean; json: () => Promise<{ files: string[] }> }) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/slash-commands')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ commands: [] }),
        });
      }

      if (url.includes('/api/files/search')) {
        return new Promise((resolve) => {
          resolveFileSearch = resolve;
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }));

    const wrapper = mount(ChatPanel, {
      props: { projectPath: '.' },
    });
    await nextTick();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('@chat');
    (textarea.element as HTMLTextAreaElement).selectionStart = 5;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 5;
    await textarea.trigger('input');
    await nextTick();

    expect(wrapper.find('.file-search-menu').exists()).toBe(true);
    expect(wrapper.find('.loading-indicator').exists()).toBe(true);

    resolveFileSearch?.({
      ok: true,
      json: async () => ({
        files: ['src/components/ChatPanel.vue'],
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(wrapper.find('.loading-indicator').exists()).toBe(false);
    expect(wrapper.text()).toContain('ChatPanel.vue');
  });

  it('uses the latest projectPath prop for file search after props change', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/slash-commands')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ commands: [] }),
        });
      }

      if (url.includes('/api/files/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ files: ['src/components/ChatPanel.vue'] }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(ChatPanel, {
      props: { projectPath: '/first-project' },
    });
    await nextTick();
    await wrapper.setProps({ projectPath: '/second-project' });

    const textarea = wrapper.find('textarea');
    await textarea.setValue('@chat');
    (textarea.element as HTMLTextAreaElement).selectionStart = 5;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 5;
    await textarea.trigger('input');
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/files/search?pattern=**/*&path=%2Fsecond-project');
  });

  it('keeps the file search selection when arrow navigation is followed by caret sync', async () => {
    localStorage.setItem('pi-webui-recent-files', JSON.stringify([
      'src/components/ChatPanel.vue',
      'src/composables/useChat.ts',
    ]));

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/slash-commands')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ commands: [] }),
        });
      }

      if (url.includes('/api/files/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            files: ['src/components/ChatPanel.vue', 'src/composables/useChat.ts'],
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }));

    const wrapper = mount(ChatPanel, {
      props: { projectPath: '.' },
    });
    await nextTick();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('@chat');
    (textarea.element as HTMLTextAreaElement).selectionStart = 5;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 5;
    await textarea.trigger('input');
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    await textarea.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();

    let items = wrapper.findAll('.file-search-item');
    expect(items[1].classes()).toContain('active');

    await textarea.trigger('keyup', { key: 'ArrowDown' });
    await nextTick();

    items = wrapper.findAll('.file-search-item');
    expect(items[1].classes()).toContain('active');
  });

  it('filters recent files when the file mention has a query', async () => {
    localStorage.setItem('pi-webui-recent-files', JSON.stringify([
      'README.md',
      'src/components/ChatPanel.vue',
    ]));

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/slash-commands')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ commands: [] }),
        });
      }

      if (url.includes('/api/files/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            files: ['README.md', 'src/components/ChatPanel.vue'],
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }));

    const wrapper = mount(ChatPanel, {
      props: { projectPath: '.' },
    });
    await nextTick();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('@chat');
    (textarea.element as HTMLTextAreaElement).selectionStart = 5;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 5;
    await textarea.trigger('input');
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(wrapper.text()).toContain('ChatPanel.vue');
    expect(wrapper.text()).not.toContain('README.md');
  });

  it('opens a selected file through the app-level editor event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/slash-commands')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ commands: [] }),
        });
      }

      if (url.includes('/api/files/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            files: ['src/components/ChatPanel.vue'],
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }));

    const wrapper = mount(ChatPanel, {
      props: { projectPath: '.' },
    });
    await nextTick();

    const textarea = wrapper.find('textarea');
    await textarea.setValue('@chat');
    (textarea.element as HTMLTextAreaElement).selectionStart = 5;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 5;
    await textarea.trigger('input');
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    await wrapper.find('.file-search-item').trigger('click');
    await nextTick();

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'open-file-in-editor',
      detail: {
        path: 'src/components/ChatPanel.vue',
        kind: 'path',
        onlyIfEditorVisible: true,
      },
    }));
  });

  it('keeps slash command selection when arrow navigation is followed by caret sync', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        commands: [
          {
            id: 'alpha',
            label: '/alpha',
            insertText: '/alpha ',
            description: 'Alpha command',
            category: 'built-in',
          },
          {
            id: 'beta',
            label: '/beta',
            insertText: '/beta ',
            description: 'Beta command',
            category: 'built-in',
          },
          {
            id: 'gamma',
            label: '/gamma',
            insertText: '/gamma ',
            description: 'Gamma command',
            category: 'built-in',
          },
        ],
      }),
    }));

    const wrapper = mount(ChatPanel);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textarea = wrapper.find('textarea');
    await textarea.setValue('/');
    (textarea.element as HTMLTextAreaElement).selectionStart = 1;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 1;
    await textarea.trigger('input');
    await nextTick();

    await textarea.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    await textarea.trigger('keyup', { key: 'ArrowDown' });
    await nextTick();
    await textarea.trigger('keydown', { key: 'ArrowDown' });
    await nextTick();
    await textarea.trigger('keyup', { key: 'ArrowDown' });
    await nextTick();

    expect((wrapper.vm as unknown as { slashCommands: { activeIndex: { value: number } } }).slashCommands.activeIndex.value).toBe(2);
  });

  it('uses arrow keys and tab to accept the active slash command without sending', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        commands: [
          {
            id: 'help',
            label: '/help',
            insertText: '/help ',
            description: 'Ask for help',
            category: 'built-in',
          },
        ],
      }),
    }));

    const wrapper = mount(ChatPanel);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textarea = wrapper.find('textarea');
    await textarea.setValue('/h');
    (textarea.element as HTMLTextAreaElement).selectionStart = 2;
    (textarea.element as HTMLTextAreaElement).selectionEnd = 2;
    await textarea.trigger('input');
    await nextTick();

    await textarea.trigger('keydown.tab');
    await nextTick();

    expect(sendMessage).not.toHaveBeenCalled();
    expect((textarea.element as HTMLTextAreaElement).value).toBe('/help ');
  });

  it('hides Devin context blocks in clean review mode and shows them in details mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/review-sources/devin/sessions/review-1/transcript')) {
        return new Response(JSON.stringify({ transcript: {
          messages: [
            { role: 'assistant', content: 'You are Devin, an interactive command line agent from Cognition.' },
            { role: 'assistant', content: 'Available subagent profiles for the `run_subagent` tool.' },
            { role: 'assistant', content: 'You are powered by Kimi K2.7.' },
            { role: 'assistant', content: '<system_info>\nPlatform: linux\n</system_info>' },
            { role: 'assistant', content: '<available_skills>\nThe following skills can be invoked using the `skill` tool.\n</available_skills>' },
            { role: 'assistant', content: '<rules type="always-on">\nKeep changes focused.\n</rules>\n\nVisible rule-following text' },
            { role: 'assistant', content: '<thinking>inspect</thinking>\\n<file-view path="/workspace/src/App.vue">\\n1| const app = true;\\n</file-view>' },
            { role: 'assistant', content: '<observation>{"results":[{"content":"Hidden observation"}]}</observation>' },
            { role: 'assistant', content: 'Visible review conclusion' },
          ],
        } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    const wrapper = mount(ChatPanel, { props: { reviewSourceId: 'devin', reviewSessionId: 'review-1' } });
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('Visible review conclusion');
    expect(wrapper.text()).toContain('Visible rule-following text');
    expect(wrapper.text()).not.toContain('You are Devin');
    expect(wrapper.text()).not.toContain('Available subagent profiles');
    expect(wrapper.text()).not.toContain('You are powered by');
    expect(wrapper.text()).not.toContain('Platform: linux');
    expect(wrapper.text()).not.toContain('The following skills can be invoked');
    expect(wrapper.text()).not.toContain('Keep changes focused');
    expect(wrapper.text()).not.toContain('Hidden observation');
    expect(wrapper.text()).not.toContain('file-view path=');
    expect(wrapper.text()).toContain('inspect');

    await wrapper.find('.view-options-toggle-btn').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.details-toggle-btn').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain('You are Devin');
    expect(wrapper.text()).toContain('Available subagent profiles');
    expect(wrapper.text()).toContain('You are powered by');
    expect(wrapper.text()).toContain('Platform: linux');
    expect(wrapper.text()).toContain('The following skills can be invoked');
    expect(wrapper.text()).toContain('Keep changes focused');
    expect(wrapper.text()).toContain('Hidden observation');
    expect(wrapper.text()).toContain('file-view path=');
    expect(wrapper.text()).toContain('Visible review conclusion');
  });

  it('hides tool activity in clean mode', async () => {
    chatMessages.value = [
      { id: 'user-1', role: 'user', content: 'please inspect files' },
      { id: 'tool-call-1', role: 'assistant', content: 'read input', kind: 'tool_call', status: 'pending', title: 'Executing tool read' },
      { id: 'tool-result-1', role: 'assistant', content: 'read output', kind: 'tool_result', status: 'success', title: 'Tool read completed' },
      { id: 'tool-result-2', role: 'assistant', content: 'bash error', kind: 'tool_result', status: 'failure', title: 'Tool bash failed' },
      { id: 'assistant-1', role: 'assistant', content: 'Here is the result' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.text()).toContain('please inspect files');
    expect(wrapper.text()).toContain('Here is the result');
    expect(wrapper.text()).not.toContain('read input');
    expect(wrapper.text()).not.toContain('read output');
    expect(wrapper.text()).not.toContain('bash error');
  });

  it('shows all tool activity when details are enabled', async () => {
    chatMessages.value = [
      { id: 'user-1', role: 'user', content: 'please inspect files' },
      { id: 'tool-call-1', role: 'assistant', content: 'read input', kind: 'tool_call', status: 'pending', title: 'Executing tool read' },
      { id: 'tool-result-1', role: 'assistant', content: 'read output', kind: 'tool_result', status: 'success', title: 'Tool read completed' },
      { id: 'assistant-1', role: 'assistant', content: 'Here is the result' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.find('.messages-header').exists()).toBe(false);
    expect(wrapper.find('.floating-chat-controls').exists()).toBe(true);

    await wrapper.find('.view-options-toggle-btn').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.details-toggle-btn').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain('read input');
    expect(wrapper.text()).toContain('read output');
    expect(wrapper.text()).toContain('Here is the result');
  });

  it('condenses summary thinking in clean mode and restores individual blocks in details mode', async () => {
    chatMessages.value = [
      { id: 'thinking-1', role: 'assistant', content: '**First plan**', thinking: '**First plan**', kind: 'thinking' },
      { id: 'tool-call-1', role: 'assistant', content: 'read input', kind: 'tool_call', status: 'pending' },
      { id: 'tool-result-1', role: 'assistant', content: 'read output', kind: 'tool_result', status: 'success' },
      { id: 'thinking-2', role: 'assistant', content: '**Second plan**', thinking: '**Second plan**', kind: 'thinking' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.findAll('.message-bubble-stub')).toHaveLength(1);
    expect(wrapper.text()).toContain('First plan');
    expect(wrapper.text()).toContain('Second plan');

    await wrapper.find('.view-options-toggle-btn').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.details-toggle-btn').trigger('click');
    await nextTick();

    expect(wrapper.findAll('.message-bubble-stub')).toHaveLength(4);
    wrapper.unmount();
  });

  it('condenses bold text progress updates with thinking summaries in clean mode', async () => {
    chatMessages.value = [
      { id: 'thinking-1', role: 'assistant', content: '**Planning UI changes**', thinking: '**Planning UI changes**', kind: 'thinking' },
      { id: 'text-1', role: 'assistant', content: '**Implementing the component**', kind: 'text' },
      { id: 'tool-call-1', role: 'assistant', content: 'read input', kind: 'tool_call', status: 'pending' },
      { id: 'text-2', role: 'assistant', content: '**Adding styles**', kind: 'text' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.findAll('.message-bubble-stub')).toHaveLength(1);
    expect(wrapper.text()).toContain('Planning UI changes');
    expect(wrapper.text()).toContain('Implementing the component');
    expect(wrapper.text()).toContain('Adding styles');

    await wrapper.find('.view-options-toggle-btn').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.details-toggle-btn').trigger('click');
    await nextTick();

    expect(wrapper.findAll('.message-bubble-stub')).toHaveLength(4);
    wrapper.unmount();
  });

  it('does not condense standalone bold response text in clean mode', async () => {
    chatMessages.value = [
      { id: 'text-1', role: 'assistant', content: '**Important answer**', kind: 'text' },
      { id: 'text-2', role: 'assistant', content: '**Another answer**', kind: 'text' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    expect(wrapper.findAll('.message-bubble-stub')).toHaveLength(2);
    expect(wrapper.text()).toContain('Important answer');
    expect(wrapper.text()).toContain('Another answer');
    wrapper.unmount();
  });

  it('toggles thinking from the floating view options popover', async () => {
    const wrapper = mount(ChatPanel);
    await nextTick();

    await wrapper.find('.view-options-toggle-btn').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.thinking-toggle-btn').trigger('click');

    expect(toggleThinking).toHaveBeenCalledTimes(1);
  });

  it('does not open the view options popover when hovering the floating controls container', async () => {
    const wrapper = mount(ChatPanel);
    await nextTick();

    await wrapper.find('.floating-chat-controls').trigger('mouseenter');
    await nextTick();

    expect(wrapper.find('.view-options-popover').exists()).toBe(false);
  });

  it('scrolls the message list to the top from the floating control', async () => {
    chatMessages.value = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'second' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    const messages = wrapper.find('.messages').element as HTMLElement;
    let scrollTop = 240;
    Object.defineProperty(messages, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => { scrollTop = Number(top); });
    Object.defineProperty(messages, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });

    await wrapper.find('.go-to-top-btn').trigger('click');

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollTop).toBe(0);
  });

  it('does not force-scroll to the bottom when streamed content updates after the user scrolls up', async () => {
    chatIsStreaming.value = true;
    chatMessages.value = [
      { id: '1', role: 'user', content: 'question' },
      { id: '2', role: 'assistant', content: 'partial answer' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    const messages = wrapper.find('.messages').element as HTMLElement;
    let scrollTop = 100;
    Object.defineProperties(messages, {
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => { scrollTop = value; },
      },
      scrollHeight: {
        configurable: true,
        value: 1000,
      },
      clientHeight: {
        configurable: true,
        value: 300,
      },
    });

    chatMessages.value[1].content = 'partial answer with more streamed text';
    await nextTick();
    await nextTick();

    expect(scrollTop).toBe(100);
  });

  it('uses arrow keys on the message list to navigate message blocks', async () => {
    chatMessages.value = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'second' },
      { id: '3', role: 'user', content: 'third' },
    ];
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    const wrapper = mount(ChatPanel);
    await nextTick();

    const messages = wrapper.find('.messages');
    await messages.trigger('keydown', { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(wrapper.findAll('.message-block')[1].attributes('aria-current')).toBe('true');
    expect(wrapper.findAll('.message-block')[1].classes()).toContain('is-selected');
  });

  it('does not consume Ctrl+E or Ctrl+Y on the message list', async () => {
    chatMessages.value = [
      { id: '1', role: 'user', content: 'first' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    const messages = wrapper.find('.messages').element;
    const ctrlE = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true, cancelable: true });
    const ctrlY = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });

    messages.dispatchEvent(ctrlE);
    messages.dispatchEvent(ctrlY);

    expect(ctrlE.defaultPrevented).toBe(false);
    expect(ctrlY.defaultPrevented).toBe(false);
  });

  it('moves focus to the input when pressing down from the last message', async () => {
    chatMessages.value = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'second' },
    ];

    const wrapper = mount(ChatPanel, { attachTo: document.body });
    await nextTick();

    await wrapper.findAll('.message-block')[1].trigger('click');
    await wrapper.find('.messages').trigger('keydown', { key: 'ArrowDown' });

    expect(document.activeElement).toBe(wrapper.find('textarea').element);
    expect(wrapper.findAll('.message-block')[1].attributes('aria-current')).toBeUndefined();
    expect(wrapper.findAll('.message-block')[1].classes()).not.toContain('is-selected');

    wrapper.unmount();
  });

  it('shows the active skill count in the composer and opens the skill dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/skills')) {
        return new Response(JSON.stringify({
          skills: [
            { name: 'brainstorming', description: 'creative work' },
            { name: 'systematic-debugging', description: 'bug fixing' },
          ],
          policy: { mode: 'enabled', appliedSkills: ['brainstorming'] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1', clientId: 'client-1' },
    });

    await vi.waitFor(() => expect(wrapper.find('.composer-skill-selector').text()).toBe('1 skill'));
    await wrapper.find('.composer-skill-selector').trigger('click');
    await flushPromises();

    expect(document.querySelector('.skill-selector-modal')).not.toBeNull();
    wrapper.unmount();
  });

  it('opens the model selector from the composer toolbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    }));
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1', clientId: 'client-1' },
      global: { stubs: { Teleport: true } },
    });

    await wrapper.find('.composer-model-selector').trigger('click');
    await flushPromises();

    expect(wrapper.find('.model-selector-modal').exists()).toBe(true);
    wrapper.unmount();
  });

  it('opens the thinking selector from the composer toolbox', async () => {
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1', clientId: 'client-1' },
      global: { stubs: { Teleport: true } },
    });
    (wrapper.vm as any).sessionStatus = {
      model: { id: 'reasoning-model', reasoning: true },
      thinkingLevel: 'medium',
      thinkingLevels: ['off', 'medium', 'high'],
    };
    await nextTick();

    await wrapper.find('.composer-thinking-selector').trigger('click');

    expect(wrapper.find('.thinking-selector-modal').exists()).toBe(true);
    expect(wrapper.find('.model-option.current').text()).toContain('medium');
    wrapper.unmount();
  });

  it('clamps model keyboard navigation to the rendered list and scrolls the active model into view', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const models = Array.from({ length: 12 }, (_, index) => ({
      provider: 'test',
      id: `model-${index}`,
      name: `Model ${index}`,
      current: index === 0,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models }),
    }));
    const wrapper = mount(ChatPanel, {
      props: { sessionId: 'session-1', clientId: 'client-1' },
      global: { stubs: { Teleport: true } },
    });

    await (wrapper.vm as unknown as { openModelSelector: () => Promise<void> }).openModelSelector();
    scrollIntoView.mockClear();
    const search = wrapper.find('.model-search-input');

    await search.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.findAll('.model-option')[0].classes()).toContain('keyboard-active');

    for (let index = 0; index < 12; index++) {
      await search.trigger('keydown', { key: 'ArrowDown' });
    }
    expect(wrapper.findAll('.model-option')[11].classes()).toContain('keyboard-active');

    await search.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.findAll('.model-option')[11].classes()).toContain('keyboard-active');

    await search.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.findAll('.model-option')[10].classes()).toContain('keyboard-active');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    wrapper.unmount();
  });

  it('selects a message block when clicked', async () => {
    chatMessages.value = [
      { id: '1', role: 'user', content: 'first' },
      { id: '2', role: 'assistant', content: 'second' },
    ];

    const wrapper = mount(ChatPanel);
    await nextTick();

    await wrapper.findAll('.message-block')[1].trigger('click');

    expect(wrapper.findAll('.message-block')[1].attributes('aria-current')).toBe('true');
    expect(wrapper.findAll('.message-block')[1].classes()).toContain('is-selected');
  });

});
