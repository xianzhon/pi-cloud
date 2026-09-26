import { describe, expect, it } from 'vitest';
import { parseMindMap } from './mindMap';
import { layoutMindMap } from './mindMapLayout';

const tree = parseMindMap('mindmap\n  中心主题\n    左侧\n      内容一\n      内容二\n    右侧\n      内容三\n    第三支\n');

describe('mind map layout', () => {
  it('distributes whole branches across both sides and gives them separate space', () => {
    const layout = layoutMindMap(tree, new Set(), new Map());
    expect(layout.nodes).toHaveLength(7);
    expect(layout.connectors).toHaveLength(6);
    expect(layout.bounds.right).toBeGreaterThan(0);
    expect(layout.bounds.left).toBeLessThan(0);
    expect(layout.nodes.find(node => node.id === 2)?.side).toBe(-1);
    expect(layout.nodes.find(node => node.id === 5)?.side).toBe(1);
    expect(layout.nodes.find(node => node.id === 3)?.side).toBe(-1);
    const right = layout.nodes.filter(node => node.side === 1 && node.depth === 1);
    expect(Math.abs(right[0].y - right[1].y)).toBeGreaterThan((right[0].height + right[1].height) / 2);
  });

  it('places every branch to the right even when previously assigned left', () => {
    const both = layoutMindMap(tree, new Set(), new Map());
    const right = layoutMindMap(tree, new Set(), new Map(), both.sides, 'right');
    expect(right.nodes.filter(node => node.depth > 0).every(node => node.side === 1)).toBe(true);
    expect(right.connectors).toHaveLength(6);
    expect(layoutMindMap(tree, new Set(), new Map(), new Map(), 'both').nodes.some(node => node.side === -1)).toBe(true);
  });

  it('keeps assigned sides through folding and changing dimensions', () => {
    const original = layoutMindMap(tree, new Set(), new Map());
    const folded = layoutMindMap(tree, new Set([2]), new Map([[2, { width: 240, height: 100 }]]), original.sides);
    expect(folded.nodes).toHaveLength(5);
    expect(folded.connectors).toHaveLength(4);
    expect(folded.sides.get(2)).toBe(original.sides.get(2));
    expect(folded.bounds.bottom - folded.bounds.top).toBeGreaterThan(0);
    expect(folded.bounds.right - folded.bounds.left).toBeGreaterThan(0);
  });
});
