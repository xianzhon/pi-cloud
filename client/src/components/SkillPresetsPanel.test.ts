import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SkillPresetsPanel from './SkillPresetsPanel.vue';

describe('SkillPresetsPanel', () => {
  it('shows existing presets and creates a new preset with the shared skill picker selection', async () => {
    const wrapper = mount(SkillPresetsPanel, {
      props: {
        presets: [
          { id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] },
          { id: 'preset-2', name: 'ui', mode: 'disabled', skills: ['frontend-design', 'minimalist-ui'] },
        ],
        availableSkills: [{ name: 'systematic-debugging', description: '...' }],
      },
    });

    expect(wrapper.text()).toContain('debug');
    expect(wrapper.text()).toContain('Enable only selected skills');
    expect(wrapper.text()).toContain('ui');
    expect(wrapper.text()).toContain('Disable selected skills');
    expect(wrapper.text()).toContain('frontend-design, minimalist-ui');

    await wrapper.find('.preset-name-input').setValue('debug');
    await wrapper.find('.preset-mode-enabled').setValue(true);
    await wrapper.find('.skill-option-checkbox').setValue(true);
    await wrapper.find('.preset-save-btn').trigger('click');

    expect(wrapper.emitted('createPreset')).toEqual([[
      { name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] },
    ]]);
  });

  it('loads an existing preset into the form and updates it', async () => {
    const wrapper = mount(SkillPresetsPanel, {
      props: {
        presets: [
          { id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] },
        ],
        availableSkills: [
          { name: 'systematic-debugging', description: '...' },
          { name: 'brainstorming', description: '...' },
        ],
      },
    });

    await wrapper.find('.preset-icon-btn[aria-label="Edit preset"]').trigger('click');

    expect((wrapper.find('.preset-name-input').element as HTMLInputElement).value).toBe('debug');
    expect((wrapper.find('.preset-mode-enabled').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('.preset-save-btn').text()).toBe('Save');
    expect(wrapper.find('.preset-cancel-btn').exists()).toBe(true);

    await wrapper.find('.preset-name-input').setValue('debug-2');
    await wrapper.findAll('.skill-option-checkbox')[1].setValue(true);
    await wrapper.find('.preset-save-btn').trigger('click');

    expect(wrapper.emitted('updatePreset')).toEqual([[(
      { id: 'preset-1', changes: { name: 'debug-2', mode: 'enabled', skills: ['systematic-debugging', 'brainstorming'] } }
    )]]);
    expect((wrapper.find('.preset-name-input').element as HTMLInputElement).value).toBe('');
    expect(wrapper.find('.preset-save-btn').text()).toBe('Save');
    expect(wrapper.find('.preset-cancel-btn').exists()).toBe(false);
  });

  it('emits delete for an existing preset', async () => {
    const wrapper = mount(SkillPresetsPanel, {
      props: {
        presets: [
          { id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] },
        ],
        availableSkills: [{ name: 'systematic-debugging', description: '...' }],
      },
    });

    await wrapper.find('.preset-icon-btn[aria-label="Delete preset"]').trigger('click');

    expect(wrapper.emitted('deletePreset')).toEqual([['preset-1']]);
  });
});
