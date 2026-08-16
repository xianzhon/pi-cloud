import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalPanel from './TerminalPanel.vue';

describe('TerminalPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    visible: true,
    mode: 'docked' as const,
    isMaximized: false,
    isFloating: false,
    sessions: [],
    activeId: null,
    terminalHeight: 300,
    floatPanelStyle: {},
    resizeDirections: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
    interaction: { active: false, mode: null, direction: null },
  };

  it('renders the docked panel with correct height', () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    const panel = wrapper.find('.terminal-panel');
    expect(panel.exists()).toBe(true);
    expect(panel.attributes('style')).toContain('--terminal-panel-height: 300px');
  });

  it('shows empty state when no sessions', () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    expect(wrapper.find('.terminal-empty').exists()).toBe(true);
    expect(wrapper.find('.terminal-empty').text()).toContain('No terminals');
    expect(wrapper.find('.terminal-tab-new').exists()).toBe(true);
  });

  it('renders terminal tabs for multiple sessions', () => {
    const sessions = [
      { terminal_id: 't1', label: 'zsh', terminal: null, hostEl: null, fitAddon: null, resizeObserver: null, history: [], pending_output: [] },
      { terminal_id: 't2', label: 'bash', terminal: null, hostEl: null, fitAddon: null, resizeObserver: null, history: [], pending_output: [] },
    ];
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, sessions, activeId: 't1' },
    });
    const tabs = wrapper.findAll('.terminal-tab:not(.terminal-tab-new)');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].text()).toContain('zsh');
    expect(tabs[1].text()).toContain('bash');
    expect(tabs[0].classes()).toContain('active');
    expect(wrapper.find('.terminal-tab-new').exists()).toBe(true);
  });

  it('emits switch when clicking a tab', async () => {
    const sessions = [
      { terminal_id: 't1', label: 'zsh', terminal: null, hostEl: null, fitAddon: null, resizeObserver: null, history: [], pending_output: [] },
      { terminal_id: 't2', label: 'bash', terminal: null, hostEl: null, fitAddon: null, resizeObserver: null, history: [], pending_output: [] },
    ];
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, sessions, activeId: 't1' },
    });
    await wrapper.findAll('.terminal-tab')[1].trigger('click');
    expect(wrapper.emitted('switch')).toEqual([['t2']]);
  });

  it('emits createTerminal when clicking new tab button', async () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    await wrapper.find('.terminal-tab-new').trigger('click');
    expect(wrapper.emitted('createTerminal')).toBeTruthy();
  });

  it('emits createTerminal from the empty state fallback', async () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    await wrapper.find('.terminal-empty-create').trigger('click');
    expect(wrapper.emitted('createTerminal')).toBeTruthy();
  });

  it('emits close when clicking minimize button', async () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    const btns = wrapper.findAll('.terminal-panel-actions .icon-btn');
    await btns[1].trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('emits toggleMaximize when clicking maximize button', async () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    const maximizeBtn = wrapper.find('.maximize-btn');
    await maximizeBtn.trigger('click');
    expect(wrapper.emitted('toggleMaximize')).toBeTruthy();
  });

  it('emits popOut when clicking pop-out button in docked mode', async () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    const btns = wrapper.findAll('.terminal-panel-actions .icon-btn');
    await btns[0].trigger('click');
    expect(wrapper.emitted('popOut')).toBeTruthy();
  });

  it('emits dock when clicking dock button in floating mode', async () => {
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, mode: 'floating', isFloating: true, floatPanelStyle: { top: '100px', left: '100px', width: '800px', height: '400px', zIndex: '1100' } },
    });
    const btns = wrapper.findAll('.terminal-panel-actions .icon-btn');
    await btns[0].trigger('click');
    expect(wrapper.emitted('dock')).toBeTruthy();
  });

  it('emits closeTerminal when clicking tab close button', async () => {
    const sessions = [
      { terminal_id: 't1', label: 'zsh', terminal: null, hostEl: null, fitAddon: null, resizeObserver: null, history: [], pending_output: [] },
    ];
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, sessions, activeId: 't1' },
    });
    await wrapper.find('.terminal-tab-close').trigger('click');
    expect(wrapper.emitted('closeTerminal')).toEqual([['t1']]);
  });

  it('applies floating class when in floating mode', () => {
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, mode: 'floating', isFloating: true, floatPanelStyle: { top: '100px', left: '100px', width: '800px', height: '400px', zIndex: '1100' } },
    });
    expect(wrapper.find('.terminal-panel').classes()).toContain('terminal-panel-floating');
  });

  it('applies maximized class when maximized', () => {
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, isMaximized: true, mode: 'maximized' },
    });
    expect(wrapper.find('.terminal-panel').classes()).toContain('terminal-panel-maximized');
  });

  it('has a docked resize handle when docked', () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    expect(wrapper.find('.resize-docked').exists()).toBe(true);
  });

  it('clears the docked divider highlight when the window blurs', async () => {
    const wrapper = mount(TerminalPanel, { props: defaultProps });
    const handle = wrapper.find('.resize-docked');

    await handle.trigger('mousedown', { clientY: 300 });
    expect(handle.classes()).toContain('is-resizing');

    window.dispatchEvent(new Event('blur'));
    await wrapper.vm.$nextTick();
    expect(handle.classes()).not.toContain('is-resizing');
  });

  it('has 8-direction resize handles when floating', () => {
    const wrapper = mount(TerminalPanel, {
      props: { ...defaultProps, mode: 'floating', isFloating: true, floatPanelStyle: { top: '100px', left: '100px', width: '800px', height: '400px', zIndex: '1100' } },
    });
    const handles = wrapper.findAll('.resize-handle');
    expect(handles).toHaveLength(8);
  });
});
