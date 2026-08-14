import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import TaskQueuePanel from './TaskQueuePanel.vue';

const tasks = ref<any[]>([]);
const scope = ref<'project' | 'all'>('project');
const status = ref<'waiting' | 'started' | 'completed'>('waiting');
const loading = ref(false);
const error = ref('');
const startingTaskId = ref<string | null>(null);
const load = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const start = vi.fn();
const complete = vi.fn();
const previewIssue = vi.fn();
const createIssue = vi.fn();
const generateIssueContent = vi.fn();

vi.mock('../composables/useProjectTasks', () => ({
  useProjectTasks: () => ({ tasks, scope, status, loading, error, startingTaskId, load, create, update, remove, start, complete }),
}));

vi.mock('../composables/useGitHosting', () => ({
  useGitHosting: () => ({ previewIssue, createIssue, generateIssueContent }),
}));

vi.mock('./TaskEditorDialog.vue', () => ({
  default: {
    props: ['visible', 'task'],
    emits: ['close', 'save'],
    template: '<div v-if="visible" class="task-editor-stub"><button class="editor-save" @click="$emit(\'save\', { title: \'Saved\' })">save</button></div>',
  },
}));

const issuePreview = { owner: 'earendil', repo: 'pi-webui', title: 'Waiting task', body: 'Implement it' };
const createdIssue = {
  owner: 'earendil',
  repo: 'pi-webui',
  number: 42,
  url: 'https://git.example/issue/42',
  createdAt: '2026-07-14T00:00:00.000Z',
};
const waitingTask = {
  id: 'task-1', projectPath: '/repo/app', title: 'Waiting task', prompt: 'Implement it', notes: 'private',
  status: 'waiting', agentProfileId: 'codex', modelProvider: 'openai', modelId: 'gpt-5.4', skillMode: 'all', skills: [],
  worktree: { mode: 'none' }, sessionId: null, giteaIssue: null, createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z', startedAt: null, completedAt: null,
};

function mountPanel() {
  return mount(TaskQueuePanel, {
    props: { clientId: 'client-1', currentProjectPath: '/repo/app', selectedAgentProfileId: 'codex', presets: [], loadPresets: async () => {} },
    global: { stubs: { Teleport: true, Transition: false } },
  });
}

