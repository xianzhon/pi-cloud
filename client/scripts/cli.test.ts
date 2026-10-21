import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pi-cloud-cli-'));
  await cp(path.resolve(import.meta.dirname, '../../bin'), path.join(directory, 'bin'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '9.8.7' }));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(...args: string[]) {
  // No server bundle in the fixture: informational and invalid flags must exit before starting it.
  return spawnSync(process.execPath, [path.join(directory, 'bin/pi-cloud.mjs'), ...args], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 5000,
  });
}

describe('packaged CLI', () => {
  it.each(['-v', '--version'])('reads its own package version for %s from an unrelated cwd', (flag) => {
    const result = run(flag);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('9.8.7');
    expect(result.stderr).toBe('');
  });

  it.each(['-h', '--help'])('prints help for %s without loading the server', (flag) => {
    const result = run(flag);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pi-cloud [options]');
    expect(result.stderr).toBe('');
  });

  it.each([
    [['--unknown'], 'Unknown option: --unknown'],
    [['--port'], '--port requires a value'],
    [['-H', '--no-open'], '-H requires a value'],
  ])('rejects invalid arguments %j before loading the server', (args, message) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(message);
  });
});
