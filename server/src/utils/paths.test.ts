import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { expandHomePath } from './paths';

describe('expandHomePath', () => {
  it('returns the home directory for missing or bare tilde input', () => {
    expect(expandHomePath()).toBe(os.homedir());
    expect(expandHomePath('~')).toBe(os.homedir());
  });

  it('expands paths that start with tilde slash', () => {
    expect(expandHomePath('~/projects/pi-cloud')).toBe(path.join(os.homedir(), 'projects/pi-cloud'));
  });

  it('leaves non-home paths unchanged', () => {
    expect(expandHomePath('/tmp/project')).toBe('/tmp/project');
    expect(expandHomePath('relative/project')).toBe('relative/project');
  });
});
