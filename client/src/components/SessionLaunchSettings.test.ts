import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import SessionLaunchSettings from './SessionLaunchSettings.vue';
import { defaultSessionLaunchValue, type SessionLaunchValue } from '../types/sessionLaunch';

function mountSettings(overrides: Record<string, unknown> = {}) {
  let value: SessionLaunchValue = defaultSessionLaunchValue();
  let wrapper: ReturnType<typeof mount>;
  wrapper = mount(SessionLaunchSettings, {
    props: {
      modelValue: value,
      models: [{ provider: 'openai', id: 'gpt-5.4', name: 'GPT 5.4' }],
      availableSkills: [{ name: 'brainstorming', description: 'Design first' }],
      presets: [{ id: 'preset-1', name: 'Focused', mode: 'enabled', skills: ['brainstorming'] }],
      branches: ['main', 'develop'],
      idPrefix: 'test',
      'onUpdate:modelValue': async (next: SessionLaunchValue) => {
        value = next;
        await wrapper.setProps({ modelValue: next });
      },
      ...overrides,
    },
  });
  return { wrapper, value: () => value };
}

describe('SessionLaunchSettings', () => {
  it('requires an explicit model when requested', async () => {
    const onValidity = vi.fn();
    const { wrapper } = mountSettings({ requireModel: true, onValidityChange: onValidity });
    expect(onValidity).toHaveBeenLastCalledWith(false);

    await wrapper.get('[aria-label="Session model"]').trigger('click');
    await wrapper.findAll('.custom-select-option')[0].trigger('click');

    expect(onValidity).toHaveBeenLastCalledWith(true);
  });

  it('resolves a selected preset into mode and skill names', async () => {
    const { wrapper, value } = mountSettings();

    await wrapper.get('input[name="test-session-mode"][value="preset"]').setValue(true);

    expect(value()).toMatchObject({
      skillSelection: 'preset',
      skillMode: 'enabled',
      skills: ['brainstorming'],
      presetId: 'preset-1',
    });
  });

  it('emits new and existing managed worktree payloads', async () => {
    const { wrapper, value } = mountSettings();

    await wrapper.get('input[name="test-work-location"][value="worktree"]').setValue(true);
    expect(wrapper.emitted('request-branches')).toHaveLength(1);
    await wrapper.get('#test-branch-name').setValue('feature/tasks');
    await wrapper.get('#test-base-branch').trigger('click');
    await wrapper.findAll('.custom-select-option').find((node) => node.text() === 'develop')!.trigger('click');
    expect(value().worktree).toEqual({ mode: 'managed', branchMode: 'new', branchName: 'feature/tasks', baseBranch: 'develop' });

    await wrapper.get('input[name="test-branch-mode"][value="existing"]').setValue(true);
    expect(wrapper.emitted('request-branches')).toHaveLength(2);
    await wrapper.get('#test-existing-branch').trigger('click');
    await wrapper.findAll('.custom-select-option').find((node) => node.text() === 'main')!.trigger('click');
    expect(value().worktree).toEqual({ mode: 'managed', branchMode: 'existing', branchName: 'main' });
  });

  it('requests branches for the new branch base selector when branch loading is lazy', async () => {
    const { wrapper } = mountSettings({ branches: [], currentBranch: 'main' });

    await wrapper.get('input[name="test-work-location"][value="worktree"]').setValue(true);

    expect(wrapper.emitted('request-branches')).toHaveLength(1);
    await wrapper.get('#test-base-branch').trigger('click');
    expect(wrapper.findAll('.custom-select-option').map((node) => node.text())).toEqual(['main']);
  });
});
