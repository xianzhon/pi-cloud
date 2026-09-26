import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { i18n } from '../i18n';
import MindMapVisualEditor from './MindMapVisualEditor.vue';

enableAutoUnmount(afterEach);
const source = 'mindmap\n  Root\n    One\n    Two\n';
const mountEditor = () => mount(MindMapVisualEditor, { props: { source }, global: { plugins: [i18n] } });

describe('mind map visual editing', () => {
  it('edits source, preserves history on own update and invalidates it on raw changes', async () => {
    const wrapper = mountEditor();
    expect(wrapper.findAll('.mindmap-toolbar > button').map(button => button.text())).toEqual(['Undo', 'Redo']);
    await wrapper.findAll('.mindmap-node')[1].trigger('dblclick');
    expect(wrapper.findAll('.mindmap-node')[1].find('input').exists()).toBe(true);
    await wrapper.find('#mindmap-label').setValue('Renamed');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    Renamed\n    Two\n']);
    await wrapper.setProps({ source: 'mindmap\n  Root\n    Renamed\n    Two\n' });
    await wrapper.findAll('.mindmap-toolbar > button')[0].trigger('click');
    expect(wrapper.emitted('change')?.[1]).toEqual([source]);
    await wrapper.setProps({ source: 'mindmap\n  Other\n' });
    expect(wrapper.findAll('.mindmap-node').map(node => node.text())).toEqual(['Other']);
    expect(wrapper.findAll('.mindmap-toolbar > button')[0].attributes('disabled')).toBeDefined();
  });

  it('fits the diagram at its center and preserves manual view after edits', async () => {
    const wrapper = mountEditor();
    expect((wrapper.find('.mindmap-item').element as HTMLElement).style.width).toBe('');
    const viewport = wrapper.find('.mindmap-viewport').element;
    Object.defineProperties(viewport, { clientWidth: { value: 900 }, clientHeight: { value: 500 } });
    await wrapper.find('.mindmap-view-controls button:last-child').trigger('click');
    const canvas = wrapper.find('.mindmap-canvas');
    const width = parseFloat((canvas.element as HTMLElement).style.width);
    const height = parseFloat((canvas.element as HTMLElement).style.height);
    const transform = canvas.attributes('style')!;
    const match = /translate\(([-\d.eE+]+)px, ([-\d.eE+]+)px\) scale\(([-\d.eE+]+)\)/.exec(transform)!;
    expect(match, transform).not.toBeNull();
    expect(Number(match![1]) + width * Number(match![3]) / 2).toBeCloseTo(450);
    expect(Number(match![2]) + height * Number(match![3]) / 2).toBeCloseTo(250);
    await wrapper.find('.mindmap-viewport').trigger('wheel', { deltaX: 20, deltaY: 10 });
    const panned = canvas.attributes('style');
    await wrapper.findAll('.mindmap-node')[1].trigger('dblclick');
    await wrapper.find('#mindmap-label').setValue('New label');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(canvas.attributes('style')).toBe(panned);
  });

  it('navigates, edits with shortcuts, and folds through a selected level', async () => {
    const wrapper = mount(MindMapVisualEditor, {
      props: { source: 'mindmap\n  Root\n    One\n      Child\n        Deep\n    Two\n' },
      global: { plugins: [i18n] },
    });
    const nodes = () => wrapper.findAll('.mindmap-node');
    const chooseLevel = async (label: string) => {
      await wrapper.get('button[aria-label="Show levels"]').trigger('click');
      const options = wrapper.findAll('.mindmap-levels [role="option"]');
      expect(options.map(option => option.text())).toContain(label);
      await options.find(option => option.text() === label)!.trigger('click');
    };
    await chooseLevel('Up to level 1');
    expect(nodes().map(node => node.attributes('aria-label'))).toEqual(['Root', 'One', 'Two']);
    await chooseLevel('Up to level 2');
    expect(nodes().map(node => node.attributes('aria-label'))).toEqual(['Root', 'One', 'Child', 'Two']);
    await chooseLevel('Up to level 3');
    expect(nodes()).toHaveLength(5);
    await nodes()[0].trigger('keydown', { key: 'ArrowLeft' });
    expect(nodes()[1].attributes('aria-pressed')).toBe('true');
    await nodes()[1].trigger('keydown', { key: 'ArrowLeft' });
    expect(nodes()[2].attributes('aria-pressed')).toBe('true');
    await nodes()[2].trigger('keydown', { key: 'ArrowRight' });
    expect(nodes()[1].attributes('aria-pressed')).toBe('true');
    await nodes()[1].trigger('keydown', { key: ' ' });
    expect(nodes()).toHaveLength(3);
    await nodes()[1].trigger('keydown', { key: ' ' });
    expect(nodes()).toHaveLength(5);
    await nodes()[1].trigger('keydown', { key: 'Tab' });
    await wrapper.find('#mindmap-label').setValue('Added');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[0]?.[0]).toContain('      Added\n');
    await wrapper.find('.mindmap-node.selected').trigger('keydown', { key: 'Enter' });
    await wrapper.find('#mindmap-label').setValue('Sibling');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[1]?.[0]).toContain('      Added\n      Sibling\n');
    await wrapper.find('.mindmap-node.selected').trigger('keydown', { key: 'F2' });
    await wrapper.find('#mindmap-label').setValue('Renamed');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[2]?.[0]).toContain('      Renamed\n');
  });

  it('navigates visually within a level and toward or away from the root on either side', async () => {
    const wrapper = mount(MindMapVisualEditor, {
      props: { source: 'mindmap\n  Root\n    Left A\n      Left Child\n    Right A\n      Right Child\n    Left B\n      Left B Child\n    Right B\n      Right B Child\n' },
      global: { plugins: [i18n] },
    });
    const node = (label: string) => wrapper.findAll('.mindmap-node').find(item => item.attributes('aria-label') === label)!;
    const press = async (label: string, key: string, expected: string) => {
      await node(label).trigger('keydown', { key });
      expect(node(expected).attributes('aria-pressed')).toBe('true');
    };
    await press('Root', 'ArrowLeft', 'Left A');
    await press('Left A', 'ArrowDown', 'Left B');
    await press('Left B', 'ArrowUp', 'Left A');
    await press('Left A', 'ArrowLeft', 'Left Child');
    await press('Left Child', 'ArrowDown', 'Left B Child');
    await press('Left B Child', 'ArrowRight', 'Left B');
    await press('Left B', 'ArrowRight', 'Root');
    await press('Root', 'ArrowRight', 'Right A');
    await press('Right A', 'ArrowDown', 'Right B');
    await press('Right B', 'ArrowRight', 'Right B Child');
    await press('Right B Child', 'ArrowUp', 'Right Child');
    await press('Right Child', 'ArrowLeft', 'Right A');
    await press('Right A', 'ArrowLeft', 'Root');
    await press('Root', 'ArrowUp', 'Root');
    await node('Left A').trigger('click');
    await node('Left A').trigger('keydown', { key: ' ' });
    await node('Root').trigger('click');
    await press('Root', 'ArrowLeft', 'Left A');
    await press('Left A', 'ArrowLeft', 'Left A');
  });

  it('expands a folded branch with the arrow pointing outward on either side', async () => {
    const wrapper = mount(MindMapVisualEditor, {
      props: { source: 'mindmap\n  Root\n    Left\n      Left Child\n    Right\n      Right Child\n' },
      global: { plugins: [i18n] },
    });
    const node = (label: string) => wrapper.findAll('.mindmap-node').find(item => item.attributes('aria-label') === label)!;
    for (const [label, key, child] of [['Left', 'ArrowLeft', 'Left Child'], ['Right', 'ArrowRight', 'Right Child']]) {
      await node(label).trigger('click');
      await node(label).element.parentElement!.querySelector<HTMLButtonElement>('.mindmap-fold')!.click();
      await wrapper.vm.$nextTick();
      expect(node(child)).toBeUndefined();
      await node(label).trigger('keydown', { key });
      expect(node(child).exists()).toBe(true);
      expect(node(label).attributes('aria-pressed')).toBe('true');
      await node(label).trigger('keydown', { key });
      expect(node(child).attributes('aria-pressed')).toBe('true');
    }
    expect(wrapper.emitted('change')).toBeUndefined();
  });

  it('places the add input at the child or following sibling position without changing source until submission', async () => {
    const wrapper = mountEditor();
    const nodes = () => wrapper.findAll('.mindmap-node');
    const item = (index: number) => nodes()[index].element.parentElement as HTMLElement;
    await nodes()[1].trigger('click');
    await nodes()[1].trigger('keydown', { key: 'Tab' });
    expect(nodes()).toHaveLength(4);
    expect(nodes()[1].find('input').exists()).toBe(false);
    expect(nodes()[2].find('input').exists()).toBe(true);
    expect(parseFloat(item(2).style.left)).toBeLessThan(parseFloat(item(1).style.left));
    expect(wrapper.emitted('change')).toBeUndefined();
    await wrapper.find('#mindmap-label').trigger('keydown', { key: 'Escape' });
    expect(nodes()).toHaveLength(3);
    await nodes()[1].trigger('keydown', { key: 'Enter' });
    expect(nodes()).toHaveLength(4);
    expect(nodes()[2].find('input').exists()).toBe(true);
    expect(parseFloat(item(2).style.top)).toBeGreaterThan(parseFloat(item(1).style.top));
    await wrapper.find('#mindmap-label').setValue('Next');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    One\n    Next\n    Two\n']);
    await wrapper.find('.mindmap-node.selected').trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.findAll('.mindmap-node')[2].find('input').exists()).toBe(true);
    await wrapper.find('#mindmap-label').setValue('Above');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[1]).toEqual(['mindmap\n  Root\n    One\n    Above\n    Next\n    Two\n']);
  });

  it('folds and zooms without emitting source, and moves with desktop drop and mobile controls', async () => {
    const wrapper = mountEditor();
    await wrapper.find('.mindmap-fold').trigger('click');
    expect(wrapper.findAll('.mindmap-node')).toHaveLength(1);
    await wrapper.find('.mindmap-fold').trigger('click');
    await wrapper.get('button[aria-label="Zoom in"]').trigger('click');
    expect(wrapper.text()).toContain('110%');
    await wrapper.find('.mindmap-viewport').trigger('wheel', { deltaX: 12, deltaY: 8 });
    expect(wrapper.find('.mindmap-canvas').attributes('style')).toContain('translate(-12px, -8px)');
    expect(wrapper.emitted('change')).toBeUndefined();
    expect(wrapper.find('.mindmap-editor').classes()).not.toContain('dragging');
    await wrapper.findAll('.mindmap-node')[2].trigger('dragstart');
    expect(wrapper.find('.mindmap-editor').classes()).toContain('dragging');
    await wrapper.findAll('.mindmap-drop-edge')[0].trigger('dragover');
    expect(wrapper.findAll('.mindmap-node')[1].classes()).toContain('drop-before');
    await wrapper.findAll('.mindmap-drop-edge')[0].trigger('drop');
    expect(wrapper.find('.drop-before').exists()).toBe(false);
    expect(wrapper.find('.mindmap-editor').classes()).not.toContain('dragging');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    Two\n    One\n']);
    await wrapper.findAll('.mindmap-node')[2].trigger('click');
    await wrapper.find('.mindmap-mobile-controls select').setValue('3');
    expect(wrapper.emitted('change')?.[1]).toEqual(['mindmap\n  Root\n    Two\n      One\n']);
  });
});

