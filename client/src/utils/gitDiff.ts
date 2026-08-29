export interface DiffFile {
  name: string;
  lines: string[];
  additions: number;
  deletions: number;
}

export interface SplitDiffRow {
  left: string | null;
  right: string | null;
}

interface ParseDiffOptions {
  mergeByName?: boolean;
}

export function parseDiffFiles(diff: string, fallbackName: string, options: ParseDiffOptions = {}): DiffFile[] {
  const files: DiffFile[] = [];
  const filesByName = options.mergeByName ? new Map<string, DiffFile>() : undefined;
  let current: DiffFile | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      const name = line.match(/ b\/(.+)$/)?.[1]
        || line.replace(/^diff --(?:cc|combined) /, '')
        || fallbackName;
      current = filesByName?.get(name);
      if (current) {
        current.lines.push(line);
      } else {
        current = { name, lines: [line], additions: 0, deletions: 0 };
        filesByName?.set(name, current);
        files.push(current);
      }
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }

  return files;
}

export function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return 'is-hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'is-added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'is-removed';
  if (line.startsWith('diff --') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'is-metadata';
  return '';
}

// Pair each contiguous removal/addition block so corresponding edits share a split row.
export function pairDiffLines(lines: string[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const isRemoval = line.startsWith('-') && !line.startsWith('---');
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    if (!isRemoval && !isAddition) {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }

    const removals: string[] = [];
    const additions: string[] = [];
    while (index < lines.length && lines[index].startsWith('-') && !lines[index].startsWith('---')) removals.push(lines[index++]);
    while (index < lines.length && lines[index].startsWith('+') && !lines[index].startsWith('+++')) additions.push(lines[index++]);

    const rowCount = Math.max(removals.length, additions.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      rows.push({ left: removals[rowIndex] ?? null, right: additions[rowIndex] ?? null });
    }
  }
  return rows;
}
