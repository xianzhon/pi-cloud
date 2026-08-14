import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CustomSelect from './CustomSelect.vue';

describe('CustomSelect', () => {
  it('filters options while entering a branch search manually', async () => {
    const wrapper = mount(CustomSelect, {
      props: {
        modelValue: '',
        options: [
          { value: 'main', label: 'main' },
          { value: 'develop', label: 'develop' },
        ],
        searchable: true,
      },
    });

    await wrapper.get('input').setValue('dev');

    expect(wrapper.findAll('.custom-select-option').map((option) => option.text())).toEqual(['develop']);
  });

  it('closes a searchable list after selecting an option with the mouse', async () => {
    const wrapper = mount(CustomSelect, {
      props: {
        modelValue: '',
        options: [
          { value: 'main', label: 'main' },
          { value: 'develop', label: 'develop' },
        ],
        searchable: true,
      },
    });

    await wrapper.get('input').trigger('click');
    await wrapper.findAll('.custom-select-option')[1].trigger('click');

    expect(wrapper.find('.custom-select-list').exists()).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toEqual([['develop']]);
  });
});
