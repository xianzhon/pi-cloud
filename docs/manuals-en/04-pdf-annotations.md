# PDF Annotations User Manual

Pi Cloud lets you annotate PDF files opened in the workspace editor. Annotations are stored separately, so editing does not modify the original PDF.

## Open and Annotate a PDF

1. Open a `.pdf` file from the workspace file tree.
2. Select an annotation tool from the toolbar.
3. Choose a color and width, then draw or place the annotation on the displayed page.
4. Select the active tool again to return to normal PDF navigation.

The annotation toolbar provides:

- **Pen and highlighter**: draw freehand strokes.
- **Line, arrow, rectangle, and ellipse**: draw shapes.
- **Text**: place a text note, or select an existing note to edit it.
- **Move**: reposition an existing annotation.
- **Eraser**: remove annotations touched by the eraser.
- **Undo and redo**: move backward or forward through annotation changes made while the PDF is open.
- **Clear page**: remove every annotation from the current page.

Press `1` through `8` to select the tools in toolbar order, or `0` for the eraser. The toolbar can be dragged, moved with the arrow keys from its drag handle, and switched between horizontal and vertical layouts.

Annotations use page-relative coordinates, so they stay aligned with the page when the PDF zoom changes.

## Page Color

Use the page-color selector in the PDF navigation toolbar to choose **Original**, **Warm**, **Gray**, or **Dark**. The setting is saved with the PDF view state. It only changes the on-screen preview; the original PDF and exported copies keep their original colors.

## Saving and Status

Annotations save automatically after drawing, erasing, undoing, redoing, or clearing a page. The fixed status indicator at the end of the annotation toolbar shows:

- A spinner while saving.
- A check when the latest changes have been saved.
- An error indicator if saving fails.

There is no separate Save command for PDF annotations.

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

Sidecars created by earlier Pi Cloud versions used `.<document filename>.annotations.json` or the visible `<document filename>.annotations.json` beside the document. These files are still loaded for compatibility. After the next annotation change, Pi Cloud saves the annotations in `.annotations`; the old file can then be removed manually.

The sidecar is a regular workspace file and is subject to the same allowed-root and filesystem permissions as other editor files. Pi Cloud must have write permission in the document's directory to create `.annotations` and save annotations.

## Back Up, Move, or Share Annotations

Keep the document and its `.annotations` sidecar file together when backing up, copying, moving, renaming, or sharing an annotated document. Pi Cloud matches them by filename and location; moving or renaming only the document does not automatically move or rename its sidecar.

To remove all saved annotations, show hidden files, delete the corresponding `.annotations/<document filename>.annotations.json` sidecar, and reopen the document.

## Current Limitations

- Annotations are displayed by Pi Cloud and are not embedded into the PDF.
- Opening the original PDF in another PDF reader will not show the sidecar annotations.
- Exporting or flattening annotations into a new PDF is not currently supported.
- Exporting individual annotations to other annotation formats is not currently supported.
