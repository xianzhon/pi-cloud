import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let directory: string;
let source: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'pi-cloud-editor-check-'));
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'src/components'), { recursive: true });
  await cp(path.join(import.meta.dirname, 'test-editor-panel.mjs'), path.join(directory, 'scripts/test-editor-panel.mjs'));
  await cp(path.resolve(import.meta.dirname, '../src/components/FileTreeNode.vue'), path.join(directory, 'src/components/FileTreeNode.vue'));
  source = await readFile(path.resolve(import.meta.dirname, '../src/components/EditorPanel.vue'), 'utf8');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function check(editorSource: string) {
  await writeFile(path.join(directory, 'src/components/EditorPanel.vue'), editorSource);
  return spawnSync(process.execPath, [path.join(directory, 'scripts/test-editor-panel.mjs')], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 5000,
  });
}

describe('editor standalone self-check', () => {
  it('accepts modal confirmation and Monaco models outside reactive tabs', async () => {
    const result = await check(source);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('rejects a Monaco model added to the reactive Tab interface', async () => {
    const result = await check(source.replace('interface Tab {', 'interface Tab {\n  model: monaco.editor.ITextModel;'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Reactive tab state does not contain Monaco model objects');
  });

  it('rejects closing a dirty tab without confirmation even if other actions confirm', async () => {
    const start = source.indexOf('async function closeTab(');
    const end = source.indexOf('\nfunction pinTab(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const result = await check(source.slice(0, start) + 'async function closeTab(filePath: string) {\n  removeOpenTab(filePath);\n}\n' + source.slice(end));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Closing a dirty tab asks for confirmation');
  });
});
