import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as monaco from 'monaco-editor';
import EditorPanel from './EditorPanel.vue';
import editorPanelSource from './EditorPanel.vue?raw';

enableAutoUnmount(afterEach);

vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn(() => ({
      addCommand: vi.fn(),
      addAction: vi.fn(),
      setModel: vi.fn(),
      getModel: vi.fn(() => null),
      getValue: vi.fn(() => ''),
      createDecorationsCollection: vi.fn(() => ({ set: vi.fn(), clear: vi.fn() })),
      dispose: vi.fn(),
      layout: vi.fn(),
    })),
    createModel: vi.fn(() => ({
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
      getLineCount: vi.fn(() => 1),
      dispose: vi.fn(),
    })),
    setModelLanguage: vi.fn(),
    OverviewRulerLane: { Left: 1 },
  },
  languages: {
    getLanguages: vi.fn(() => []),
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    typescript: {
      typescriptDefaults: { setDiagnosticsOptions: vi.fn() },
      javascriptDefaults: { setDiagnosticsOptions: vi.fn() },
    },
    json: {
      jsonDefaults: { setDiagnosticsOptions: vi.fn() },
    },
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 49 },
  Uri: { file: (path: string) => ({ path }) },
  Range: class {
    constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
  },
}));

vi.mock('monaco-editor/esm/vs/basic-languages/monaco.contribution', () => ({}));
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({ default: class {} }));

function mockFileTreeFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ tree: [] }),
  })));
}

