# PDF Annotations User Manual

Pi WebUI lets you annotate PDF files opened in the workspace editor. Annotations are stored separately, so editing does not modify the original PDF.

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

## Saving and Status

Annotations save automatically after drawing, erasing, undoing, redoing, or clearing a page. The fixed status indicator at the end of the annotation toolbar shows:

- A spinner while saving.
- A check when the latest changes have been saved.
- An error indicator if saving fails.

There is no separate Save command for PDF annotations.

## Storage Location

Pi WebUI writes annotations to a JSON sidecar file beside the PDF:

```text
<PDF directory>/.<PDF filename>.annotations.json
```

For example:

```text
/books/example.pdf
/books/.example.pdf.annotations.json
```

The leading `.` makes the sidecar hidden in the default Pi WebUI file-tree view. Enable **Show hidden files** in the file tree when you need to see or manage it. The sidecar contains vector strokes grouped by PDF page, and the original `example.pdf` remains unchanged.

Sidecars created by earlier Pi WebUI versions used the visible name `example.pdf.annotations.json`. These files are still loaded for compatibility. After the next annotation change, Pi WebUI saves the annotations under the new hidden name; the old file can then be removed manually.

The sidecar is a regular workspace file and is subject to the same allowed-root and filesystem permissions as other editor files. Pi WebUI must have write permission in the PDF's directory to save annotations.

## Back Up, Move, or Share Annotations

Keep the PDF and its sidecar file together when backing up, copying, moving, renaming, or sharing an annotated document. Pi WebUI matches them by filename and location; moving or renaming only the PDF does not automatically move or rename its sidecar.

To remove all saved annotations, show hidden files, delete the corresponding `.<PDF filename>.annotations.json` sidecar, and reopen the PDF.

## Current Limitations

- Annotations are displayed by Pi WebUI and are not embedded into the PDF.
- Opening the original PDF in another PDF reader will not show the sidecar annotations.
- Exporting or flattening annotations into a new PDF is not currently supported.
- Exporting individual annotations to other annotation formats is not currently supported.