describe('TaskQueuePanel', () => {
  beforeEach(() => {
    tasks.value = [{ ...waitingTask }];
    scope.value = 'project';
    status.value = 'waiting';
    loading.value = false;
    error.value = '';
    startingTaskId.value = null;
    vi.clearAllMocks();
    start.mockResolvedValue({ task: { ...waitingTask, status: 'started', sessionId: 'session-1' }, sessionId: 'session-1', prompt: waitingTask.prompt });
    previewIssue.mockResolvedValue(issuePreview);
    createIssue.mockResolvedValue({ ...waitingTask, giteaIssue: createdIssue });
    generateIssueContent.mockResolvedValue({ title: 'Polished issue title', body: '## Summary\nPolished body' });
  });

  it('defaults to current-project waiting tasks and supports all-project labels', async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('Waiting task');
    expect(wrapper.find('.task-project').exists()).toBe(false);

    await wrapper.get('.scope-all').trigger('click');
    expect(scope.value).toBe('all');
    expect(wrapper.find('.task-project').text()).toContain('/repo/app');
  });

  it('starts a waiting task once and emits the result', async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-task-id="task-1"] .task-start').trigger('click');

    expect(start).toHaveBeenCalledWith('task-1');
    expect(wrapper.emitted('started')?.[0]?.[0]).toMatchObject({ sessionId: 'session-1' });
  });

  it('shows read-only actions for started and completed tasks', async () => {
    tasks.value = [{ ...waitingTask, status: 'started', sessionId: 'session-1' }];
    status.value = 'started';
    const wrapper = mountPanel();

    expect(wrapper.find('.task-edit').exists()).toBe(false);
    await wrapper.get('.task-open-session').trigger('click');
    await wrapper.get('.task-complete').trigger('click');
    expect(wrapper.emitted('openSession')).toEqual([['session-1']]);
    expect(complete).toHaveBeenCalledWith('task-1');

    tasks.value = [{ ...waitingTask, status: 'completed', sessionId: 'session-1' }];
    status.value = 'completed';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.task-complete').exists()).toBe(false);
    expect(wrapper.find('.task-open-session').exists()).toBe(true);
  });

  it('opens the editor for new/edit and persists through the composable', async () => {
    const wrapper = mountPanel();
    await wrapper.get('.new-task').trigger('click');
    expect(wrapper.find('.task-editor-stub').exists()).toBe(true);
    await wrapper.get('.editor-save').trigger('click');
    expect(create).toHaveBeenCalled();

    await wrapper.get('[aria-label="Edit task"]').trigger('click');
    await wrapper.get('.editor-save').trigger('click');
    expect(update).toHaveBeenCalledWith('task-1', { title: 'Saved' });
  });

  it('polishes issue title and body with AI', async () => {
    const wrapper = mountPanel();

    await wrapper.get('.task-create-issue').trigger('click');
    await flushPromises();
    await wrapper.get('.issue-ai-generate').trigger('click');
    await flushPromises();

    expect(generateIssueContent).toHaveBeenCalledWith('client-1', 'task-1', issuePreview);
    const inputs = wrapper.findAll('.issue-preview-form input');
    expect((inputs[0].element as HTMLInputElement).value).toBe('earendil/pi-webui');
    expect((inputs[0].element as HTMLInputElement).readOnly).toBe(true);
    expect((inputs[1].element as HTMLInputElement).value).toBe('Polished issue title');
    expect((wrapper.find('.issue-preview-form textarea').element as HTMLTextAreaElement).value).toBe('## Summary\nPolished body');
  });

  it('shows a toast after creating an issue', async () => {
    const wrapper = mountPanel();

    await wrapper.get('.task-create-issue').trigger('click');
    await flushPromises();
    expect(previewIssue).toHaveBeenCalledWith('task-1');
    await wrapper.get('.btn-confirm').trigger('click');
    await flushPromises();

    expect(createIssue).toHaveBeenCalledWith('task-1', issuePreview);
    expect(wrapper.find('.task-toast.success').text()).toBe('Issue #42 created');
  });

  it('renders a created issue as a direct link', () => {
    tasks.value = [{ ...waitingTask, giteaIssue: createdIssue }];
    const wrapper = mountPanel();
    const issueLink = wrapper.find('.task-open-issue');

    expect(issueLink.element.tagName).toBe('A');
    expect(issueLink.text()).toBe('Issue #42');
    expect(issueLink.attributes('href')).toBe(createdIssue.url);
    expect(issueLink.attributes('target')).toBe('_blank');
  });

  it('shows the pull request status icon for a task session', () => {
    tasks.value = [{ ...waitingTask, status: 'started', sessionId: 'session-1', pullRequest: { number: 42, url: 'https://git.example/pr/42', status: 'merged' } }];
    const wrapper = mountPanel();
    const prStatus = wrapper.find('.task-pr-status');

    expect(prStatus.element.tagName).toBe('A');
    expect(prStatus.text()).toContain('PR #42');
    expect(prStatus.attributes('href')).toBe('https://git.example/pr/42');
    expect(prStatus.attributes('target')).toBe('_blank');
    expect(prStatus.classes()).toContain('merged');
    expect(prStatus.attributes('aria-label')).toBe('Pull request merged');
  });

  it('keeps task content and actions in distinct scan regions', () => {
    const wrapper = mountPanel();

    expect(wrapper.find('.task-row-main').exists()).toBe(true);
    expect(wrapper.find('.task-row-actions').exists()).toBe(true);
    expect(wrapper.find('.task-row-main .task-status').text()).toBe('waiting');
  });

  it('uses relative time and hides the default workspace location', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
    tasks.value = [{ ...waitingTask, createdAt: '2026-08-06T10:30:00.000Z' }];

    const wrapper = mountPanel();

    expect(wrapper.find('.task-created-at').text()).toBe('1h ago');
    expect(wrapper.find('.task-runtime').text()).toBe('codex · gpt-5.4');
    expect(wrapper.find('.task-runtime').attributes('title')).toBe('codex · openai/gpt-5.4');
    expect(wrapper.find('.task-work-location').exists()).toBe(false);
    vi.useRealTimers();
  });

  it.each([
    ['2026-07-30T12:00:00.000Z', '1 week ago'],
    ['2026-07-09T12:00:00.000Z', '4 weeks ago'],
    ['2026-06-07T12:00:00.000Z', '2 months ago'],
    ['2024-08-06T12:00:00.000Z', '2 years ago'],
  ])('formats older task times as %s', (createdAt, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
    tasks.value = [{ ...waitingTask, createdAt }];

    const wrapper = mountPanel();

    expect(wrapper.find('.task-created-at').text()).toBe(expected);
    vi.useRealTimers();
  });

  it('shows managed worktree details and expands long prompts on demand', async () => {
    tasks.value = [{
      ...waitingTask,
      worktree: { mode: 'managed', branchName: 'feature/queue' },
      prompt: 'A long task prompt '.repeat(20),
    }];

    const wrapper = mountPanel();

    expect(wrapper.find('.task-work-location').text()).toBe('worktree: feature/queue');
    expect(wrapper.find('.task-prompt').classes()).not.toContain('expanded');
    expect(wrapper.find('.task-prompt-toggle').text()).toBe('Show more');

    await wrapper.get('.task-prompt-toggle').trigger('click');
    expect(wrapper.find('.task-prompt').classes()).toContain('expanded');
    expect(wrapper.find('.task-prompt-toggle').text()).toBe('Show less');
  });

  it('groups primary and secondary task actions', () => {
    const wrapper = mountPanel();

    expect(wrapper.find('.task-primary-actions .task-start').exists()).toBe(true);
    expect(wrapper.find('.task-secondary-actions .task-start-new-tab').exists()).toBe(true);
    expect(wrapper.find('.task-secondary-actions .task-create-issue').exists()).toBe(true);
  });

  it('defaults wider and resizes from the left edge', async () => {
    const wrapper = mountPanel();
    expect(wrapper.attributes('style')).toContain('--task-queue-panel-width: 480px');

    await wrapper.get('.task-queue-resize-handle').trigger('mousedown', { clientX: 800 });
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }));
    await wrapper.vm.$nextTick();

    expect(wrapper.attributes('style')).toContain('--task-queue-panel-width: 580px');
    window.dispatchEvent(new MouseEvent('mouseup'));
  });
});
