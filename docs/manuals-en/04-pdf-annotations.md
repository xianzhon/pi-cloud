# PDF and Image Annotations User Manual

Pi Cloud lets you annotate PDF and image files opened in the workspace editor. Annotations are stored separately, so editing does not modify the original document.

## Open and Annotate a Document

1. Open a PDF or supported image file from the workspace file tree.
2. Select an annotation tool from the toolbar.
3. Choose a color and width, then draw or place the annotation on the displayed page or image.
4. Select the active tool again to return to normal document navigation.

The annotation toolbar provides:

- **Pen and highlighter**: draw freehand strokes.
- **Line, arrow, rectangle, and ellipse**: draw shapes.
- **Text**: place a text note, or select an existing note to edit it.
- **Move**: reposition an existing annotation.
- **Eraser**: remove annotations touched by the eraser.
- **Undo and redo**: move backward or forward through annotation changes made while the PDF is open.
- **Clear page**: remove every annotation from the current page.

Press `1` through `8` to select the tools in toolbar order, or `0` for the eraser. The toolbar can be dragged, moved with the arrow keys from its drag handle, and switched between horizontal and vertical layouts.

Annotations use document-relative coordinates, so they stay aligned when the PDF or image zoom changes.

For images, use Ctrl or Command with the mouse wheel, or use a pinch gesture, to zoom. Drag to pan, and double-click to reset zoom. Zoom can also be changed from the navigation toolbar.

## PDF Page Color

For PDFs, use the page-color selector in the navigation toolbar to choose **Original**, **Warm**, **Gray**, or **Dark**. The setting is saved with the PDF view state. It only changes the on-screen preview; the original PDF and exported copies keep their original colors.

## Saving and Status

Annotations save automatically after drawing, erasing, undoing, redoing, or clearing a page. The fixed status indicator at the end of the annotation toolbar shows:

- A spinner while saving.
- A check when the latest changes have been saved.
- An error indicator if saving fails.

There is no separate Save command for PDF or image annotations.

## Storage Location

Pi Cloud writes PDF and image annotations to a JSON sidecar in a hidden `.annotations` subdirectory:

```text
<document directory>/.annotations/<document filename>.annotations.json
```

For example:

```text
/books/example.pdf
/books/.annotations/example.pdf.annotations.json
```

The leading `.` makes the directory hidden in the default Pi Cloud file-tree view. Enable **Show hidden files** in the file tree when you need to see or manage it. The sidecar contains vector annotations grouped by page, and the original document remains unchanged.

For backward compatibility, Pi Cloud can read older sidecars named `.<document filename>.annotations.json` or `<document filename>.annotations.json` beside the document. These old files are never modified. New saves are written to the `.annotations` directory, after which the old sidecar can be removed manually.

The sidecar is a regular workspace file and is subject to the same allowed-root and filesystem permissions as other editor files. Pi Cloud must have write permission in the document's directory to create `.annotations` and save annotations.

## Back Up, Move, or Share Annotations

Keep the document and its `.annotations` sidecar file together when backing up, copying, moving, renaming, or sharing an annotated document. Pi Cloud matches them by filename and location; moving or renaming only the document does not automatically move or rename its sidecar.

To remove all saved annotations, show hidden files, delete the corresponding `.annotations/<document filename>.annotations.json` sidecar, and reopen the document.

## Export an Annotated Copy

Use the download button in the navigation toolbar to export a flattened copy. PDF files download as `<name>-annotated.pdf`, and images download as `<name>-annotated.png`. The original document and annotation sidecar remain unchanged.

## Current Limitations

- Annotations remain separate from the original document until you export a flattened copy.
- Opening the original document in another viewer will not show the sidecar annotations.
- Exporting individual annotations to other annotation formats is not currently supported.
