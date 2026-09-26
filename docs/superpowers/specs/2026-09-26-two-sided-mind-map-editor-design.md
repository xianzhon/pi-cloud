# Two-sided mind map visual editor

## Goal

Replace the current tiny, left-aligned indented list with a readable conventional mind map. Preserve the existing `.mmd` tree, editing operations, undo/redo, save workflow, and unsupported-source handling.

## Layout and presentation

- Place the root at the center of the map. Assign complete top-level subtrees to the left or right, balancing their visible vertical space so a large branch does not crowd one side. Keep branch side stable through folding and ordinary label edits; a structural change may rebalance the layout.
- Lay out each visible subtree recursively: children sit farther outward from their parent, with vertical spacing for readable labels and a parent centered against its visible children. Folding removes descendants from layout without altering source.
- Draw smooth connectors behind nodes from the edge of each parent to the near edge of each child. Distinguish root, top-level branches, descendants, selection, and fold controls through size, contrast, and restrained color rather than making every node a tiny identical chip.
- Measure node labels or otherwise allocate enough width and height for multilingual text and wrapping. The canvas has intrinsic dimensions with breathing room around the diagram; it must not force nodes to shrink to viewport width. Keep a subtle canvas background that does not compete with connections.

## Interaction and data flow

- `MindMapVisualEditor.vue` continues to receive source and emit serialized source only for actual tree edits. The existing mind-map utility remains responsible for validation and structural changes. Layout coordinates and branch side are transient presentation state, never serialized.
- Preserve add child/sibling, rename, delete branch, undo/redo, fold, desktop drag/drop placement, and mobile reparent/reorder controls. Show a clear selected state and visible before/after/child drop targets or feedback. Root cannot be moved or deleted.
- Preserve panning and zooming. Fit scales and centers the *actual diagram bounds*, with a little padding; zoom controls remain discoverable but visually separate from tree-edit actions. The initial view fits the diagram after render. Subsequent edits should not unexpectedly reset manual pan/zoom. On narrow screens, allow panning instead of shrinking labels to illegibility.
- Keyboard focus and accessible action labels remain available; the edit form and delete confirmation stay functional. No new persistence, API, dependency, or file format is required.

## Implementation boundaries

- A small pure layout helper takes the visible tree and node dimensions and returns node coordinates, connectors, and diagram bounds. The Vue component owns rendering and viewport interaction. Keep the layout helper separately testable; use the existing node IDs only as session-local identifiers.
- SVG connectors can render behind positioned HTML nodes; node buttons and form controls remain HTML for accessibility. Recompute layout on tree/fold/label changes and when size measurement changes. Avoid live layout recomputation during pan or zoom.
- Raw/Preview mode integration and unsupported Mermaid behavior in `EditorPanel.vue` do not change.

## Verification

- Focused tests cover distribution on both sides, subtree separation, fold layout, nonempty diagram bounds, edits preserving source semantics, desktop and mobile movement, zoom/pan, and fit centering. Run relevant client tests and client build. Manually check a broad/deep Chinese map, a small map, and a narrow viewport in both themes if a browser preview is available.
