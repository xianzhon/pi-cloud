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

  it('renders grouped options with descriptions and status badges', async () => {
    const wrapper = mount(CustomSelect, {
      props: {
        modelValue: 'connected',
        options: [
          {
            value: 'connected',
            label: 'Connected provider',
            description: '[connected]',
            status: 'Key configured',
            statusTone: 'success',
            group: 'Configured',
          },
          {
            value: 'available',
            label: 'Available provider',
            description: '[available]',
            status: 'Not configured',
            statusTone: 'muted',
            group: 'Available providers',
          },
        ],
      },
    });

    await wrapper.get('.custom-select-trigger').trigger('click');

    expect(wrapper.findAll('.custom-select-group').map((group) => group.text())).toEqual(['Configured', 'Available providers']);
    expect(wrapper.find('.custom-select-status-success').text()).toBe('Key configured');
    expect(wrapper.find('.custom-select-status-muted').text()).toBe('Not configured');
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
