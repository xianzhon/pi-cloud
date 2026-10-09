import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { listProfileExtensions, setProfileExtension } from './profile-extensions.js';

let root: string;
let profile: string;
const readSettings = () => JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'));
const saveSettings = (settings: unknown) => writeFileSync(join(profile, 'settings.json'), JSON.stringify(settings));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pi-cloud-extensions-'));
  profile = join(root, 'profile');
  mkdirSync(profile);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('profile extension packages', () => {
  it('lists package strings and disabled package objects', () => {
    saveSettings({ packages: ['npm:pi-mcp-adapter', { source: 'npm:pi-subagents', extensions: [] }] });
    expect(listProfileExtensions(profile)).toEqual([
      { source: 'npm:pi-mcp-adapter', enabled: true },
      { source: 'npm:pi-subagents', enabled: false },
    ]);
  });

  it('disables and re-enables a package while preserving other settings', () => {
    saveSettings({ defaultModel: 'test', packages: ['npm:pi-subagents', 'npm:pi-mcp-adapter'] });
    setProfileExtension(profile, 'npm:pi-subagents', false);
    setProfileExtension(profile, 'npm:pi-subagents', false);
    expect(readSettings()).toEqual({ defaultModel: 'test', packages: [{ source: 'npm:pi-subagents', extensions: [] }, 'npm:pi-mcp-adapter'] });
    expect(setProfileExtension(profile, 'npm:pi-subagents', true)[0].enabled).toBe(true);
    expect(readSettings().packages[0]).toEqual({ source: 'npm:pi-subagents' });
  });

  it('restores existing extension filters without altering other resource filters', () => {
    const entry = { source: 'npm:example', extensions: ['extensions/*.ts', '!extensions/legacy.ts'], skills: [], prompts: ['prompts/review.md'], autoload: false };
    saveSettings({ packages: [entry] });
    setProfileExtension(profile, entry.source, false);
    setProfileExtension(profile, entry.source, false);
    expect(readSettings().packages[0].extensions).toEqual([]);
    setProfileExtension(profile, entry.source, true);
    expect(readSettings().packages[0]).toEqual(entry);
  });

  it('rejects unknown packages and malformed requests without rewriting settings', () => {
    saveSettings({ packages: ['npm:example'] });
    const before = readFileSync(join(profile, 'settings.json'), 'utf8');
    expect(() => setProfileExtension(profile, 'npm:missing', false)).toThrow('Unknown extension package');
    expect(() => setProfileExtension(profile, 'npm:example', 'false' as unknown as boolean)).toThrow('required');
    expect(readFileSync(join(profile, 'settings.json'), 'utf8')).toBe(before);
  });

  it('does not replace malformed JSON', () => {
    writeFileSync(join(profile, 'settings.json'), '{bad');
    expect(() => setProfileExtension(profile, 'npm:example', false)).toThrow();
    expect(readFileSync(join(profile, 'settings.json'), 'utf8')).toBe('{bad');
  });

  it('prevents SDK extension loading but retains package skills', async () => {
    const packagePath = join(root, 'package');
    mkdirSync(join(packagePath, 'extensions'), { recursive: true });
    mkdirSync(join(packagePath, 'skills', 'example'), { recursive: true });
    writeFileSync(join(packagePath, 'package.json'), JSON.stringify({ name: 'test-package' }));
    writeFileSync(join(packagePath, 'extensions', 'tool.ts'), 'export default function (pi) { pi.registerTool({ name: "profile_test", label: "Test", description: "Test", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) }); }');
    writeFileSync(join(packagePath, 'skills', 'example', 'SKILL.md'), '---\nname: example\ndescription: Test skill\n---\nTest instructions.');
    saveSettings({ packages: [packagePath] });
    const load = async () => {
      const loader = new DefaultResourceLoader({ cwd: root, agentDir: profile });
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      expect(loader.getSkills().skills.map(skill => skill.name)).toContain('example');
      return loader.getExtensions().extensions.flatMap(extension => [...extension.tools.keys()]);
    };
    expect(await load()).toContain('profile_test');
    setProfileExtension(profile, packagePath, false);
    expect(await load()).not.toContain('profile_test');
    setProfileExtension(profile, packagePath, true);
    expect(await load()).toContain('profile_test');
  });
});
