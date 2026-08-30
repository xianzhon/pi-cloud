import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';

const MAX_ENTRIES = 10_000;
const MAX_ZIP_DIRECTORY_SIZE = 32 * 1024 * 1024;
const MAX_TAR_CONTENT_SIZE = 1024 * 1024 * 1024;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_ENTRY_SIGNATURE = 0x02014b50;

export function isArchivePath(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return ['.zip', '.jar', '.war', '.ear', '.apk', '.tar', '.tar.gz', '.tgz']
    .some(suffix => lowerPath.endsWith(suffix));
}

export async function archivePreview(filePath: string): Promise<string> {
  const lowerPath = filePath.toLowerCase();
  const result = lowerPath.endsWith('.tar') || lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz')
    ? await listTarEntries(filePath, lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz'))
    : await listZipEntries(filePath);

  const count = result.total ?? result.entries.length;
  const qualifier = result.total === undefined && result.truncated ? 'at least ' : '';
  const lines = [`Archive contents (${qualifier}${count} entries)`, '', ...result.entries];
  if (result.truncated) lines.push('', `[Preview truncated for safety after ${result.entries.length.toLocaleString('en-US')} entries]`);
  return lines.join('\n');
}

interface ArchiveEntries {
  entries: string[];
  total?: number;
  truncated: boolean;
}

async function listZipEntries(filePath: string): Promise<ArchiveEntries> {
  const file = await open(filePath, 'r');
  try {
    const stats = await file.stat();
    const tailSize = Math.min(stats.size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tailSize, stats.size - tailSize);

    const endOffset = findSignatureBackwards(tail, ZIP_END_SIGNATURE);
    if (endOffset < 0 || endOffset + 22 > tail.length) throw new Error('Invalid ZIP archive');

    const total = tail.readUInt16LE(endOffset + 10);
    const directorySize = tail.readUInt32LE(endOffset + 12);
    const directoryOffset = tail.readUInt32LE(endOffset + 16);
    if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new Error('ZIP64 archives are not supported for preview');
    }
    if (directorySize > MAX_ZIP_DIRECTORY_SIZE || directoryOffset + directorySize > stats.size) {
      throw new Error('ZIP directory is too large to preview');
    }

    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);
    const entries: string[] = [];
    let offset = 0;
    for (let index = 0; index < total; index += 1) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== ZIP_ENTRY_SIGNATURE) {
        throw new Error('Invalid ZIP directory');
      }
      const flags = directory.readUInt16LE(offset + 8);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (nextOffset > directory.length) throw new Error('Invalid ZIP directory');
      if (entries.length < MAX_ENTRIES) {
        const name = directory.subarray(offset + 46, offset + 46 + nameLength);
        entries.push(name.toString(flags & 0x800 ? 'utf8' : 'latin1'));
      }
      offset = nextOffset;
    }

    return { entries, total, truncated: total > entries.length };
  } finally {
    await file.close();
  }
}

function findSignatureBackwards(buffer: Buffer, signature: number): number {
  for (let offset = buffer.length - 4; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function listTarEntries(filePath: string, gzipped: boolean): Promise<ArchiveEntries> {
  return new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    const decoder = gzipped ? createGunzip() : undefined;
    const archive = extract();
    const archiveSink = archive as unknown as NodeJS.WritableStream;
    const entries: string[] = [];
    let representedSize = 0;
    let settled = false;

    const finish = (result?: ArchiveEntries, error?: Error) => {
      if (settled) return;
      settled = true;
      if (result) resolve(result);
      else reject(error);
    };
    const stopWithPartialList = () => {
      finish({ entries, truncated: true });
      input.destroy();
      decoder?.destroy();
      archive.destroy();
    };

    archive.on('entry', (header, stream, next) => {
      representedSize += header.size;
      if (entries.length >= MAX_ENTRIES || representedSize > MAX_TAR_CONTENT_SIZE) {
        stream.resume();
        stopWithPartialList();
        return;
      }
      entries.push(header.name);
      stream.on('end', next);
      stream.resume();
    });
    archive.on('finish', () => finish({ entries, total: entries.length, truncated: false }));
    archive.on('error', error => finish(undefined, error));
    input.on('error', error => finish(undefined, error));
    decoder?.on('error', error => finish(undefined, error));

    if (decoder) input.pipe(decoder).pipe(archiveSink);
    else input.pipe(archiveSink);
  });
}
