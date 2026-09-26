export interface MindMapNode {
  id: number;
  label: string;
  children: MindMapNode[];
  circleRoot?: boolean;
  icon?: string;
}

type Operation =
  | { type: 'add'; target: number; placement: 'child' | 'sibling'; label: string }
  | { type: 'rename'; target: number; label: string }
  | { type: 'icon'; target: number; icon?: string }
  | { type: 'delete'; target: number }
  | { type: 'move'; target: number; destination?: number; placement: 'child' | 'before' | 'after' | 'up' | 'down' | 'promote' };

// Icon prefixes remain ordinary Mermaid node text, so Raw and Preview can display them too.
export const mindMapIcons = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '🚩', '🏁', '🏳️', '🇺🇸', '🇨🇳', '🇬🇧', '🇯🇵', '🇩🇪', '🇫🇷',
  '⭐', '✅', '❌', '⚠️', '💡', '📌', '📅', '📎', '📝', '🔗', '🔒', '🎯', '❤️', '🔥',
];

export function validMindMapLabel(label: string): boolean {
  return !!label && label.trim() === label && /^[\p{L}\p{N}_ -]+$/u.test(label);
}

export function parseMindMap(source: string): MindMapNode {
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== 'mindmap') throw new Error('header');
  if (lines.length < 2) throw new Error('root');
  const stack: MindMapNode[] = [];
  let root: MindMapNode | undefined;
  for (let i = 1; i < lines.length; i++) {
    const match = /^( *)(.*)$/.exec(lines[i]);
    if (!match || match[1].length < 2 || match[1].length % 2) throw new Error(`line:${i + 1}`);
    const depth = match[1].length / 2 - 1;
    // Mermaid's root((label)) form gives the root a circular shape.
    const circleRoot = depth === 0 && /^root\(\((.*)\)\)$/.exec(match[2]);
    const text = circleRoot ? circleRoot[1] : match[2];
    const icon = mindMapIcons.find(value => text.startsWith(`${value} `));
    const label = icon ? text.slice(icon.length + 1) : text;
    if (!validMindMapLabel(label)) throw new Error(`line:${i + 1}`);
    if (depth > stack.length || (depth === 0 && root)) throw new Error(`hierarchy:${i + 1}`);
    const node: MindMapNode = { id: i, label, children: [], ...(circleRoot ? { circleRoot: true } : {}), ...(icon ? { icon } : {}) };
    if (depth === 0) root = node;
    else stack[depth - 1].children.push(node);
    stack[depth] = node;
    stack.length = depth + 1;
  }
  if (!root) throw new Error('root');
  return root;
}

export function serializeMindMap(root: MindMapNode): string {
  const lines = ['mindmap'];
  const visit = (node: MindMapNode, depth: number) => {
    const text = `${node.icon ? `${node.icon} ` : ''}${node.label}`;
    lines.push(`${'  '.repeat(depth)}${node.circleRoot ? `root((${text}))` : text}`);
    node.children.forEach(child => visit(child, depth + 1));
  };
  visit(root, 1);
  return `${lines.join('\n')}\n`;
}

export function editMindMap(root: MindMapNode, operation: Operation): MindMapNode {
  const clone = (node: MindMapNode): MindMapNode => ({ ...node, children: node.children.map(clone) });
  const copy = clone(root);
  const locate = (id: number, node: MindMapNode = copy, parent?: MindMapNode): { node: MindMapNode; parent?: MindMapNode } | undefined => {
    if (node.id === id) return { node, parent };
    for (const child of node.children) {
      const found = locate(id, child, node);
      if (found) return found;
    }
  };
  const found = locate(operation.target);
  if (!found) throw new Error('target');
  const { node, parent } = found;
  if (operation.type === 'icon') {
    if (operation.icon && !mindMapIcons.includes(operation.icon)) throw new Error('icon');
    if (node.icon === operation.icon) throw new Error('unchanged');
    node.icon = operation.icon;
  } else if (operation.type === 'rename' || operation.type === 'add') {
    if (!validMindMapLabel(operation.label)) throw new Error('label');
    if (operation.type === 'rename') {
      if (node.label === operation.label) throw new Error('unchanged');
      node.label = operation.label;
    } else {
      if (operation.placement === 'sibling' && !parent) throw new Error('root');
      const ids: number[] = [];
      const collect = (n: MindMapNode) => { ids.push(n.id); n.children.forEach(collect); };
      collect(copy);
      const next: MindMapNode = { id: Math.max(...ids) + 1, label: operation.label, children: [] };
      if (operation.placement === 'child') node.children.push(next);
      else parent!.children.splice(parent!.children.indexOf(node) + 1, 0, next);
    }
  } else if (operation.type === 'delete') {
    if (!parent) throw new Error('root');
    parent.children.splice(parent.children.indexOf(node), 1);
  } else {
    if (!parent) throw new Error('root');
    const { placement } = operation;
    let destination: MindMapNode;
    let destinationParent: MindMapNode;
    let index: number;
    if (placement === 'up' || placement === 'down') {
      destinationParent = parent;
      index = parent.children.indexOf(node) + (placement === 'up' ? -1 : 2);
      if (index < 0 || index > parent.children.length) throw new Error('boundary');
    } else if (placement === 'promote') {
      const grandparent = locate(parent.id)?.parent;
      if (!grandparent) throw new Error('root');
      destinationParent = grandparent;
      index = grandparent.children.indexOf(parent) + 1;
    } else {
      const foundDestination = operation.destination === undefined ? undefined : locate(operation.destination);
      if (!foundDestination) throw new Error('destination');
      destination = foundDestination.node;
      destinationParent = placement === 'child' ? destination : foundDestination.parent!;
      if (!destinationParent) throw new Error('root');
      index = placement === 'child' ? destination.children.length : destinationParent.children.indexOf(destination) + (placement === 'after' ? 1 : 0);
    }
    const contains = (candidate: MindMapNode): boolean => candidate === destinationParent || candidate.children.some(contains);
    if (contains(node)) throw new Error('cycle');
    const oldIndex = parent.children.indexOf(node);
    if (parent === destinationParent && (index === oldIndex || index === oldIndex + 1)) throw new Error('unchanged');
    parent.children.splice(oldIndex, 1);
    if (parent === destinationParent && oldIndex < index) index--;
    destinationParent.children.splice(index, 0, node);
  }
  return copy;
}
