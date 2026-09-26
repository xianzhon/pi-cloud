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
    await wrapper.find('#mindmap-label').setValue('Renamed');
    await wrapper.find('.mindmap-edit-form').trigger('submit');
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
    await wrapper.find('.mindmap-edit-form').trigger('submit');
    expect(canvas.attributes('style')).toBe(panned);
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
    await wrapper.findAll('.mindmap-drop-edge')[0].trigger('drop');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    Two\n    One\n']);
    await wrapper.findAll('.mindmap-node')[2].trigger('click');
    await wrapper.find('.mindmap-mobile-controls select').setValue('3');
    expect(wrapper.emitted('change')?.[1]).toEqual(['mindmap\n  Root\n    Two\n      One\n']);
  });
});
