import { access, rename, stat } from 'fs/promises';
import { join, relative, sep } from 'path';

export interface MoveProjectOptions {
  oldProjectPath: string;
  destinationParentPath: string;
  newProjectName: string;
}

export interface MoveProjectResult {
  projectPath: string;
}

export class ProjectMover {
  async move(options: MoveProjectOptions): Promise<MoveProjectResult> {
    const projectName = this.validateProjectName(options.newProjectName);
    const oldProjectPath = options.oldProjectPath;
    const destinationParentPath = options.destinationParentPath;
    const projectPath = join(destinationParentPath, projectName);

    await this.assertDirectory(oldProjectPath, 'Current project folder does not exist');
    await this.assertDirectory(destinationParentPath, 'Destination parent folder does not exist');
    this.assertNotInsideSource(oldProjectPath, projectPath);
    await this.assertMissing(projectPath);

    await rename(oldProjectPath, projectPath);
    return { projectPath };
  }

  private validateProjectName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
      throw new Error('Project folder name must be a single folder name');
    }
    return trimmed;
  }

  private async assertDirectory(path: string, message: string): Promise<void> {
    try {
      const stats = await stat(path);
      if (!stats.isDirectory()) throw new Error(message);
    } catch (error: unknown) {
      if (isMissingPathError(error)) throw new Error(message);
      throw error;
    }
  }

  private assertNotInsideSource(source: string, destination: string): void {
    const rel = relative(source, destination);
    if (rel && !rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`)) {
      throw new Error('Cannot move a project inside itself');
    }
  }

  private async assertMissing(path: string): Promise<void> {
    try {
      await access(path);
      throw new Error('Destination project folder already exists');
    } catch (error: unknown) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

export const projectMover = new ProjectMover();
