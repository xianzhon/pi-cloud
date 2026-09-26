# Mind map visual editing: first release

## Context and goal

Pi Cloud currently creates `.mmd` mind maps in the file editor and lets users edit Mermaid source in Raw and render it in Preview. Add a third, visual editing mode for standard mind maps created by Pi Cloud. Preserve `.mmd` as the single source of truth and the existing file save workflow. This release covers editing and organizing nodes, not search, styling, import/export, or collaboration.

## Format and compatibility

- The visual editor accepts the project's standard `mindmap` form: a first line of exactly `mindmap`, one root indented two spaces, and descendants indented two additional spaces per level. Each node occupies one line; no skipped levels, blank lines, tabs, or extra roots. Allow an optional final newline. For the first release, a label is a nonempty, trimmed string of Unicode letters, numbers, spaces, underscores, and hyphens (`[\p{L}\p{N}_ -]+`); reject labels containing Mermaid syntax characters or characters that cannot round-trip. The serializer emits LF line endings, two spaces per level, and a final newline. Reject any other Mermaid constructs rather than silently changing them.
- Parse the current Monaco file model when entering visual mode and after Raw edits. If the entire source can be parsed, visual editing is available. If not, keep the source unchanged, show a reason, and offer Raw/Preview only. Never partially import a file, overwrite unsupported source, or silently strip Mermaid constructs.
- The first visual edit serializes the entire supported map into canonical formatting. Formatting such as indentation may change; node content and hierarchy must not. Preview continues to render Mermaid source using the existing rendering path.
- `.mmd` remains the only persisted representation. Collapse state and viewport position are transient UI state; reopening a file starts expanded. No backend endpoint, migration, or alternate file format is needed.

## Architecture and data flow

- A focused, independently testable mind-map module parses supported `.mmd` into a tree, validates node operations, and serializes the tree. Node identity is local to the editing session, not stored in `.mmd`.
- A separate visual editor component renders the tree and manages selection, dragging, viewport, folding, and mobile operation controls. It receives the current source and emits edited source to the parent; it does not call filesystem APIs.
- `EditorPanel.vue` selects Raw, Preview, or visual edit mode and applies emitted source to the existing Monaco model, marking the file dirty through the existing editor mechanism. Save button and Ctrl/Cmd+S persist through the existing file API. The existing unsaved-file behavior applies to tab/file changes.
- Raw edits invalidate the visual editor's operation history and require re-parsing before returning to visual mode. Switching modes without a Raw change preserves the operation history. Saving alone does not clear it. In visual mode, undo/redo operates on node operations; Raw mode retains Monaco's normal text editing behavior.

## Editing and organization

- Select a node to add a child or sibling, rename it, or delete it and its descendants. The root can be renamed and given children but cannot be deleted, moved, or given a sibling.
- Desktop drag-and-drop allows placing a non-root node before/after a sibling or under another node, adjusting hierarchy and order. Invalid drops, including moves into the node itself or its descendants, do nothing.
- On mobile, do not require drag-and-drop: node controls allow selecting a new parent (append as its last child), moving up/down among siblings, or promoting a node to follow its parent among the grandparent's children. The same validation rules apply as on desktop.
- Branches can be folded and unfolded. Pan, zoom, and fit-to-window affect only the viewport. Undo/redo tracks node creation, deletion, rename, and move, not viewport or collapse state. Editing controls should remain accessible without drag-and-drop.

## Errors and safeguards

- Unsupported or malformed source displays a localized, actionable reason for why visual editing is unavailable; Raw and Preview remain accessible. Rendering errors continue to use existing Preview behavior.
- Do not regenerate source on mere mode switches, pan/zoom, selection, or folding. Failed parse and invalid node operations must never change the Monaco model or dirty state.
- Keep current allowed-root and authentication protections by using the existing file editor and save APIs only. Add localized labels and messages in English and Chinese.

## Verification

- Unit tests cover parse/serialize round trips for the standard template and nested nodes, the specified label alphabet and indentation rules, rejection of unsupported syntax, malformed hierarchy, invalid moves, and node edits with undo/redo.
- Component/integration tests cover visual/Raw/Preview switching, invalid-source fallback without source loss, raw-edit history invalidation, dirty/save behavior, desktop move semantics, mobile move controls, folding, and zoom/pan behavior.
- Run focused client tests and client build; broaden to workspace checks if integration changes warrant it.