describe('EditorPanel', () => {
  afterEach(async () => {
    // Let mounted reloads finish while their per-test fetch stub is still installed.
    await flushPromises();
    vi.unstubAllGlobals();
  });

  it('enables line wrapping in the editor', async () => {
    mockFileTreeFetch();
    const createSpy = vi.spyOn(monaco.editor, 'create');

    mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await vi.waitFor(() => {
      expect(createSpy).toHaveBeenCalled();
    });

    expect(createSpy.mock.calls[0][1]).toMatchObject({
      wordWrap: 'on',
    });
  });

  it('uses in-flow flex layout instead of overlaying the chat', () => {
    const panelRule = editorPanelSource.match(/\.editor-panel\s*\{[^}]+}/)?.[0] || '';
    expect(panelRule).not.toContain('position: fixed;');
    expect(editorPanelSource).toContain('flex: 0 0 var(--editor-panel-width);');
  });

  it('keeps editor actions and the markdown mode switch readable when tabs overflow', () => {
    const tabsRule = editorPanelSource.match(/\.editor-tabs\s*\{[^}]+}/)?.[0] || '';
    const actionsRule = editorPanelSource.match(/\.editor-actions\s*\{[^}]+}/)?.[0] || '';
    const markdownButtonRule = editorPanelSource.match(/\.editor-actions \.markdown-mode-toggle button\s*\{[^}]+}/)?.[0] || '';

    expect(tabsRule).toContain('flex: 1 1 auto;');
    expect(actionsRule).toContain('flex: 0 0 auto;');
    expect(markdownButtonRule).toContain('white-space: nowrap;');
  });

  it('uses GitHub-like alternating table row backgrounds in light markdown preview', () => {
    expect(editorPanelSource).toContain(":class=\"{ 'markdown-preview-light': resolvedTheme === 'light' }\"");
    expect(editorPanelSource).toContain('.markdown-preview-light :deep(tbody tr:nth-child(2n))');
    expect(editorPanelSource).toContain('background: #f6f8fa;');
  });

  it('zooms and drag-pans an image preview, then resets it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      if (String(url).startsWith('/api/files/read')) {
        return { ok: false, status: 415, json: async () => ({ kind: 'image', mtime: 1 }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(EditorPanel, { props: { visible: true, cwd: '/project' } });
    await wrapper.vm.openFile('/project/large.png');
    await wrapper.vm.$nextTick();

    const viewport = wrapper.find('.image-preview-viewport');
    const image = wrapper.find('.image-preview img');
    Object.defineProperties(viewport.element, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    Object.defineProperties(image.element, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 600 },
    });

    await wrapper.find('[aria-label="Zoom in"]').trigger('click');
    expect(wrapper.find('.image-zoom-level').text()).toBe('125%');
    expect(image.attributes('style')).toContain('scale(1.25)');

    await viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 200, clientY: 150 });
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 80, clientY: 70 });
    await viewport.trigger('pointerup', { pointerId: 1, clientX: 80, clientY: 70 });
    expect(image.attributes('style')).toContain('calc(50% + -120px)');
    expect(image.attributes('style')).toContain('calc(50% + -80px)');

    await viewport.trigger('dblclick');
    expect(wrapper.find('.image-zoom-level').text()).toBe('100%');
    expect(image.attributes('style')).toContain('scale(1)');
    expect(image.attributes('style')).toContain('calc(50% + 0px)');

    await viewport.trigger('pointerdown', { button: 0, pointerId: 2, clientX: 100, clientY: 150 });
    await viewport.trigger('pointerdown', { button: 0, pointerId: 3, clientX: 300, clientY: 150 });
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 0, clientY: 150 });
    expect(wrapper.find('.image-zoom-level').text()).toBe('150%');
    expect(image.attributes('style')).toContain('scale(1.5)');

    await viewport.trigger('pointerup', { pointerId: 2, clientX: 0, clientY: 150 });
    await viewport.trigger('pointerup', { pointerId: 3, clientX: 300, clientY: 150 });
  });

  it('defaults to a narrower editor width, resizes from its left edge, and relayouts Monaco', async () => {
    mockFileTreeFetch();
    vi.stubGlobal('innerWidth', 1000);
    const layout = vi.fn();
    vi.spyOn(monaco.editor, 'create').mockReturnValue({
      addCommand: vi.fn(),
      addAction: vi.fn(),
      setModel: vi.fn(),
      getValue: vi.fn(() => ''),
      dispose: vi.fn(),
      layout,
    } as any);
    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    expect(wrapper.find('.editor-panel').attributes('style')).toContain('--editor-panel-width: 50vw');

    await wrapper.find('.editor-resize-handle').trigger('mousedown', { clientX: 600 });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(wrapper.find('.editor-panel').attributes('style')).toContain('--editor-panel-width: 600px');
    expect(layout).toHaveBeenCalled();
  });

  it('supports minimize and maximize window controls', async () => {
    mockFileTreeFetch();
    const layout = vi.fn();
    vi.spyOn(monaco.editor, 'create').mockReturnValue({
      addCommand: vi.fn(),
      addAction: vi.fn(),
      setModel: vi.fn(),
      getValue: vi.fn(() => ''),
      dispose: vi.fn(),
      layout,
    } as any);

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const maximizeBtn = wrapper.find('.maximize-btn');
    expect(maximizeBtn.text()).toBe('▢');
    await maximizeBtn.trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.editor-panel').classes()).toContain('maximized');
    expect(wrapper.find('.editor-panel').attributes('style')).toContain('position: fixed');
    expect(wrapper.find('.maximize-btn').text()).toBe('❐');
    expect(wrapper.find('.editor-resize-handle').exists()).toBe(false);

    await wrapper.find('.maximize-btn').trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.editor-panel').classes()).not.toContain('maximized');
    expect(wrapper.find('.maximize-btn').text()).toBe('▢');
    expect(wrapper.find('.editor-resize-handle').exists()).toBe(true);

    await wrapper.find('[aria-label="Minimize editor"]').trigger('click');
    expect(wrapper.emitted('close')).toEqual([[]]);
    expect(layout).toHaveBeenCalled();
  });

  it('does not request Git changes for the generic home root', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    mount(EditorPanel, { props: { visible: true, cwd: '~' } });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/files/tree')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/git/changes'))).toBe(false);
  });

  it('resolves relative images from the markdown file directory', async () => {
    const markdown = [
      '![Daily chart](assets/daily%20chart.png)',
      '![Parent chart](../shared/orders.png)',
      '![Remote chart](https://example.com/chart.png)',
    ].join('\n');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      if (String(url).startsWith('/api/files/read')) {
        return { ok: true, json: async () => ({ content: markdown, mtime: 1 }) };
      }
      if (String(url).startsWith('/api/git/changes')) {
        return { ok: true, json: async () => ({ changes: {} }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    vi.spyOn(monaco.editor, 'createModel').mockReturnValue({
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
      getValue: vi.fn(() => markdown),
      dispose: vi.fn(),
    } as any);

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await wrapper.vm.openFile('/project/notes/report.md');
    await wrapper.vm.$nextTick();

    const images = wrapper.find('.markdown-preview').findAll('img');
    expect(images.map(image => image.attributes('src'))).toEqual([
      '/api/files/raw?path=%2Fproject%2Fnotes%2Fassets%2Fdaily%20chart.png',
      '/api/files/raw?path=%2Fproject%2Fnotes%2F..%2Fshared%2Forders.png',
      'https://example.com/chart.png',
    ]);
  });

  it('renders markdown frontmatter containing angle-bracket placeholders without hiding the body', async () => {
    const markdown = [
      '---',
      'name: book-narration-script',
      'description: Generate from local downloads/books/<title>/ metadata/raw text.',
      '---',
      '',
      '# Book Narration Script Generator',
      '',
      'You generate short-video narration assets from a local book metadata directory.',
    ].join('\n');

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      if (String(url).startsWith('/api/files/read')) {
        return { ok: true, json: async () => ({ content: markdown, mtime: 1 }) };
      }
      if (String(url).startsWith('/api/git/changes')) {
        return { ok: true, json: async () => ({ changes: {} }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    vi.spyOn(monaco.editor, 'createModel').mockReturnValue({
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
      getValue: vi.fn(() => markdown),
      dispose: vi.fn(),
    } as any);

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await wrapper.vm.openFile('/project/SKILL.md');
    await wrapper.vm.$nextTick();

    const preview = wrapper.find('.markdown-preview');
    const metadataTable = preview.find('table.markdown-frontmatter');
    expect(metadataTable.exists()).toBe(true);
    expect(metadataTable.findAll('tr')).toHaveLength(2);
    expect(metadataTable.text()).toContain('name');
    expect(metadataTable.text()).toContain('book-narration-script');
    expect(metadataTable.html()).toContain('&lt;title&gt;');
    expect(metadataTable.html()).not.toContain('<title>');
    expect(preview.find('h1').text()).toBe('Book Narration Script Generator');
    expect(preview.text()).toContain('You generate short-video narration assets');
  });

  it('lets Monaco infer most languages from the file URI and highlights Vue as HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      if (String(url).startsWith('/api/files/read')) {
        return { ok: true, json: async () => ({ content: 'name: demo\n', mtime: 1 }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const createModelSpy = vi.spyOn(monaco.editor, 'createModel');
    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await wrapper.vm.openFile('/project/config.yml');
    await wrapper.vm.openFile('/project/script.sh');
    await wrapper.vm.openFile('/project/Main.java');
    await wrapper.vm.openFile('/project/App.vue');

    expect(createModelSpy).toHaveBeenCalledWith('name: demo\n', undefined, { path: '/project/config.yml' });
    expect(createModelSpy).toHaveBeenCalledWith('name: demo\n', undefined, { path: '/project/script.sh' });
    expect(createModelSpy).toHaveBeenCalledWith('name: demo\n', undefined, { path: '/project/Main.java' });
    expect(createModelSpy).toHaveBeenCalledWith('name: demo\n', 'html', { path: '/project/App.vue' });
  });

  it('shows a toast when opening a missing file', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      if (String(url).startsWith('/api/files/read')) {
        return { ok: false, status: 404, json: async () => ({ error: 'File not found' }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const createModelSpy = vi.spyOn(monaco.editor, 'createModel');
    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await wrapper.vm.openFile('/project/missing.ts');
    await wrapper.vm.$nextTick();

    expect(createModelSpy).not.toHaveBeenCalled();
    const toast = wrapper.find('.editor-toast.error');
    expect(toast.exists()).toBe(true);
    expect(toast.text()).toBe('File does not exist: /project/missing.ts');
  });

  it('shows the workspace-relative open file path in the styled tab tooltip', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return {
          ok: true,
          json: async () => ({ tree: [] }),
        };
      }
      if (String(url).startsWith('/api/files/read')) {
        return {
          ok: true,
          json: async () => ({ content: 'export const answer = 42;\n', mtime: 1 }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    vi.spyOn(monaco.editor, 'create').mockReturnValue({
      addCommand: vi.fn(),
      addAction: vi.fn(),
      setModel: vi.fn(),
      getValue: vi.fn(() => ''),
      dispose: vi.fn(),
      layout: vi.fn(),
    } as any);
    vi.spyOn(monaco.editor, 'createModel').mockReturnValue({
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    } as any);

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/files/tree?path=%2Fproject&depth=1&hidden=false');
    });

    await wrapper.vm.openFile('/project/server/src/index.ts');
    await wrapper.vm.$nextTick();

    const tab = wrapper.find('.editor-tabs .tab');
    expect(tab.text()).toContain('index.ts');
    expect(tab.classes()).not.toContain('tooltip');
    expect(tab.attributes('title')).toBeUndefined();
    expect(wrapper.find('.editor-tab-tooltip').exists()).toBe(false);

    await tab.trigger('mouseenter');

    const tooltip = wrapper.find('.editor-tab-tooltip');
    expect(tooltip.exists()).toBe(true);
    expect(tooltip.text()).toBe('server/src/index.ts');

    await tab.trigger('mouseleave');
    expect(wrapper.find('.editor-tab-tooltip').exists()).toBe(false);
  });

  it('adds an open tab as a workspace-relative chat reference and copies its relative path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) return { ok: true, json: async () => ({ tree: [] }) };
      if (String(url).startsWith('/api/files/read')) return { ok: true, json: async () => ({ content: 'export {}', mtime: 1 }) };
      if (String(url).startsWith('/api/git/changes')) return { ok: true, json: async () => ({ changes: {} }) };
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(EditorPanel, { props: { visible: true, cwd: '/project' } });
    await wrapper.vm.openFile('/project/src/demo.ts');

    await wrapper.find('.editor-tabs .tab').trigger('contextmenu', { clientX: 10, clientY: 20 });
    expect(wrapper.find('.tab-context-menu').text()).toContain('Rename');
    expect(wrapper.find('.tab-context-menu').text()).toContain('Copy relative path');
    await wrapper.find('.tab-context-menu button').trigger('click');
    expect(wrapper.emitted('addReference')).toEqual([['src/demo.ts']]);

    await wrapper.find('.editor-tabs .tab').trigger('contextmenu', { clientX: 10, clientY: 20 });
    await wrapper.findAll('.tab-context-menu button')[1].trigger('click');
    expect(writeText).toHaveBeenCalledWith('src/demo.ts');
  });

  it('closes other open tabs from the tab context menu', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) return { ok: true, json: async () => ({ tree: [] }) };
      if (String(url).startsWith('/api/files/read')) return { ok: true, json: async () => ({ content: 'export {}', mtime: 1 }) };
      if (String(url).startsWith('/api/git/changes')) return { ok: true, json: async () => ({ changes: {} }) };
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(EditorPanel, { props: { visible: true, cwd: '/project' } });
    await wrapper.vm.openFile('/project/src/one.ts');
    await wrapper.vm.openFile('/project/src/two.ts');
    await wrapper.vm.openFile('/project/src/three.ts');
    await wrapper.vm.$nextTick();

    await wrapper.findAll('.editor-tabs .tab')[1].trigger('contextmenu', { clientX: 10, clientY: 20 });
    const closeOthers = wrapper.findAll('.tab-context-menu button').find(button => button.text() === 'Close others');
    expect(closeOthers).toBeDefined();
    await closeOthers!.trigger('click');
    await wrapper.vm.$nextTick();

    const remainingTabs = wrapper.findAll('.editor-tabs .tab');
    expect(remainingTabs).toHaveLength(1);
    expect(remainingTabs[0].text()).toContain('two.ts');
  });

  it('downloads files from tab and file-tree context menus and folders as zip files', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const value = String(url);
      if (value.startsWith('/api/files/tree')) {
        return {
          ok: true,
          json: async () => ({ tree: [
            { name: 'src', path: '/project/src', type: 'directory' },
            { name: 'demo.ts', path: '/project/demo.ts', type: 'file' },
          ] }),
        };
      }
      if (value.startsWith('/api/files/read')) return { ok: true, json: async () => ({ content: 'export {}', mtime: 1 }) };
      if (value.startsWith('/api/files/download')) return { ok: true, blob: async () => new Blob(['content']) };
      if (value.startsWith('/api/git/changes')) return { ok: true, json: async () => ({ changes: {} }) };
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const wrapper = mount(EditorPanel, { props: { visible: true, cwd: '/project' } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('demo.ts'));
    await wrapper.vm.openFile('/project/demo.ts');

    await wrapper.find('.editor-tabs .tab').trigger('contextmenu', { clientX: 10, clientY: 20 });
    const tabDownload = wrapper.findAll('.tab-context-menu button').find(button => button.text() === 'Download');
    expect(tabDownload).toBeDefined();
    await tabDownload!.trigger('click');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/files/download?path=%2Fproject%2Fdemo.ts'));

    await wrapper.find('.tree-node.directory').trigger('contextmenu', { clientX: 10, clientY: 20 });
    const folderDownload = wrapper.findAll('.file-context-menu button').find(button => button.text() === 'Download');
    expect(folderDownload).toBeDefined();
    await folderDownload!.trigger('click');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/files/download?path=%2Fproject%2Fsrc'));

    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it('applies git change decorations for the opened file', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/files/tree')) {
        return { ok: true, json: async () => ({ tree: [] }) };
      }
      if (String(url).startsWith('/api/files/read')) {
        return { ok: true, json: async () => ({ content: 'one\ntwo\nthree\n', mtime: 1 }) };
      }
      if (String(url).startsWith('/api/git/changes')) {
        return {
          ok: true,
          json: async () => ({
            changes: {
              'src/demo.ts': [
                { start: 2, end: 2, type: 'modified' },
                { start: 3, end: 3, type: 'added' },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const decorationsSet = vi.fn();
    let currentModel: any = null;
    vi.spyOn(monaco.editor, 'create').mockReturnValue({
      addCommand: vi.fn(),
      addAction: vi.fn(),
      setModel: vi.fn((model) => { currentModel = model; }),
      getModel: vi.fn(() => currentModel),
      getValue: vi.fn(() => ''),
      createDecorationsCollection: vi.fn(() => ({ set: decorationsSet, clear: vi.fn() })),
      dispose: vi.fn(),
      layout: vi.fn(),
    } as any);
    vi.spyOn(monaco.editor, 'createModel').mockReturnValue({
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
      getLineCount: vi.fn(() => 3),
      dispose: vi.fn(),
    } as any);

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await wrapper.vm.openFile('/project/src/demo.ts');

    await vi.waitFor(() => {
      expect(decorationsSet).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ options: expect.objectContaining({ linesDecorationsClassName: 'git-change-modified' }) }),
        expect.objectContaining({ options: expect.objectContaining({ linesDecorationsClassName: 'git-change-added' }) }),
      ]));
    });
  });

  it('keeps expanded folders open when the file tree is refreshed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(String(url), 'http://localhost').searchParams.get('path');
      if (String(url).startsWith('/api/files/tree')) {
        if (path === '/project') {
          return { ok: true, json: async () => ({ tree: [{ name: 'src', path: '/project/src', type: 'directory' }] }) };
        }
        if (path === '/project/src') {
          return { ok: true, json: async () => ({ tree: [{ name: 'index.ts', path: '/project/src/index.ts', type: 'file' }] }) };
        }
      }
      return { ok: true, json: async () => ({ changes: {} }) };
    }));

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await vi.waitFor(() => expect(wrapper.text()).toContain('src'));
    await wrapper.find('.tree-node.directory').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('index.ts'));

    await wrapper.find('[aria-label="Refresh files"]').trigger('click');

    await vi.waitFor(() => expect(wrapper.text()).toContain('index.ts'));
    expect(wrapper.find('.tree-node.directory + div').exists()).toBe(true);
  });

  it('locates the active tab in the file tree by expanding ancestors and scrolling to it', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(String(url), 'http://localhost').searchParams.get('path');
      if (String(url).startsWith('/api/files/tree')) {
        if (path === '/project') {
          return {
            ok: true,
            json: async () => ({ tree: [{ name: 'src', path: '/project/src', type: 'directory' }] }),
          };
        }
        if (path === '/project/src') {
          return {
            ok: true,
            json: async () => ({ tree: [{ name: 'components', path: '/project/src/components', type: 'directory' }] }),
          };
        }
        if (path === '/project/src/components') {
          return {
            ok: true,
            json: async () => ({ tree: [{ name: 'Editor.vue', path: '/project/src/components/Editor.vue', type: 'file' }] }),
          };
        }
      }
      if (String(url).startsWith('/api/files/read')) {
        return {
          ok: true,
          json: async () => ({ content: '<template />\n', mtime: 1 }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    vi.spyOn(monaco.editor, 'create').mockReturnValue({
      addCommand: vi.fn(),
      addAction: vi.fn(),
      setModel: vi.fn(),
      getValue: vi.fn(() => ''),
      dispose: vi.fn(),
      layout: vi.fn(),
    } as any);
    vi.spyOn(monaco.editor, 'createModel').mockReturnValue({
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    } as any);

    const wrapper = mount(EditorPanel, {
      props: { visible: true, cwd: '/project' },
    });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/files/tree?path=%2Fproject&depth=1&hidden=false');
    });

    await wrapper.vm.openFile('/project/src/components/Editor.vue');
    await wrapper.find('[aria-label="Locate active file in file tree"]').trigger('click');

    await vi.waitFor(() => {
      expect(wrapper.find('[data-tree-current="true"]').text()).toContain('Editor.vue');
    });

    expect(wrapper.text()).toContain('components');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
  });
});
