import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import NewSessionDialog from './NewSessionDialog.vue';

function mountDialog(props = {}) {
  return mount(NewSessionDialog, {
    props: {
      visible: true,
      projectPath: '/workspace',
      agentProfileLabel: 'default (~/.pi/agent)',
      availableSkills: [{ name: 'systematic-debugging', description: '...' }],
      presets: [],
      branches: ['main', 'develop'],
      ...props,
    },
    global: {
      stubs: {
        Teleport: true,
        Transition: false,
      },
    },
  });
}

describe('NewSessionDialog', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the first saved preset by default when preset mode is selected', async () => {
    const wrapper = mountDialog({
      presets: [
        { id: 'preset-1', name: 'Focused', mode: 'enabled', skills: ['systematic-debugging'] },
        { id: 'preset-2', name: 'Broad', mode: 'disabled', skills: ['frontend-design'] },
      ],
    });

    await wrapper.find('input[name="session-mode"][value="preset"]').setValue(true);
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([[
      { cwd: '/workspace', enabledSkills: ['systematic-debugging'], presetId: 'preset-1', worktree: { mode: 'none' } },
    ]]);
  });

  it('sends enabledSkills when custom enable-only mode is selected', async () => {
    const wrapper = mountDialog();

    await wrapper.find('input[name="session-mode"][value="custom"]').setValue(true);
    await wrapper.find('.custom-mode-enabled').setValue(true);
    await wrapper.find('.skill-option-checkbox').setValue(true);
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([[
      { cwd: '/workspace', enabledSkills: ['systematic-debugging'], worktree: { mode: 'none' } },
    ]]);
  });

  it('sends managed worktree options for a new branch', async () => {
    const wrapper = mountDialog();

    await wrapper.find('input[name="work-location"][value="worktree"]').setValue(true);
    await wrapper.find('#new-session-branch-name').setValue('feature/a');
    await wrapper.find('#new-session-base-branch').trigger('click');
    await wrapper.findAll('.custom-select-option').find((option) => option.text() === 'develop')!.trigger('click');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([[
      {
        cwd: '/workspace',
                worktree: {
          mode: 'managed',
          branchMode: 'new',
          branchName: 'feature/a',
          baseBranch: 'develop',
        },
      },
    ]]);
  });

  it('defaults the new worktree base branch to the current git branch', async () => {
    const wrapper = mountDialog({ currentBranch: 'develop' });

    await wrapper.find('input[name="work-location"][value="worktree"]').setValue(true);
    await wrapper.find('#new-session-branch-name').setValue('feature/a');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([[
      {
        cwd: '/workspace',
                worktree: {
          mode: 'managed',
          branchMode: 'new',
          branchName: 'feature/a',
          baseBranch: 'develop',
        },
      },
    ]]);
  });

  it('sends managed worktree options for an existing branch', async () => {
    const wrapper = mountDialog();

    await wrapper.find('input[name="work-location"][value="worktree"]').setValue(true);
    await wrapper.find('input[name="branch-mode"][value="existing"]').setValue(true);
    await wrapper.find('#new-session-existing-branch').trigger('click');
    await wrapper.findAll('.custom-select-option').find((option) => option.text() === 'develop')!.trigger('click');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([[
      {
        cwd: '/workspace',
                worktree: {
          mode: 'managed',
          branchMode: 'existing',
          branchName: 'develop',
        },
      },
    ]]);
  });

  it('hides work location choices when worktree branches cannot be loaded', async () => {
    const wrapper = mountDialog({ branches: [], branchesError: 'Failed to load branches' });

    expect(wrapper.text()).not.toContain('Where should this session work?');
    expect(wrapper.find('input[name="work-location"][value="worktree"]').exists()).toBe(false);

    await wrapper.find('form').trigger('submit');

    expect(wrapper.emitted('create')).toEqual([[{ cwd: '/workspace', worktree: { mode: 'none' } }]]);
  });

  it('restores saved session and skill options from localStorage', async () => {
    localStorage.setItem('pi-cloud.newSessionOptions:/workspace', JSON.stringify({
      mode: 'custom',
      customMode: 'enabled',
      selectedSkills: ['systematic-debugging'],
    }));

    const wrapper = mountDialog();

    expect((wrapper.find('input[name="session-mode"][value="custom"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.find('.custom-mode-enabled').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.find('.skill-option-checkbox').element as HTMLInputElement).checked).toBe(true);
  });

  it('does not restore session options from another project', async () => {
    localStorage.setItem('pi-cloud.newSessionOptions:/workspace', JSON.stringify({
      mode: 'custom',
      customMode: 'enabled',
      selectedSkills: ['systematic-debugging'],
      selectedPresetId: '',
    }));

    const wrapper = mountDialog({ projectPath: '/other-project' });

    expect((wrapper.find('input[name="session-mode"][value="all"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.findAll('.skill-option-checkbox')).toHaveLength(0);
  });

  it('saves session and skill options after creating a session', async () => {
    const wrapper = mountDialog();

    await wrapper.find('input[name="session-mode"][value="custom"]').setValue(true);
    await wrapper.find('.custom-mode-enabled').setValue(true);
    await wrapper.find('.skill-option-checkbox').setValue(true);
    await wrapper.find('form').trigger('submit');

    expect(JSON.parse(localStorage.getItem('pi-cloud.newSessionOptions:/workspace') || '{}')).toEqual({
      mode: 'custom',
      customMode: 'enabled',
      selectedSkills: ['systematic-debugging'],
      selectedPresetId: '',
    });
  });
});