describe('MindMapVisualEditor', () => {
  it('offers node actions on right click and commits edits on blur', async () => {
    const wrapper = mountEditor();
    await wrapper.findAll('.mindmap-node')[1].trigger('contextmenu', { clientX: 30, clientY: 30 });
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(4);
    expect(wrapper.findAll('[role="menuitem"] svg')).toHaveLength(4);
    await wrapper.findAll('[role="menuitem"]')[1].trigger('click');
    const input = wrapper.get('#mindmap-label');
    await input.setValue('New child');
    await input.trigger('blur');
    expect(wrapper.emitted('change')?.[0]?.[0]).toContain('      New child\n');
    expect(wrapper.find('#mindmap-label').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renames and deletes from the node menu', async () => {
    const wrapper = mountEditor();
    await wrapper.findAll('.mindmap-node')[1].trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]')[0].trigger('click');
    await wrapper.get('#mindmap-label').setValue('Updated');
    await wrapper.get('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[0]?.[0]).toContain('    Updated\n');
    await wrapper.findAll('.mindmap-node')[1].trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]')[3].trigger('click');
    expect(wrapper.findComponent({ name: 'ConfirmModal' }).props('visible')).toBe(true);
    wrapper.unmount();
  });

  it('cancels on Escape and does not emit an edit', async () => {
    const wrapper = mountEditor();
    await wrapper.findAll('.mindmap-node')[1].trigger('dblclick');
    const input = wrapper.get('#mindmap-label');
    await input.setValue('Changed');
    await input.trigger('keydown', { key: 'Escape' });
    await input.trigger('blur');
    expect(wrapper.emitted('change')).toBeUndefined();
    wrapper.unmount();
  });

  it('adds and removes a selected node icon with undo and source round trips', async () => {
    const wrapper = mountEditor();
    await wrapper.findAll('.mindmap-node')[1].trigger('click');
    await wrapper.get('button[aria-label="Icon"]').trigger('click');
    expect(wrapper.findAll('.mindmap-icon-grid button').slice(0, 10).map(button => button.text())).toEqual(['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']);
    expect(wrapper.find('.mindmap-icon-grid button[aria-label="🇺🇸"]').exists()).toBe(false);
    await wrapper.get('.mindmap-icon-grid button[aria-label="🔵⚑"]').trigger('click');
    expect(wrapper.find('.mindmap-icon-panel').exists()).toBe(false);
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    🔵⚑ One\n    Two\n']);
    expect(wrapper.findAll('.mindmap-node')[1].find('.mindmap-colored-flag').attributes('style')).toContain('#1e88e5');
    await wrapper.findAll('.mindmap-toolbar > button')[0].trigger('click');
    expect(wrapper.emitted('change')?.[1]).toEqual([source]);
    await wrapper.findAll('.mindmap-toolbar > button')[1].trigger('click');
    await wrapper.get('button[aria-label="Icon"]').trigger('click');
    expect(wrapper.get('.mindmap-icon-grid button[aria-label="🔵⚑"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('.mindmap-icon-clear').trigger('click');
    expect(wrapper.emitted('change')?.[3]).toEqual([source]);
    await wrapper.get('button[aria-label="Icon"]').trigger('click');
    await wrapper.get('.mindmap-icon-panel').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.mindmap-icon-panel').exists()).toBe(false);
  });

  it('changes layout and palette without changing source', async () => {
    const wrapper = mountEditor();
    expect(wrapper.findAll('.mindmap-item')[1].attributes('style')).toContain('#e45b65');
    expect(wrapper.findAll('.mindmap-item')[2].attributes('style')).toContain('#e58b3f');
    await wrapper.get('button[aria-label="Layout"]').trigger('click');
    await wrapper.findAll('.mindmap-levels [role="option"]').find(option => option.text() === 'Right side')!.trigger('click');
    await wrapper.get('button[aria-label="Theme"]').trigger('click');
    await wrapper.findAll('.mindmap-levels [role="option"]').find(option => option.text() === 'Forest')!.trigger('click');
    expect(wrapper.attributes('style')).toContain('#72a873');
    await wrapper.get('button[aria-label="Theme"]').trigger('click');
    await wrapper.findAll('.mindmap-levels [role="option"]').find(option => option.text() === 'Lavender')!.trigger('click');
    expect(wrapper.attributes('style')).toContain('#a58ad8');
    await wrapper.get('button[aria-label="Theme"]').trigger('click');
    await wrapper.findAll('.mindmap-levels [role="option"]').find(option => option.text() === 'Rainbow')!.trigger('click');
    const branchStyles = wrapper.findAll('.mindmap-item').slice(1).map(item => item.attributes('style'));
    const connectorStyles = wrapper.findAll('.mindmap-connections path').map(path => path.attributes('style'));
    expect(branchStyles[0]).toContain('#e45b65');
    expect(branchStyles[1]).toContain('#e58b3f');
    expect(connectorStyles[0]).toContain('#e45b65');
    expect(connectorStyles[1]).toContain('#e58b3f');
    await wrapper.get('button[aria-label="Structure"]').trigger('click');
    await wrapper.findAll('.mindmap-levels [role="option"]').find(option => option.text() === 'Branches')!.trigger('click');
    expect(wrapper.classes()).toContain('branches');
    expect(wrapper.emitted('change')).toBeUndefined();
    wrapper.unmount();
  });
});
