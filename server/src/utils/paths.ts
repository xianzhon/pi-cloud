import * as os from 'os';
import * as path from 'path';

export function expandHomePath(inputPath?: string): string {
  if (!inputPath || inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}
