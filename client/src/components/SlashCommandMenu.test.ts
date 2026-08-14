import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import SlashCommandMenu from './SlashCommandMenu.vue';

const commands = [
  {
    id: 'skill-frontend-design',
    label: '/skill frontend-design',
    insertText: '/skill frontend-design ',
    description: 'Use frontend design skill',
    category: 'skill' as const,
    aliases: ['ui'],
  },
  {
    id: 'extensions',
    label: '/extensions',
    insertText: '/extensions ',
    description: 'Ask about extensions',
    category: 'extension' as const,
  },
];

describe('SlashCommandMenu', () => {
  it('renders command labels, descriptions, and categories', () => {
    const wrapper = mount(SlashCommandMenu, {
      props: { commands, activeIndex: 0 },
    });

    expect(wrapper.text()).toContain('/skill frontend-design');
    expect(wrapper.text()).toContain('Use frontend design skill');
    expect(wrapper.text()).toContain('skill');
    expect(wrapper.find('[aria-selected="true"]').text()).toContain('/skill frontend-design');
  });

  it('emits select when a command is clicked', async () => {
    const wrapper = mount(SlashCommandMenu, {
      props: { commands, activeIndex: 0 },
    });

    await wrapper.findAll('button')[1].trigger('click');

    expect(wrapper.emitted('select')?.[0]).toEqual([commands[1]]);
  });

  it('scrolls the active item into view when activeIndex changes', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });

    const longCommands = Array.from({ length: 10 }, (_, index) => ({
      id: `command-${index}`,
      label: `/command-${index}`,
      insertText: `/command-${index} `,
      description: `Command ${index}`,
      category: 'built-in' as const,
    }));

    const wrapper = mount(SlashCommandMenu, {
      props: { commands: longCommands, activeIndex: 0 },
    });

    scrollIntoView.mockClear();
    await wrapper.setProps({ activeIndex: 7 });
    await nextTick();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
