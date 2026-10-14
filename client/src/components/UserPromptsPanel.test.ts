import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import UserPromptsPanel from './UserPromptsPanel.vue';

const builtIn = { id: 'builtin', name: 'Task Inbox', content: 'Save a task.', builtIn: true, enabled: true, createdAt: '', updatedAt: '' };
const user = { ...builtIn, id: 'user', name: 'Review', builtIn: false };

describe('UserPromptsPanel', () => {
  it('distinguishes built-ins, allows editing and disabling, and only deletes user prompts', async () => {
    const wrapper = mount(UserPromptsPanel, { props: { prompts: [builtIn, user] } });
    const cards = wrapper.findAll('.user-prompt-card');
    expect(cards[0]!.text()).toContain('Built-in');
    expect(cards[0]!.find('.danger').exists()).toBe(false);
    expect(cards[1]!.find('.danger').exists()).toBe(true);
    await cards[0]!.find('button[aria-label="Edit prompt"]').trigger('click');
    await wrapper.find('textarea').setValue('Edited task prompt.');
    await wrapper.find('form').trigger('submit');
    const event = wrapper.emitted('updatePrompt')![0]!;
    expect(event[0]).toEqual({ id: 'builtin', changes: { name: 'Task Inbox', content: 'Edited task prompt.' } });
    (event[1] as () => void)();
    await wrapper.vm.$nextTick();
    await cards[0]!.findAll('button').find((button) => button.text() === 'Disable')!.trigger('click');
    expect(wrapper.emitted('updatePrompt')![1]![0]).toEqual({ id: 'builtin', changes: { name: 'Task Inbox', content: 'Save a task.', enabled: false } });
  });

  it('emits the combined order and permits re-enabling disabled built-ins', async () => {
    const wrapper = mount(UserPromptsPanel, { props: { prompts: [{ ...builtIn, enabled: false }, user] } });
    expect(wrapper.text()).toContain('Disabled');
    await wrapper.find('button[aria-label="Move prompt down"]').trigger('click');
    const event = wrapper.emitted('reorderPrompts')![0]!;
    expect(event[0]).toEqual(['user', 'builtin']);
    (event[1] as () => void)();
    await wrapper.vm.$nextTick();
    await wrapper.findAll('button').find((button) => button.text() === 'Enable')!.trigger('click');
    expect(wrapper.emitted('updatePrompt')![0]![0]).toMatchObject({ changes: { enabled: true } });
  });
});
