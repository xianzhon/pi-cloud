import { access, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'fs/promises';
import { basename, join } from 'path';

interface RelocateSessionFileOptions {
  sessionId: string;
  sourceSessionDir: string;
  destinationSessionDir: string;
  expectedOldCwd: string;
  newCwd: string;
}

export interface RelocateSessionFilePlan {
  sourcePath: string;
  destinationPath: string;
  sourceExists: boolean;
}

interface RelocateSessionFileResult {
  sourcePath: string;
  destinationPath: string;
  relocated: boolean;
}

export interface RelocateProjectSessionFilesOptions {
  sourceSessionDir: string;
  destinationSessionDir: string;
  expectedOldCwd: string;
  newCwd: string;
}

export interface RelocateProjectSessionFilesResult {
  moved: number;
  skipped: number;
  conflicts: string[];
}

export class SessionFileRelocator {
  async plan(options: RelocateSessionFileOptions): Promise<RelocateSessionFilePlan> {
    const sourcePath = await this.findSourceSessionFile(options.sourceSessionDir, options.sessionId);
    const fallbackSourcePath = join(options.sourceSessionDir, `${options.sessionId}.jsonl`);
    const sourceFileName = sourcePath ? basename(sourcePath) : `${options.sessionId}.jsonl`;

    return {
      sourcePath: sourcePath || fallbackSourcePath,
      destinationPath: join(options.destinationSessionDir, sourceFileName),
      sourceExists: Boolean(sourcePath),
    };
  }

  async relocate(options: RelocateSessionFileOptions): Promise<RelocateSessionFileResult> {
    const plan = await this.plan(options);

    if (!plan.sourceExists) {
      await this.removeEmptySourceSessionDir(options.sourceSessionDir);
      return { sourcePath: plan.sourcePath, destinationPath: plan.destinationPath, relocated: false };
    }

    const sourcePath = plan.sourcePath;
    const destinationPath = plan.destinationPath;
    const movingPath = `${sourcePath}.moving`;
    const content = await readFile(sourcePath, 'utf8');

    await this.assertMissing(destinationPath);
    const rewrittenContent = this.rewriteCwdFields(content, options.expectedOldCwd, options.newCwd);

    await mkdir(options.destinationSessionDir, { recursive: true });
    await writeFile(movingPath, rewrittenContent);
    try {
      await rename(movingPath, destinationPath);
      await rm(sourcePath, { force: true });
      await this.removeEmptySourceSessionDir(options.sourceSessionDir);
    } catch (error) {
      await rm(movingPath, { force: true });
      throw error;
    }

    return { sourcePath, destinationPath, relocated: true };
  }

  async relocateProject(options: RelocateProjectSessionFilesOptions): Promise<RelocateProjectSessionFilesResult> {
    let entries: string[];
    try {
      entries = await readdir(options.sourceSessionDir);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { moved: 0, skipped: 0, conflicts: [] };
      throw error;
    }

    const sessionFiles = entries.filter((entry) => entry.endsWith('.jsonl'));
    const conflicts: string[] = [];
    for (const fileName of sessionFiles) {
      const destinationPath = join(options.destinationSessionDir, fileName);
      try {
        await access(destinationPath);
        conflicts.push(destinationPath);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    if (conflicts.length > 0) {
      throw new Error(`Destination session file already exists: ${conflicts.join(', ')}`);
    }

    await mkdir(options.destinationSessionDir, { recursive: true });
    let moved = 0;

    for (const fileName of sessionFiles) {
      const sourcePath = join(options.sourceSessionDir, fileName);
      const destinationPath = join(options.destinationSessionDir, fileName);
      const movingPath = `${sourcePath}.moving`;
      const content = await readFile(sourcePath, 'utf8');
      const rewrittenContent = this.rewriteCwdFields(content, options.expectedOldCwd, options.newCwd);

      await writeFile(movingPath, rewrittenContent);
      try {
        await rename(movingPath, destinationPath);
        await rm(sourcePath, { force: true });
        moved += 1;
      } catch (error) {
        await rm(movingPath, { force: true });
        throw error;
      }
    }

    await this.removeEmptySourceSessionDir(options.sourceSessionDir);
    return { moved, skipped: entries.length - sessionFiles.length, conflicts: [] };
  }

  private async findSourceSessionFile(sourceSessionDir: string, sessionId: string): Promise<string | null> {
    const exactPath = join(sourceSessionDir, `${sessionId}.jsonl`);
    try {
      await access(exactPath);
      return exactPath;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }

    let entries: string[];
    try {
      entries = await readdir(sourceSessionDir);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }

    const matches = entries.filter((entry) => entry.endsWith(`_${sessionId}.jsonl`));
    if (matches.length > 1) {
      throw new Error('Multiple source session files match session id');
    }
    return matches[0] ? join(sourceSessionDir, matches[0]) : null;
  }

  private rewriteCwdFields(content: string, expectedOldCwd: string, newCwd: string): string {
    const lines = content.split('\n');
    const header = JSON.parse(lines[0] || 'null');

    if (header?.type !== 'session') {
      throw new Error('Session file does not start with a session header');
    }
    if (header.cwd !== expectedOldCwd) {
      throw new Error('Session header cwd does not match expected worktree path');
    }

    return lines.map((line) => {
      if (!line) return line;
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && record.cwd === expectedOldCwd) {
        record.cwd = newCwd;
      }
      return JSON.stringify(record);
    }).join('\n');
  }

  private async removeEmptySourceSessionDir(path: string): Promise<void> {
    try {
      await rmdir(path);
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTEMPTY') return;
      throw error;
    }
  }

  private async assertMissing(path: string): Promise<void> {
    try {
      await access(path);
      throw new Error('Destination session file already exists');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

export const sessionFileRelocator = new SessionFileRelocator();
