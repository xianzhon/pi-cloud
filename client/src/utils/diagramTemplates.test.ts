import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import { diagramTemplates, diagramTypes } from './diagramTemplates';

describe('diagram starter examples', () => {
  it('uses the agreed ordering with a starter for each type', async () => {
    expect(diagramTypes.slice(0, 3)).toEqual(['mindmap', 'flowchart', 'er']);
    for (const type of diagramTypes) {
      expect(await mermaid.parse(diagramTemplates[type])).toBeTruthy();
    }
  });
});
