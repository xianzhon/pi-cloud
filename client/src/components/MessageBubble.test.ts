import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MessageBubble from './MessageBubble.vue';
import { setLocale } from '../i18n';

describe('MessageBubble', () => {
  afterEach(() => setLocale('en'));

  it('renders accessible thumbnails for an image-only user message', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'user-images',
          role: 'user',
          content: '',
          images: [
            { type: 'image', data: 'cG5n', mimeType: 'image/png', name: 'diagram.png' },
            { type: 'image', data: 'd2VicA==', mimeType: 'image/webp' },
          ],
        },
      },
    });

    const images = wrapper.findAll('.message-image');
    expect(images).toHaveLength(2);
    expect(images[0].attributes()).toMatchObject({ src: 'data:image/png;base64,cG5n', alt: 'diagram.png' });
    expect(images[1].attributes('alt')).toBe('Attached image 2');
    expect(wrapper.find('.message-bubble').attributes('aria-label')).toBe('User message with 2 images');
    expect(wrapper.find('.message-image-annotate').exists()).toBe(false);
  });

  it('emits the stored image when Annotate is selected', async () => {
    const image = {
      type: 'image' as const,
      data: 'cG5n',
      mimeType: 'image/png',
      name: 'chart.png',
      path: '/project/tmp/upload_images/chart.png',
    };
    const wrapper = mount(MessageBubble, {
      props: { message: { id: 'stored-image', role: 'user', content: '', images: [image] } },
    });

    await wrapper.find('.message-image-annotate').trigger('click');

    expect(wrapper.emitted('annotate')).toEqual([[image]]);
  });

  it('opens the double-clicked thumbnail in a modal lightbox', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'user-images',
          role: 'user',
          content: '',
          images: [
            { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png', name: 'first.png' },
            { type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg', name: 'second.jpg' },
          ],
        },
      },
    });

    await wrapper.findAll('.message-image')[1].trigger('dblclick');

    const lightbox = document.body.querySelector('.message-image-lightbox');
    const preview = lightbox?.querySelector('img');
    expect(lightbox?.getAttribute('role')).toBe('dialog');
    expect(lightbox?.getAttribute('aria-modal')).toBe('true');
    expect(preview?.getAttribute('src')).toBe('data:image/jpeg;base64,c2Vjb25k');
    expect(preview?.getAttribute('alt')).toBe('second.jpg');

    wrapper.unmount();
  });

  it('zooms with the mouse wheel and drag-pans the enlarged image', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'zoomable-image',
          role: 'user',
          content: '',
          images: [{ type: 'image', data: 'cG5n', mimeType: 'image/png', name: 'large.png' }],
        },
      },
    });

    await wrapper.find('.message-image').trigger('dblclick');
    const lightbox = document.body.querySelector<HTMLElement>('.message-image-lightbox')!;
    const preview = lightbox.querySelector<HTMLImageElement>('.message-image-lightbox-image')!;
    Object.defineProperties(lightbox, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
      getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
    });
    Object.defineProperties(preview, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 600 },
    });

    const wheelEvent = new Event('wheel', { bubbles: true, cancelable: true });
    Object.defineProperties(wheelEvent, {
      deltaY: { value: -1 },
      clientX: { value: 200 },
      clientY: { value: 150 },
    });
    lightbox.dispatchEvent(wheelEvent);
    await wrapper.vm.$nextTick();
    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(preview.getAttribute('style')).toContain('scale(1.25)');

    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        pointerId: { value: 1 },
        clientX: { value: clientX },
        clientY: { value: clientY },
      });
      preview.dispatchEvent(event);
    };
    pointerEvent('pointerdown', 200, 150);
    pointerEvent('pointermove', 100, 70);
    pointerEvent('pointerup', 100, 70);
    await wrapper.vm.$nextTick();
    expect(preview.getAttribute('style')).toContain('translate(-100px, -80px)');

    wrapper.unmount();
  });

  it('keeps image clicks open and dismisses the lightbox from each close control', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'user-image',
          role: 'user',
          content: '',
          images: [{ type: 'image', data: 'cG5n', mimeType: 'image/png', name: 'diagram.png' }],
        },
      },
    });
    const thumbnail = wrapper.find('.message-image');
    const lightbox = () => document.body.querySelector<HTMLElement>('.message-image-lightbox');

    await thumbnail.trigger('dblclick');
    lightbox()?.querySelector('img')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(lightbox()).not.toBeNull();

    lightbox()?.querySelector<HTMLButtonElement>('.message-image-lightbox-close')?.click();
    await wrapper.vm.$nextTick();
    expect(lightbox()).toBeNull();

    await thumbnail.trigger('dblclick');
    lightbox()?.click();
    await wrapper.vm.$nextTick();
    expect(lightbox()).toBeNull();

    await thumbnail.trigger('dblclick');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(lightbox()).toBeNull();

    wrapper.unmount();
  });

  it('renders a bare bold thinking summary as a compact one-line row', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'bare-summary-thinking',
          role: 'assistant',
          content: '**Planning PriceCalculatorPopup renaming to PiP**',
          thinking: '**Planning PriceCalculatorPopup renaming to PiP**',
          kind: 'thinking',
          status: 'info',
          title: 'Thinking',
        },
      },
    });

    expect(wrapper.find('.event-title').text()).toBe('Planning PriceCalculatorPopup renaming to PiP');
    expect(wrapper.find('.event-toggle').exists()).toBe(false);
    expect(wrapper.find('.event-content').exists()).toBe(false);
  });

  it('summarizes multiple bare thinking titles and renders them as expandable bullets', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'summary-thinking',
          role: 'assistant',
          content: '**Defining documentPictureInPicture types**\n\n**Planning component rename for PiP integration**',
          thinking: '**Defining documentPictureInPicture types**\n\n**Planning component rename for PiP integration**',
          kind: 'thinking',
          status: 'info',
          title: 'Thinking',
        },
      },
    });

    expect(wrapper.find('.event-title').text()).toBe('Defining documentPictureInPicture types · 1 more');
    expect(wrapper.find('.event-toggle').exists()).toBe(true);

    await wrapper.find('.event-header').trigger('click');

    expect(wrapper.findAll('.event-content li').map((item) => item.text())).toEqual([
      'Defining documentPictureInPicture types',
      'Planning component rename for PiP integration',
    ]);
  });

  it('renders expandable memory recall details for assistant responses', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-memory',
          role: 'assistant',
          content: 'Done',
          memory: {
            injected: true,
            tokenCount: 42,
            memories: [
              { id: 'memory-1', scope: 'project', category: 'fact', content: 'Keyboard menus clamp at visible bounds', reason: 'query-match' },
              { id: 'memory-2', scope: 'global', category: 'rule', content: 'Keep changes surgical', reason: 'pinned' },
            ],
          },
        },
      },
    });

    const toggle = wrapper.find('.memory-recall-toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.text()).toContain('Memory: 2 provided');
    expect(toggle.attributes('title')).toContain('42 memory tokens');

    await toggle.trigger('click');

    expect(wrapper.findAll('.memory-recall-item')).toHaveLength(2);
    expect(wrapper.text()).toContain('query-match');
    expect(wrapper.text()).toContain('Keyboard menus clamp at visible bounds');
  });

  it('explains zero-injection recall decisions', async () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-memory-none',
          role: 'assistant',
          content: 'Done',
          memory: {
            injected: false,
            tokenCount: 0,
            memories: [],
            diagnostics: {
              candidateIds: [], rejectedBelowThresholdIds: [], redundancyRejectedIds: [], selected: [],
              budgetCeiling: 0, usedTokens: 0, overflow: false,
              countingMethod: 'local-unicode-v1', rankingPolicyVersion: 'adaptive-lexical-v1',
              promptFormatVersion: 'memory-prompt-v2', skipReason: 'not-substantive',
            },
          },
        },
      },
    });

    setLocale('zh-CN');
    await wrapper.vm.$nextTick();

    const toggle = wrapper.find('.memory-recall-toggle');
    expect(toggle.text()).toBe('记忆：未提供');

    await toggle.trigger('click');

    expect(wrapper.find('.memory-recall-empty').text()).toContain('提示词缺少实质内容');
  });

  it('renders assistant response token usage and model metadata', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Done',
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

    const usage = wrapper.find('.token-usage');
    expect(usage.exists()).toBe(true);
    expect(usage.text()).toContain('anthropic/claude-sonnet-4');
    expect(usage.text()).toContain('1.6k tokens');
    expect(usage.text()).toContain('$0.0123');
    expect(usage.attributes('title')).toContain('Input: 1,200');
    expect(usage.attributes('title')).toContain('Output: 345');
  });

  it('hides assistant response token usage when hint info is disabled', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        showHintInfo: false,
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Done',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          usage: {
            input: 1200,
            output: 345,
          },
        },
      },
    });

    expect(wrapper.find('.token-usage').exists()).toBe(false);
  });

  it('renders fenced bash code blocks with a language header and syntax highlighting', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-code',
          role: 'assistant',
          content: 'Run this:\n\n```bash\nset -euo pipefail\necho "hello"\n```',
        },
      },
    });

    expect(wrapper.find('.code-block-header').text()).toBe('bash');
    const highlightedCode = wrapper.find('.code-block code.hljs.language-bash');
    expect(highlightedCode.exists()).toBe(true);
    expect(highlightedCode.html()).toContain('hljs-');
  });

  it('hides fenced code block language headers when disabled', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        showCodeBlockLanguageHeaders: false,
        message: {
          id: 'assistant-code-hidden-header',
          role: 'assistant',
          content: '```bash\necho "hello"\n```',
        },
      },
    });

    expect(wrapper.find('.code-block-header').exists()).toBe(false);
    expect(wrapper.find('.code-block code.hljs.language-bash').exists()).toBe(true);
  });

  it('renders inline code without using the fenced code block wrapper', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-inline-code',
          role: 'assistant',
          content: 'Use `Chat` settings and run `pnpm test:run`.',
        },
      },
    });

    const inlineCodes = wrapper.findAll('.message-content p code');
    expect(inlineCodes).toHaveLength(2);
    expect(inlineCodes[0].text()).toBe('Chat');
    expect(inlineCodes[1].text()).toBe('pnpm test:run');
    expect(wrapper.find('.message-content .code-block').exists()).toBe(false);
    expect(wrapper.find('.message-content pre code').exists()).toBe(false);
  });

  it('uses pi-agent blue for inline code text without inline code chrome', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/MessageBubble.vue'), 'utf8');

    expect(source).toContain('--markdown-inline-code-text: #79c0ff;');
    expect(source).toContain('--markdown-inline-code-bg: none;');
    expect(source).toContain('--markdown-inline-code-border: none;');
  });

  it('renders expanded skill-reference user messages as a clickable skill file path', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'user-skill-reference',
          role: 'user',
          content: [
            'References are relative to /Users/ross/.pi/codex/skills/code-simplifier.',
            '',
            'You are an expert code simplification specialist focused on enhancing code clarity.',
          ].join('\n'),
        },
      },
    });

    expect(wrapper.find('.message-content').text()).toBe('Referenced skill: code-simplifier');
    expect(wrapper.find('.message-content').text()).not.toContain('You are an expert code simplification specialist');
    const link = wrapper.find('.message-content a.file-link');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('code-simplifier');
    expect(link.attributes('data-path')).toBe('/Users/ross/.pi/codex/skills/code-simplifier/SKILL.md');
  });

  it('renders XML-wrapped expanded skill user messages as a clickable skill file path', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'user-skill-reference-tagged',
          role: 'user',
          content: [
            '<skill name="code-simplifier" location="/Users/ross/.pi/codex/skills/code-simplifier/SKILL.md">',
            'References are relative to /Users/ross/.pi/codex/skills/code-simplifier.',
            '',
            'You are an expert code simplification specialist focused on enhancing code clarity.',
            '</skill>',
          ].join('\n'),
        },
      },
    });

    expect(wrapper.find('.message-content').text()).toBe('Referenced skill: code-simplifier');
    expect(wrapper.find('.message-content').text()).not.toContain('You are an expert code simplification specialist');
    const link = wrapper.find('.message-content a.file-link');
    expect(link.text()).toBe('code-simplifier');
    expect(link.attributes('data-path')).toBe('/Users/ross/.pi/codex/skills/code-simplifier/SKILL.md');
  });

  it('opens Markdown links to local files in the editor', async () => {
    const openFile = vi.fn();
    window.addEventListener('open-file-in-editor', openFile);
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-local-file-link',
          role: 'assistant',
          content: '[Annotated image](tmp/upload_images/image-annotated.png)',
        },
      },
    });

    const link = wrapper.find('.message-content a');
    expect(link.classes()).toContain('file-link');
    expect(link.attributes('data-path')).toBe('tmp/upload_images/image-annotated.png');

    await link.trigger('click');

    expect(openFile).toHaveBeenCalledOnce();
    expect((openFile.mock.calls[0][0] as CustomEvent).detail).toEqual({
      path: 'tmp/upload_images/image-annotated.png',
      kind: 'path',
      line: undefined,
      column: undefined,
    });
    window.removeEventListener('open-file-in-editor', openFile);
  });

  it('renders links, blockquotes, and tables as markdown elements', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'assistant-markdown-elements',
          role: 'assistant',
          content: [
            '[Open docs](https://example.com)',
            '',
            '> Important markdown note',
            '',
            '| Item | Status |',
            '| --- | --- |',
            '| Inline `code` | Done |',
          ].join('\n'),
        },
      },
    });

    const link = wrapper.find('.message-content a');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('Open docs');
    expect(link.attributes('href')).toBe('https://example.com');
    expect(link.classes()).not.toContain('file-link');

    const blockquote = wrapper.find('.message-content blockquote');
    expect(blockquote.exists()).toBe(true);
    expect(blockquote.text()).toContain('Important markdown note');

    const table = wrapper.find('.message-content table');
    expect(table.exists()).toBe(true);
    expect(table.findAll('th')).toHaveLength(2);
    expect(table.text()).toContain('Inline code');
    expect(table.find('code').text()).toBe('code');
  });

  it('shows bash tool call command in the header and detail block', () => {
    const toolInput = JSON.stringify({ command: 'cd client && pnpm test ChatPanel.test.ts --run', timeout: 120 }, null, 2);

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'tool-1',
          role: 'assistant',
          content: toolInput,
          kind: 'tool_call',
          status: 'pending',
          title: 'Executing tool bash',
          toolName: 'bash',
          toolInput,
        },
      },
    });

    expect(wrapper.findAll('.event-block')).toHaveLength(1);
    expect(wrapper.find('.event-content').exists()).toBe(false);
    expect(wrapper.find('.event-block-label').exists()).toBe(false);
    expect(wrapper.find('.event-path').text()).toBe('cd client && pnpm test ChatPanel.test.ts --run');
    expect(wrapper.find('.event-block code.hljs.language-json').exists()).toBe(false);
    expect(wrapper.find('.event-block code.hljs.language-bash').exists()).toBe(true);
    expect(wrapper.find('.event-block code').text()).toBe('cd client && pnpm test ChatPanel.test.ts --run');
  });

  it('truncates long bash tool call commands in the header only', () => {
    const command = 'cd /Users/ross/git/github/pi-webui && tea pr create --help 2>&1 && pnpm test:run MessageBubble.test.ts -- --reporter verbose --coverage.enabled false';
    const toolInput = JSON.stringify({ command }, null, 2);

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'tool-long-command-1',
          role: 'assistant',
          content: toolInput,
          kind: 'tool_call',
          status: 'pending',
          title: 'Executing tool bash',
          toolName: 'bash',
          toolInput,
        },
      },
    });

    const commandLabel = wrapper.find('.event-path');
    expect(commandLabel.text().length).toBeLessThanOrEqual(120);
    expect(commandLabel.text()).toContain('...');
    expect(commandLabel.attributes('title')).toBe(command);
    expect(wrapper.find('.event-block code').text()).toBe(command);
  });

  it('toggles tool call code blocks from the event header', async () => {
    const toolInput = JSON.stringify({ command: 'pnpm test', timeout: 120 }, null, 2);

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'tool-toggle-1',
          role: 'assistant',
          content: toolInput,
          kind: 'tool_call',
          status: 'pending',
          title: 'Executing tool bash',
          toolName: 'bash',
          toolInput,
        },
      },
    });

    expect(wrapper.find('.event-block').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'PhCaretDown' }).exists()).toBe(true);

    await wrapper.find('.event-header').trigger('click');
    expect(wrapper.find('.event-block').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'PhCaretRight' }).exists()).toBe(true);

    await wrapper.find('.event-header').trigger('click');
    expect(wrapper.find('.event-block').exists()).toBe(true);
  });

  it('shows read tool call path in the header instead of an input block', () => {
    const toolInput = JSON.stringify({ path: '/Users/ross/.claude/plugins/cache/skills/SKILL.md' }, null, 2);

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'read-call-1',
          role: 'assistant',
          content: toolInput,
          kind: 'tool_call',
          status: 'pending',
          title: 'Executing tool read',
          toolName: 'read',
          toolInput,
        },
      },
    });

    expect(wrapper.find('.event-title').text()).toBe('Executing tool read');
    expect(wrapper.find('.event-path').text()).toBe('/Users/ross/.claude/plugins/cache/skills/SKILL.md');
    expect(wrapper.find('.event-block').exists()).toBe(false);
  });

  it('shows edit tool call path in the header and renders edits as a diff', () => {
    const toolInput = JSON.stringify({
      path: 'client/src/App.vue',
      edits: [
        {
          oldText: 'function handleCloseTerminal(terminalId: string) {\n  clearTerminalInitTimer(terminalId);\n}\n',
          newText: 'function handleCloseTerminal(terminalId: string) {\n  clearTerminalInitTimer(terminalId);\n  const wasActive = activeTerminalId.value === terminalId;\n}\n',
        },
      ],
    }, null, 2);

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'edit-call-1',
          role: 'assistant',
          content: toolInput,
          kind: 'tool_call',
          status: 'pending',
          title: 'Executing tool edit',
          toolName: 'edit',
          toolInput,
        },
      },
    });

    expect(wrapper.find('.event-title').text()).toBe('Executing tool edit');
    expect(wrapper.find('.event-path').text()).toBe('client/src/App.vue');
    expect(wrapper.find('.event-block code.hljs.language-json').exists()).toBe(false);
    expect(wrapper.find('.edit-diff').exists()).toBe(true);
    expect(wrapper.findAll('.edit-diff-line.context')).toHaveLength(3);
    expect(wrapper.findAll('.edit-diff-line.removed')).toHaveLength(0);
    expect(wrapper.findAll('.edit-diff-line.added')).toHaveLength(1);
    expect(wrapper.find('.edit-diff-line.context code').text()).toContain('function handleCloseTerminal');
    expect(wrapper.find('.edit-diff-line.context .edit-diff-mark').element.textContent).toBe(' ');
    expect(wrapper.text()).toContain('+  const wasActive = activeTerminalId.value === terminalId;');
  });

  it('shows write tool call path in the header and renders content as highlighted file text', () => {
    const fileContent = [
      "import { beforeEach, describe, expect, it, vi } from 'vitest';",
      "import { useTerminalPanel } from './useTerminalPanel';",
      '',
      "describe('useTerminalPanel', () => {",
      '  beforeEach(() => {',
      '    localStorage.clear();',
      "    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });",
      '  });',
      '});',
      '',
    ].join('\n');
    const toolInput = JSON.stringify({
      path: 'client/src/composables/useTerminalPanel.test.ts',
      content: fileContent,
    }, null, 2);

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'write-call-1',
          role: 'assistant',
          content: toolInput,
          kind: 'tool_call',
          status: 'pending',
          title: 'Executing tool write',
          toolName: 'write',
          toolInput,
        },
      },
    });

    expect(wrapper.find('.event-title').text()).toBe('Executing tool write');
    expect(wrapper.find('.event-path').text()).toBe('client/src/composables/useTerminalPanel.test.ts');
    expect(wrapper.find('.event-block code.hljs.language-json').exists()).toBe(false);
    expect(wrapper.find('.event-block code.hljs.language-typescript').exists()).toBe(true);
    expect(wrapper.text()).toContain("import { beforeEach, describe, expect, it, vi } from 'vitest';");
    expect(wrapper.text()).not.toContain('"path": "client/src/composables/useTerminalPanel.test.ts"');
  });

  it('renders bash tool results as bash code blocks', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'bash-result-1',
          role: 'assistant',
          content: 'total 8\n-rw-r--r--  README.md\n',
          kind: 'tool_result',
          status: 'success',
          title: 'Tool bash completed',
          toolName: 'bash',
          toolOutput: 'total 8\n-rw-r--r--  README.md\n',
        },
      },
    });

    expect(wrapper.find('.code-block-header').text()).toBe('bash');
    expect(wrapper.find('.event-block code.hljs.language-bash').exists()).toBe(true);
  });

  it('renders read tool output as highlighted file content based on the input path', () => {
    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'read-result-1',
          role: 'assistant',
          content: 'const answer: number = 42;\nexport default answer;\n',
          kind: 'tool_result',
          status: 'success',
          title: 'Tool read completed',
          toolName: 'read',
          toolInput: JSON.stringify({ file_path: 'client/src/example.ts' }, null, 2),
          toolOutput: 'const answer: number = 42;\nexport default answer;\n',
        },
      },
    });

    const sections = wrapper.findAll('.event-block');
    expect(sections).toHaveLength(1);
    expect(wrapper.find('.event-title').text()).toBe('Tool read completed');
    expect(wrapper.find('.event-path').text()).toBe('client/src/example.ts');
    expect(wrapper.find('.event-block-label').exists()).toBe(false);
    expect(sections[0].find('code.hljs.language-typescript').exists()).toBe(true);
    expect(sections[0].find('code').html()).toContain('hljs-');
  });

  it('renders large tool output without expensive syntax tokenization', () => {
    const largeTypescript = Array.from({ length: 2500 }, (_, index) => `const value${index}: number = ${index};`).join('\n');

    const wrapper = mount(MessageBubble, {
      props: {
        message: {
          id: 'large-read-result',
          role: 'assistant',
          content: largeTypescript,
          kind: 'tool_result',
          status: 'success',
          title: 'Tool read completed',
          toolName: 'read',
          toolInput: JSON.stringify({ file_path: 'client/src/large.ts' }, null, 2),
          toolOutput: largeTypescript,
        },
      },
    });

    const outputCode = wrapper.findAll('.event-block')[0].find('code.hljs.language-typescript');
    expect(outputCode.exists()).toBe(true);
    expect(outputCode.html()).not.toContain('hljs-keyword');
    expect(outputCode.text()).toContain('const value2499: number = 2499;');
  });
});
