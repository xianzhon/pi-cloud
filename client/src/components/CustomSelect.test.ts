import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
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

  it('supports keyboard navigation and selection for regular selects', async () => {
    const wrapper = mount(CustomSelect, {
      props: { modelValue: '', options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
      attachTo: document.body,
    });
    const trigger = wrapper.get('button.custom-select-trigger');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await trigger.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')).toEqual([['two']]);
    await trigger.trigger('keydown', { key: ' ' });
    await trigger.trigger('keydown', { key: 'ArrowUp' });
    await trigger.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.custom-select-list').exists()).toBe(false);
    wrapper.unmount();
  });

  it('handles searchable keyboard navigation, empty results, and outside clicks', async () => {
    const wrapper = mount(CustomSelect, {
      props: { modelValue: 'two', options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], searchable: true },
      attachTo: document.body,
    });
    const input = wrapper.get('input');
    await input.trigger('focus');
    await input.trigger('keydown', { key: 'ArrowUp' });
    await input.trigger('keydown', { key: 'Enter' });
    await input.setValue('missing');
    expect(wrapper.find('.custom-select-empty').exists()).toBe(true);
    await input.trigger('keydown', { key: 'ArrowDown' });
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.custom-select-list').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not open disabled controls and positions lists above when space is constrained', async () => {
    const disabled = mount(CustomSelect, { props: { modelValue: '', options: [], disabled: true } });
    await disabled.get('button').trigger('click');
    expect(disabled.find('.custom-select-list').exists()).toBe(false);

    const wrapper = mount(CustomSelect, { props: { modelValue: '', options: [{ value: 'one', label: 'One' }] }, attachTo: document.body });
    vi.spyOn(wrapper.get('button').element, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 740, left: 0, right: 100, width: 100, height: 40, x: 0, y: 700, toJSON() {} });
    await wrapper.get('button').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.custom-select-list').classes()).toContain('open-up');
    window.dispatchEvent(new Event('resize'));
    await wrapper.get('button.custom-select-trigger').trigger('click');
    wrapper.unmount();
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
