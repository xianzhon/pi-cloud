import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FileTreeNode, { type TreeNodeData } from './FileTreeNode.vue';
import { PhFolder, PhFile, PhCaretRight, PhCaretDown } from '@phosphor-icons/vue';

const tree: TreeNodeData = {
  name: 'src',
  path: '/project/src',
  type: 'directory',
  children: [
    { name: 'main.ts', path: '/project/src/main.ts', type: 'file' },
    { name: 'components', path: '/project/src/components', type: 'directory', children: [] },
  ],
};

describe('FileTreeNode', () => {
  it('renders directory nodes with collapsed toggle by default', () => {
    const wrapper = mount(FileTreeNode, {
      props: { node: tree, level: 0, expandedPaths: new Set<string>() },
    });

    expect(wrapper.text()).toContain('src');
    expect(wrapper.findComponent(PhCaretRight).exists()).toBe(true);
    expect(wrapper.findComponent(PhCaretDown).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('main.ts');
  });

  it('renders child nodes when the directory path is expanded', () => {
    const wrapper = mount(FileTreeNode, {
      props: { node: tree, level: 0, expandedPaths: new Set(['/project/src']) },
    });

    expect(wrapper.findComponent(PhCaretDown).exists()).toBe(true);
    expect(wrapper.text()).toContain('main.ts');
    expect(wrapper.text()).toContain('components');
  });

  it('emits toggle when a directory is clicked', async () => {
    const wrapper = mount(FileTreeNode, {
      props: { node: tree, level: 0, expandedPaths: new Set<string>() },
    });

    await wrapper.find('.tree-node').trigger('click');

    expect(wrapper.emitted('toggle')?.[0]).toEqual([tree]);
  });

  it('emits open with the file path when a file is clicked', async () => {
    const file: TreeNodeData = { name: 'main.ts', path: '/project/src/main.ts', type: 'file' };
    const wrapper = mount(FileTreeNode, {
      props: { node: file, level: 1, expandedPaths: new Set<string>() },
    });

    await wrapper.find('.tree-node').trigger('click');

    expect(wrapper.emitted('open')?.[0]).toEqual(['/project/src/main.ts']);
  });

  it('marks the active file node', () => {
    const file: TreeNodeData = { name: 'main.ts', path: '/project/src/main.ts', type: 'file' };
    const wrapper = mount(FileTreeNode, {
      props: { node: file, level: 1, expandedPaths: new Set<string>(), activePath: '/project/src/main.ts' },
    });

    expect(wrapper.find('.tree-node').classes()).toContain('active');
    expect(wrapper.find('.tree-node').attributes('data-tree-current')).toBe('true');
  });

  it('renders symlink nodes with a link indicator and target in the title', () => {
    const link: TreeNodeData = {
      name: 'src-link',
      path: '/project/src-link',
      type: 'directory',
      isSymlink: true,
      linkTarget: '/project/src',
      targetType: 'directory',
    };

    const wrapper = mount(FileTreeNode, {
      props: { node: link, level: 0, expandedPaths: new Set<string>() },
    });

    // Symlink directories should show folder icon (since it's a directory type)
    expect(wrapper.findComponent(PhFolder).exists()).toBe(true);
    expect(wrapper.find('.node-name').attributes('title')).toBe('/project/src-link → /project/src');
  });
});
