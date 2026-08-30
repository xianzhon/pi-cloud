import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import TaskEditorDialog from './TaskEditorDialog.vue';
import { invalidateLaunchResourceCache } from '../composables/useLaunchResourceCache';
import type { ProjectTask } from '../types/projectTask';

enableAutoUnmount(afterEach);

const profiles = [
  { id: 'codex', label: 'codex', path: '/profiles/codex', isDefault: false, defaultProvider: 'openai', defaultModel: 'gpt-5.4' },
  { id: 'claude', label: 'claude', path: '/profiles/claude', isDefault: false, defaultProvider: 'anthropic', defaultModel: 'sonnet' },
];

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

function stubResources() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tasks/polish') return ok({ content: { title: 'Polished queue task', prompt: 'Implement the task queue with clear acceptance criteria.' } });
    if (url.startsWith('/api/sessions/project-paths')) return ok({ projectPaths: ['/repo/app', '/repo/other'] });
    if (url === '/api/sessions/agent-profiles') return ok({ profiles });
    if (url.includes('/models')) {
      return ok({ models: url.includes('/claude/')
        ? [{ provider: 'anthropic', id: 'sonnet', current: true }]
        : [{ provider: 'openai', id: 'gpt-5.4', current: true }] });
    }
    if (url.includes('/skills?')) return ok({ skills: [{ name: 'brainstorming', description: 'Design first' }] });
    if (url.startsWith('/api/sessions/worktree-branches')) return ok({ branches: ['main', 'develop'] });
    if (url.startsWith('/api/sessions/worktree-copy-files')) return ok({ files: ['.env'] });
    if (url.startsWith('/api/sessions/git-status')) return ok({ isGitRepo: true, branch: 'main' });
    throw new Error(`Unexpected URL: ${url}`);
  }));
}

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(TaskEditorDialog, {
    props: {
      visible: true,
      clientId: 'client-1',
      currentProjectPath: '/repo/app',
      selectedAgentProfileId: 'codex',
      presets: [{ id: 'preset-1', name: 'Focused', mode: 'enabled', skills: ['brainstorming'] }],
      ...props,
    },
    global: { stubs: { Teleport: true, Transition: false } },
  });
}

const existingTask: ProjectTask = {
  id: 'task-1', projectPath: '/repo/other', title: 'Existing task', prompt: 'Existing prompt', notes: 'Private note',
  status: 'waiting', agentProfileId: 'claude', modelProvider: 'anthropic', modelId: 'sonnet',
  skillMode: 'disabled', skills: ['brainstorming'], worktree: { mode: 'none' }, sessionId: null, giteaIssue: null,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z', startedAt: null, completedAt: null,
};

