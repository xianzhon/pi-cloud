import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SkillInputError extends Error {}

function checkName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length > 64 || !validName.test(name)) {
    throw new SkillInputError('Skill name must be 1-64 lowercase letters, numbers, or single hyphens');
  }
}

function checkContent(name: string, content: unknown): asserts content is string {
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 1024 * 1024) {
    throw new SkillInputError('SKILL.md content is required (maximum 1 MB)');
  }
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  const declared = header?.match(/^name:\s*['"]?([^\s'"#]+)['"]?\s*$/m)?.[1];
  if (declared !== name || !/^description:\s*\S/m.test(header || '')) {
    throw new SkillInputError('SKILL.md must declare the matching name and a description in YAML frontmatter');
  }
}

export class ManagedSkills {
  constructor(private readonly root: string = join(homedir(), '.agents', 'skills')) {}

  private directory(name: string) {
    checkName(name);
    return join(this.root, name);
  }

  async list() {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return (await Promise.all(entries.filter((entry) => entry.isDirectory() && validName.test(entry.name)).map(async (entry) => {
      const file = join(this.root, entry.name, 'SKILL.md');
      if (!await fs.lstat(file).then((stat) => stat.isFile(), () => false)) return null;
      return { name: entry.name, content: await fs.readFile(file, 'utf8') };
    }))).filter((skill): skill is { name: string; content: string } => skill !== null);
  }

  async save(name: string, content: string, update = false) {
    const directory = this.directory(name);
    checkContent(name, content);
    const exists = await fs.lstat(directory).then(() => true, () => false);
    if (update && !exists) throw new SkillInputError('Skill not found');
    if (!update && exists) throw new SkillInputError('Skill already exists');
    if (update) {
      const file = join(directory, 'SKILL.md');
      if (!(await fs.lstat(directory)).isDirectory()
        || !await fs.lstat(file).then((stat) => stat.isFile(), () => false)) {
        throw new SkillInputError('Cannot edit a symlink or non-skill directory');
      }
      const temporary = join(directory, `.SKILL-${Date.now()}-${process.pid}.tmp`);
      try {
        await fs.writeFile(temporary, content, { flag: 'wx' });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    } else {
      await fs.mkdir(this.root, { recursive: true });
      await fs.mkdir(directory);
      try {
        await fs.writeFile(join(directory, 'SKILL.md'), content, { flag: 'wx' });
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
      }
    }
  }

  async clone(url: string) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new SkillInputError('Enter an HTTPS GitHub repository URL'); }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) {
      throw new SkillInputError('Enter an HTTPS github.com repository URL');
    }
    const repo = parts[1].replace(/\.git$/, '');
    const subpath = parts.length > 2 ? parts.slice(4) : [];
    if (parts.length > 2 && (parts[2] !== 'tree' || parts.length < 5)) throw new SkillInputError('Use a repository URL or /tree/<branch>/<skill-path>');
    if (subpath.some((part) => part === '.' || part === '..' || !/^[\w.-]+$/.test(part))) throw new SkillInputError('Invalid skill path');
    const name = subpath.length ? subpath.at(-1)! : repo;
    const destination = this.directory(name);
    if (await fs.lstat(destination).then(() => true, () => false)) throw new SkillInputError('Skill already exists');
    const temporary = await fs.mkdtemp(join(tmpdir(), 'pi-cloud-skill-'));
    let created = false;
    try {
      const args = ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--filter=blob:none', '--single-branch'];
      if (subpath.length) args.push('--branch', parts[3]);
      args.push(`https://github.com/${parts[0]}/${repo}.git`, join(temporary, 'repo'));
      try {
        await execFileAsync('git', args, { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } });
      } catch (error) {
        throw new SkillInputError(`GitHub clone failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const source = join(temporary, 'repo', ...subpath);
      if (!await fs.lstat(source).then((stat) => stat.isDirectory(), () => false)
        || !await fs.lstat(join(source, 'SKILL.md')).then((stat) => stat.isFile(), () => false)) {
        throw new SkillInputError('Repository path has no regular SKILL.md');
      }
      const content = await fs.readFile(join(source, 'SKILL.md'), 'utf8');
      checkContent(name, content);
      // Never publish links into an untrusted checkout as managed skills.
      async function checkTree(dir: string): Promise<void> {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw new SkillInputError('Skills containing symlinks cannot be cloned');
          if (entry.isDirectory()) await checkTree(join(dir, entry.name));
        }
      }
      await checkTree(source);
      await fs.mkdir(this.root, { recursive: true });
      await fs.mkdir(destination);
      created = true;
      await fs.cp(source, destination, { recursive: true, force: false, filter: (path) => !path.split(sep).includes('.git') });
      return name;
    } catch (error) {
      // Do not leave a partially copied skill behind.
      if (created) await fs.rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
