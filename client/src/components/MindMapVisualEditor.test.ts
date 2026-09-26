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
    await wrapper.findAll('.mindmap-drop-edge')[2].trigger('drop');
    expect(wrapper.emitted('change')?.[0]).toEqual(['mindmap\n  Root\n    Two\n    One\n']);
    await wrapper.findAll('.mindmap-node')[2].trigger('click');
    await wrapper.find('.mindmap-mobile-controls select').setValue('3');
    expect(wrapper.emitted('change')?.[1]).toEqual(['mindmap\n  Root\n    Two\n      One\n']);
  });
});