describe('TaskEditorDialog', () => {
  beforeEach(() => {
    invalidateLaunchResourceCache();
    localStorage.clear();
    stubResources();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a task with prompt and private notes separated', async () => {
    const wrapper = mountEditor();
    await vi.waitFor(() => expect(wrapper.find('#task-title').exists()).toBe(true));
    await vi.waitFor(() => expect(wrapper.text()).toContain('gpt-5.4'));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/sessions/worktree-branches'))).toBe(false);

    await wrapper.get('#task-title').setValue('Fix queue');
    await wrapper.get('#task-prompt').setValue('Implement queue tasks');
    await wrapper.get('#task-notes').setValue('Do not send this');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      projectPath: '/repo/app', title: 'Fix queue', prompt: 'Implement queue tasks', notes: 'Do not send this',
      agentProfileId: 'codex', modelProvider: 'openai', modelId: 'gpt-5.4',
      skillMode: 'all', skills: [], worktree: { mode: 'none' },
    });
  });

  it('uses the cached skillset selection for a new task', async () => {
    localStorage.setItem('pi-cloud.newSessionOptions:/repo/app', JSON.stringify({
      mode: 'preset',
      selectedPresetId: 'preset-1',
    }));
    const wrapper = mountEditor();
    await vi.waitFor(() => expect((wrapper.get('input[name="task-session-mode"][value="preset"]').element as HTMLInputElement).checked).toBe(true));

    expect(wrapper.get('#task-preset').attributes('aria-label')).toBe('Saved preset');
    expect(wrapper.get('#task-preset').text()).toContain('Focused');
  });

  it('polishes raw prompt into a title and executable prompt', async () => {
    const wrapper = mountEditor();
    await vi.waitFor(() => expect(wrapper.text()).toContain('gpt-5.4'));

    await wrapper.get('#task-prompt').setValue('raw idea about task queue');
    await wrapper.get('.task-ai-polish').trigger('click');

    await vi.waitFor(() => expect((wrapper.get('#task-title').element as HTMLInputElement).value).toBe('Polished queue task'));
    expect((wrapper.get('#task-prompt').element as HTMLTextAreaElement).value).toBe('Implement the task queue with clear acceptance criteria.');
    expect(fetch).toHaveBeenCalledWith('/api/tasks/polish', expect.objectContaining({ method: 'POST' }));
  });

  it('defaults new tasks to the selected side-panel agent profile', async () => {
    const wrapper = mountEditor({ selectedAgentProfileId: 'claude' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/agent-profiles/claude/models')));

    await wrapper.get('#task-title').setValue('Claude task');
    await wrapper.get('#task-prompt').setValue('Use side-panel agent');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      agentProfileId: 'claude', modelProvider: 'anthropic', modelId: 'sonnet',
    });
  });

  it('stores a preset reference with its resolved skills', async () => {
    const wrapper = mountEditor();
    await vi.waitFor(() => expect(wrapper.find('input[name="task-session-mode"][value="preset"]').exists()).toBe(true));

    await wrapper.get('input[name="task-session-mode"][value="preset"]').setValue(true);
    await wrapper.get('#task-title').setValue('Preset task');
    await wrapper.get('#task-prompt').setValue('Use focused skills');
    await vi.waitFor(() => expect(wrapper.get('.task-save').attributes('disabled')).toBeUndefined());
    await wrapper.get('form').trigger('submit');

    const saved = wrapper.emitted('save')?.[0]?.[0] as Record<string, unknown>;
    expect(saved).toMatchObject({ skillMode: 'enabled', skills: ['brainstorming'], presetId: 'preset-1' });
  });

  it('restores a task preset when editing', async () => {
    const wrapper = mountEditor({ task: { ...existingTask, presetId: 'preset-1' } });
    await vi.waitFor(() => expect((wrapper.get('input[name="task-session-mode"][value="preset"]').element as HTMLInputElement).checked).toBe(true));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/agent-profiles/claude/models')));
    expect(wrapper.get('#task-preset').text()).toContain('Focused');
  });

  it('prefills an editable waiting task and reloads its profile resources', async () => {
    const wrapper = mountEditor({ task: existingTask });
    await vi.waitFor(() => expect((wrapper.get('#task-title').element as HTMLInputElement).value).toBe('Existing task'));

    expect((wrapper.get('#task-prompt').element as HTMLTextAreaElement).value).toBe('Existing prompt');
    expect((wrapper.get('#task-notes').element as HTMLTextAreaElement).value).toBe('Private note');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/agent-profiles/claude/models')));
    expect(wrapper.text()).toContain('sonnet');
  });

  it('loads launch resources once when reopening for a different task', async () => {
    const wrapper = mountEditor();
    await vi.waitFor(() => expect(wrapper.text()).toContain('gpt-5.4'));

    await wrapper.setProps({ visible: false });
    vi.mocked(fetch).mockClear();
    await wrapper.setProps({ visible: true, task: existingTask });

    await vi.waitFor(() => expect(wrapper.text()).toContain('sonnet'));
    const claudeModelLoads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/agent-profiles/claude/models'));
    expect(claudeModelLoads).toHaveLength(1);
  });

  it('uses the defined accent theme variable for the save button', () => {
    const source = readFileSync('src/components/TaskEditorDialog.vue', 'utf8');
    const saveButtonStyles = source.match(/\.task-editor-actions \.task-save \{([^}]*)\}/)?.[1] || '';

    expect(saveButtonStyles).toContain('var(--accent)');
    expect(saveButtonStyles).not.toContain('var(--accent-color)');
  });

  it('keeps save disabled until title, prompt, and model are available', async () => {
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('/models')) return ok({ models: [] }) as Response;
      if (String(url).startsWith('/api/sessions/project-paths')) return ok({ projectPaths: ['/repo/app'] }) as Response;
      if (String(url) === '/api/sessions/agent-profiles') return ok({ profiles }) as Response;
      if (String(url).includes('/skills?')) return ok({ skills: [] }) as Response;
      if (String(url).includes('worktree-branches')) return ok({ branches: ['main'] }) as Response;
      if (String(url).includes('worktree-copy-files')) return ok({ files: [] }) as Response;
      return ok({ isGitRepo: true, branch: 'main' }) as Response;
    });
    const wrapper = mountEditor();
    await vi.waitFor(() => expect(wrapper.find('.task-save').exists()).toBe(true));
    await wrapper.get('#task-title').setValue('Title');
    await wrapper.get('#task-prompt').setValue('Prompt');
    expect(wrapper.get('.task-save').attributes('disabled')).toBeDefined();
  });
});
