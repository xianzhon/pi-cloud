import type { MindMapNode } from './mindMap';

export interface NodeSize { width: number; height: number }
export interface MapPosition { id: number; x: number; y: number; width: number; height: number; side: -1 | 0 | 1; depth: number }
export interface MapLayout {
  nodes: MapPosition[];
  connectors: string[];
  bounds: { left: number; top: number; right: number; bottom: number };
  sides: Map<number, -1 | 1>;
}

const horizontalGap = 76;
const verticalGap = 24;

export function layoutMindMap(root: MindMapNode, folded: ReadonlySet<number>, sizes: ReadonlyMap<number, NodeSize>, previousSides: ReadonlyMap<number, -1 | 1> = new Map(), direction: 'both' | 'right' = 'both'): MapLayout {
  const size = (node: MindMapNode): NodeSize => sizes.get(node.id) ?? { width: node === root ? 210 : node.children.length ? 190 : 170, height: 64 };
  const children = (node: MindMapNode) => folded.has(node.id) ? [] : node.children;
  const heights = new Map<number, number>();
  function height(node: MindMapNode): number {
    const descendants = children(node);
    const total = descendants.reduce((sum, child) => sum + height(child), 0) + Math.max(0, descendants.length - 1) * verticalGap;
    const result = Math.max(size(node).height, total);
    heights.set(node.id, result);
    return result;
  }
  height(root);

  const sides = new Map<number, -1 | 1>();
  const totals = { '-1': 0, '1': 0 };
  for (const child of children(root)) {
    const side = direction === 'right' ? 1 : previousSides.get(child.id) ?? (totals['-1'] <= totals['1'] ? -1 : 1);
    sides.set(child.id, side);
    totals[side] += heights.get(child.id)! + verticalGap;
  }
  const nodes: MapPosition[] = [];
  const connectors: string[] = [];
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  function place(node: MindMapNode, x: number, y: number, side: -1 | 0 | 1, depth: number, parent?: MapPosition) {
    const { width, height: nodeHeight } = size(node);
    const position = { id: node.id, x, y, width, height: nodeHeight, side, depth };
    nodes.push(position);
    bounds.left = Math.min(bounds.left, x - width / 2);
    bounds.right = Math.max(bounds.right, x + width / 2);
    bounds.top = Math.min(bounds.top, y - nodeHeight / 2);
    bounds.bottom = Math.max(bounds.bottom, y + nodeHeight / 2);
    if (parent) {
      const start = parent.x + side * parent.width / 2;
      const end = x - side * width / 2;
      const bend = (start + end) / 2;
      connectors.push(`M ${start} ${parent.y} C ${bend} ${parent.y}, ${bend} ${y}, ${end} ${y}`);
    }
    const descendants = node === root ? [] : children(node);
    const total = descendants.reduce((sum, child) => sum + heights.get(child.id)!, 0) + Math.max(0, descendants.length - 1) * verticalGap;
    let cursor = y - total / 2;
    for (const child of descendants) {
      const span = heights.get(child.id)!;
      const childY = cursor + span / 2;
      place(child, x + side * (width / 2 + horizontalGap + size(child).width / 2), childY, side, depth + 1, position);
      cursor += span + verticalGap;
    }
  }
  place(root, 0, 0, 0, 0);
  for (const side of [-1, 1] as const) {
    const branches = children(root).filter(child => sides.get(child.id) === side);
    const total = branches.reduce((sum, child) => sum + heights.get(child.id)!, 0) + Math.max(0, branches.length - 1) * verticalGap;
    let cursor = -total / 2;
    for (const child of branches) {
      const span = heights.get(child.id)!;
      place(child, side * (size(root).width / 2 + horizontalGap + size(child).width / 2), cursor + span / 2, side, 1, nodes[0]);
      cursor += span + verticalGap;
    }
  }
  return { nodes, connectors, bounds, sides };
}
