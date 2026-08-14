import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SkillPicker from './SkillPicker.vue';

const skills = [
  { name: 'brainstorming', description: 'creative work' },
  { name: 'systematic-debugging', description: 'bug fixing' },
];

describe('SkillPicker', () => {
  it('filters available skills by search text, toggles selection, and shows descriptions inline', async () => {
    const wrapper = mount(SkillPicker, {
      props: {
        skills,
        modelValue: ['brainstorming'],
      },
    });

    expect(wrapper.text()).toContain('1 selected · 2 available');
    expect(wrapper.text()).toContain('brainstorming');
    expect(wrapper.text()).toContain('systematic-debugging');
    expect(wrapper.text()).toContain('creative work');
    expect(wrapper.text()).toContain('bug fixing');

    await wrapper.find('.skill-picker-search').setValue('debug');

    expect(wrapper.text()).toContain('systematic-debugging');
    expect(wrapper.text()).not.toContain('brainstorming');

    await wrapper.find('.skill-option-checkbox').setValue(true);
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['brainstorming', 'systematic-debugging']]);
  });

  it('groups selected visible skills before available skills', async () => {
    const wrapper = mount(SkillPicker, {
      props: {
        skills: [
          { name: 'animate', description: 'motion' },
          { name: 'brainstorming', description: 'creative work' },
          { name: 'systematic-debugging', description: 'bug fixing' },
        ],
        modelValue: ['systematic-debugging'],
      },
    });

    expect(wrapper.findAll('.skill-picker-group-title').map((item) => item.text())).toEqual(['Selected', 'Available']);
    expect(wrapper.findAll('.skill-option-name').map((item) => item.text())).toEqual([
      'systematic-debugging',
      'animate',
      'brainstorming',
    ]);

    await wrapper.find('.skill-picker-search').setValue('ing');
    expect(wrapper.findAll('.skill-option-name').map((item) => item.text())).toEqual([
      'systematic-debugging',
      'brainstorming',
    ]);
  });

  it('offers bulk actions for visible skills and an empty search state', async () => {
    const wrapper = mount(SkillPicker, {
      props: {
        skills,
        modelValue: ['brainstorming'],
      },
    });

    await wrapper.find('.skill-picker-search').setValue('debug');
    await wrapper.findAll('.skill-picker-actions button')[0].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['brainstorming', 'systematic-debugging']]);

    await wrapper.findAll('.skill-picker-actions button')[2].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['brainstorming', 'systematic-debugging']]);

    await wrapper.setProps({ modelValue: ['brainstorming', 'systematic-debugging'] });
    await wrapper.findAll('.skill-picker-actions button')[1].trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]]);

    await wrapper.find('.skill-picker-search').setValue('missing');
    expect(wrapper.text()).toContain('No skills match “missing”.');
  });
});
