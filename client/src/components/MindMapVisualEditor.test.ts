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
    await wrapper.findAll('.mindmap-node')[1].trigger('click');
    await wrapper.findAll('.mindmap-toolbar button')[2].trigger('click');
    expect(wrapper.findAll('.mindmap-node')[1].find('input').exists()).toBe(true);
    await wrapper.find('#mindmap-label').setValue('Renamed');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    Renamed\n    Two\n']);
    await wrapper.setProps({ source: 'mindmap\n  Root\n    Renamed\n    Two\n' });
    await wrapper.findAll('.mindmap-toolbar button')[4].trigger('click');
    expect(wrapper.emitted('change')?.[1]).toEqual([source]);
    await wrapper.setProps({ source: 'mindmap\n  Other\n' });
    expect(wrapper.findAll('.mindmap-node').map(node => node.text())).toEqual(['Other']);
    expect(wrapper.findAll('.mindmap-toolbar button')[4].attributes('disabled')).toBeDefined();
  });

  it('fits the diagram at its center and preserves manual view after edits', async () => {
    const wrapper = mountEditor();
    const viewport = wrapper.find('.mindmap-viewport').element;
    Object.defineProperties(viewport, { clientWidth: { value: 900 }, clientHeight: { value: 500 } });
    await wrapper.findAll('.mindmap-toolbar button')[8].trigger('click');
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
    await wrapper.findAll('.mindmap-node')[1].trigger('click');
    await wrapper.findAll('.mindmap-toolbar button')[2].trigger('click');
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
    await wrapper.find('.mindmap-levels select').setValue('1');
    expect(nodes().map(node => node.attributes('aria-label'))).toEqual(['Root', 'One', 'Two']);
    await wrapper.find('.mindmap-levels select').setValue('2');
    expect(nodes().map(node => node.attributes('aria-label'))).toEqual(['Root', 'One', 'Child', 'Two']);
    await wrapper.find('.mindmap-levels select').setValue('3');
    expect(nodes()).toHaveLength(5);
    await nodes()[0].trigger('keydown', { key: 'ArrowDown' });
    expect(nodes()[1].attributes('aria-pressed')).toBe('true');
    await nodes()[1].trigger('keydown', { key: 'ArrowRight' });
    expect(nodes()[2].attributes('aria-pressed')).toBe('true');
    await nodes()[2].trigger('keydown', { key: 'ArrowLeft' });
    expect(nodes()[2].attributes('aria-pressed')).toBe('true');
    expect(nodes()).toHaveLength(4);
    await nodes()[2].trigger('keydown', { key: 'ArrowLeft' });
    expect(nodes()[1].attributes('aria-pressed')).toBe('true');
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
    await wrapper.find('.mindmap-edit-actions button[type="button"]').trigger('click');
    expect(nodes()).toHaveLength(3);
    await nodes()[1].trigger('keydown', { key: 'Enter' });
    expect(nodes()).toHaveLength(4);
    expect(nodes()[2].find('input').exists()).toBe(true);
    expect(parseFloat(item(2).style.top)).toBeGreaterThan(parseFloat(item(1).style.top));
    await wrapper.find('#mindmap-label').setValue('Next');
    await wrapper.find('.mindmap-inline-edit').trigger('submit');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    One\n    Next\n    Two\n']);
  });

  it('folds and zooms without emitting source, and moves with desktop drop and mobile controls', async () => {
    const wrapper = mountEditor();
    await wrapper.find('.mindmap-fold').trigger('click');
    expect(wrapper.findAll('.mindmap-node')).toHaveLength(1);
    await wrapper.find('.mindmap-fold').trigger('click');
    await wrapper.findAll('.mindmap-toolbar button')[7].trigger('click');
    expect(wrapper.text()).toContain('110%');
    await wrapper.find('.mindmap-viewport').trigger('wheel', { deltaX: 12, deltaY: 8 });
    expect(wrapper.find('.mindmap-canvas').attributes('style')).toContain('translate(-12px, -8px)');
    expect(wrapper.emitted('change')).toBeUndefined();
    await wrapper.findAll('.mindmap-node')[2].trigger('dragstart');
    await wrapper.findAll('.mindmap-drop-edge')[0].trigger('dragover');
    expect(wrapper.findAll('.mindmap-node')[1].classes()).toContain('drop-before');
    await wrapper.findAll('.mindmap-drop-edge')[0].trigger('drop');
    expect(wrapper.find('.drop-before').exists()).toBe(false);
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    Two\n    One\n']);
    await wrapper.findAll('.mindmap-node')[2].trigger('click');
    await wrapper.find('.mindmap-mobile-controls select').setValue('3');
    expect(wrapper.emitted('change')?.[1]).toEqual(['mindmap\n  Root\n    Two\n      One\n']);
  });
});
