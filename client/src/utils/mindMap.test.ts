import { describe, expect, it } from 'vitest';
import { parseMindMap, serializeMindMap, editMindMap, type MindMapNode } from './mindMap';

const source = 'mindmap\n  Root\n    Alpha\n      Grand child\n    Beta\n';

describe('mind map source', () => {
  it('round trips nested nodes and canonicalizes only after an edit', () => {
    const root = parseMindMap(source);
    expect(root.children[0].children[0].label).toBe('Grand child');
    expect(serializeMindMap(root)).toBe(source);
    expect(serializeMindMap(parseMindMap('mindmap\n  Root'))).toBe('mindmap\n  Root\n');
  });

  it.each(['mindmap\n  Root\n    中文 Å_42 - ok\n', 'mindmap\n  你好\n'])('accepts Unicode letters, numbers, spaces, underscore and hyphen', text => {
    expect(serializeMindMap(parseMindMap(text))).toBe(text);
  });

  it('reads and preserves a circular Mermaid root through edits', () => {
    const text = 'mindmap\n  root((AI 智能体))\n    核心组成\n      大语言模型\n';
    const root = parseMindMap(text);
    expect(root.label).toBe('AI 智能体');
    expect(serializeMindMap(root)).toBe(text);
    expect(serializeMindMap(editMindMap(root, { type: 'rename', target: root.id, label: '新智能体' })))
      .toBe('mindmap\n  root((新智能体))\n    核心组成\n      大语言模型\n');
  });

  it('round trips colored flags and preserves existing country flags', () => {
    const text = 'mindmap\n  Root\n    🔵⚑ Priority\n    🇺🇸 Legacy\n';
    const root = parseMindMap(text);
    expect(root.children.map(node => node.icon)).toEqual(['🔵⚑', '🇺🇸']);
    expect(serializeMindMap(root)).toBe(text);
    expect(serializeMindMap(editMindMap(root, { type: 'icon', target: 2, icon: '🟢⚑' }))).toContain('    🟢⚑ Priority\n');
  });

  it('round trips icons on roots and descendants through rename, move and removal', () => {
    const text = 'mindmap\n  root((🚩 Root))\n    ⑩ Step\n      💡 Idea\n';
    const root = parseMindMap(text);
    expect(serializeMindMap(root)).toBe(text);
    const renamed = editMindMap(root, { type: 'rename', target: 2, label: 'Next' });
    expect(serializeMindMap(renamed)).toContain('    ⑩ Next\n');
    const cleared = editMindMap(renamed, { type: 'icon', target: 2 });
    expect(serializeMindMap(cleared)).toContain('    Next\n');
    expect(serializeMindMap(editMindMap(cleared, { type: 'icon', target: 3, icon: '⭐' }))).toContain('      ⭐ Idea\n');
    expect(() => editMindMap(root, { type: 'icon', target: 2, icon: 'bad' })).toThrow();
    expect(serializeMindMap(root)).toBe(text);
  });

  it.each([
    '', 'mindmap\n', 'mindmap\n  Root\n\n', 'mindmap\r\n  Root',
    'mindmap\n Root', 'mindmap\n  Root\n  Second',
    'mindmap\n  Root\n      Skip', 'mindmap\n\tRoot',
    'mindmap\n  Root\n    Bad(thing)', 'mindmap\n  Root\n    root((Not a root))', 'mindmap\n  root((Bad!))', 'mindmap\n  Root\n    Bad trailing ',
    'mindmap\n  Root\n    Bad: label', 'mindmap\n  Root\n    Bad`label',
    'graph TD\n  Root',
  ])('rejects unsupported source without importing it: %j', text => {
    expect(() => parseMindMap(text)).toThrow();
  });
});

describe('mind map operations', () => {
  const tree = () => parseMindMap(source);
  const ids = (root: MindMapNode) => ({ root: root.id, alpha: root.children[0].id, grand: root.children[0].children[0].id, beta: root.children[1].id });
  it('creates, renames and deletes whole branches without modifying the input', () => {
    const root = tree();
    const { alpha, beta } = ids(root);
    const added = editMindMap(root, { type: 'add', target: alpha, placement: 'sibling', label: 'New' });
    expect(serializeMindMap(added)).toBe('mindmap\n  Root\n    Alpha\n      Grand child\n    New\n    Beta\n');
    expect(serializeMindMap(editMindMap(added, { type: 'rename', target: beta, label: 'Renamed' }))).toContain('    Renamed\n');
    expect(serializeMindMap(editMindMap(root, { type: 'delete', target: alpha }))).toBe('mindmap\n  Root\n    Beta\n');
    expect(serializeMindMap(root)).toBe(source);
    expect(() => editMindMap(root, { type: 'add', target: beta, placement: 'child', label: 'Bad!' })).toThrow();
  });

  it('moves before, after, under, up, down and promotes with cycle/root guards', () => {
    const root = tree();
    const { root: rootId, alpha, grand, beta } = ids(root);
    expect(serializeMindMap(editMindMap(root, { type: 'move', target: beta, destination: alpha, placement: 'before' }))).toBe('mindmap\n  Root\n    Beta\n    Alpha\n      Grand child\n');
    expect(serializeMindMap(editMindMap(root, { type: 'move', target: beta, destination: alpha, placement: 'child' }))).toBe('mindmap\n  Root\n    Alpha\n      Grand child\n      Beta\n');
    expect(serializeMindMap(editMindMap(root, { type: 'move', target: grand, placement: 'promote' }))).toBe('mindmap\n  Root\n    Alpha\n    Grand child\n    Beta\n');
    expect(serializeMindMap(editMindMap(root, { type: 'move', target: beta, placement: 'up' }))).toContain('    Beta\n    Alpha\n');
    expect(() => editMindMap(root, { type: 'move', target: alpha, destination: grand, placement: 'child' })).toThrow();
    expect(() => editMindMap(root, { type: 'move', target: rootId, destination: beta, placement: 'after' })).toThrow();
    expect(() => editMindMap(root, { type: 'delete', target: rootId })).toThrow();
    expect(() => editMindMap(root, { type: 'add', target: rootId, placement: 'sibling', label: 'Other' })).toThrow();
    expect(() => editMindMap(root, { type: 'move', target: alpha, destination: beta, placement: 'before' })).toThrow();
  });
});
