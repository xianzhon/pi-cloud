import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedSkills } from './managed-skills';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'managed-skills-test-'));
  directories.push(root);
  return { root, service: new ManagedSkills(join(root, 'skills')) };
}
const markdown = (name: string) => `---\nname: ${name}\ndescription: Test skill\n---\n\n# Instructions\n`;

describe('managed skills', () => {
  it('adds and updates only SKILL.md without replacing other files', async () => {
    const { root, service } = await setup();
    await service.save('my-skill', markdown('my-skill'));
    await fs.writeFile(join(root, 'skills', 'my-skill', 'helper.sh'), 'helper');
    await expect(service.save('my-skill', markdown('my-skill'))).rejects.toThrow('already exists');
    await service.save('my-skill', markdown('my-skill') + 'Updated', true);
    expect(await service.list()).toEqual([{ name: 'my-skill', content: markdown('my-skill') + 'Updated' }]);
    expect(await fs.readFile(join(root, 'skills', 'my-skill', 'helper.sh'), 'utf8')).toBe('helper');
  });

  it('deletes a shared skill and its supporting files without touching other directories', async () => {
    const { root, service } = await setup();
    await service.save('example', markdown('example'));
    await fs.writeFile(join(root, 'skills', 'example', 'helper.sh'), 'helper');
    await service.save('other', markdown('other'));
    await service.delete('example');
    expect(await service.list()).toEqual([{ name: 'other', content: markdown('other') }]);
    await expect(fs.lstat(join(root, 'skills', 'example'))).rejects.toThrow();
    await expect(service.delete('example')).rejects.toThrow('not found');
  });

  it('refuses to delete unsafe names, symlinks, and non-skill directories', async () => {
    const { root, service } = await setup();
    const skills = join(root, 'skills');
    await fs.mkdir(join(skills, 'ordinary'), { recursive: true });
    await fs.symlink(join(skills, 'ordinary'), join(skills, 'linked'));
    await fs.mkdir(join(skills, 'linked-file'));
    await fs.symlink(join(skills, 'ordinary'), join(skills, 'linked-file', 'SKILL.md'));
    await expect(service.delete('../outside')).rejects.toThrow('Skill name');
    await expect(service.delete('ordinary')).rejects.toThrow('not a regular skill');
    await expect(service.delete('linked')).rejects.toThrow('not a regular skill');
    await expect(service.delete('linked-file')).rejects.toThrow('not a regular skill');
    expect(await fs.readdir(skills)).toEqual(['linked', 'linked-file', 'ordinary']);
  });

  it('rejects unsafe names and invalid skill content', async () => {
    const { service } = await setup();
    await expect(service.save('../outside', markdown('outside'))).rejects.toThrow('Skill name');
    await expect(service.save('safe', markdown('other'))).rejects.toThrow('matching name');
    await expect(service.save('missing', markdown('missing'), true)).rejects.toThrow('not found');
    await expect(service.clone('https://github.com.evil.test/a/b')).rejects.toThrow('github.com');
    await expect(service.clone('https://github.com/a/b/tree/main/../outside')).rejects.toThrow();
  });

  it('clones a GitHub skill directory without the repository metadata', async () => {
    const { root, service } = await setup();
    const bin = join(root, 'bin');
    const fixture = join(root, 'fixture');
    await fs.mkdir(bin);
    await fs.mkdir(join(fixture, 'skills', 'example'), { recursive: true });
    await fs.mkdir(join(fixture, '.git'));
    await fs.writeFile(join(fixture, 'skills', 'example', 'SKILL.md'), markdown('example'));
    await fs.writeFile(join(bin, 'git'), '#!/bin/sh\nfor dest; do :; done\ncp -R "$SKILL_TEST_FIXTURE" "$dest"\n', { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath}`;
    process.env.SKILL_TEST_FIXTURE = fixture;
    try {
      expect(await service.clone('https://github.com/owner/repo/tree/main/skills/example')).toBe('example');
      expect(await service.list()).toEqual([{ name: 'example', content: markdown('example') }]);
      await expect(fs.lstat(join(root, 'skills', 'example', '.git'))).rejects.toThrow();
      await expect(service.clone('https://github.com/owner/repo/tree/main/skills/example')).rejects.toThrow('already exists');
    } finally {
      process.env.PATH = originalPath;
      delete process.env.SKILL_TEST_FIXTURE;
    }
  });

  it('reports GitHub clone failure and leaves no skill', async () => {
    const { root, service } = await setup();
    const bin = join(root, 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(join(bin, 'git'), '#!/bin/sh\necho "repository unavailable" >&2\nexit 128\n', { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath}`;
    try {
      await expect(service.clone('https://github.com/owner/example')).rejects.toThrow('GitHub clone failed');
      expect(await service.list()).toEqual([]);
      expect(await fs.readdir(root)).toEqual(['bin']);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
