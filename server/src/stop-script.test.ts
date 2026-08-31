import { execFile, spawn } from 'child_process';
import { once } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const sourceScript = new URL('../../stop.sh', import.meta.url);
const sourceStartScript = new URL('../../start.sh', import.meta.url);
const temporaryRoots: string[] = [];

async function processStartTime(pid: number): Promise<string> {
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart=']);
  return stdout.trim();
}

async function recordProcess(projectDir: string, name: string, pid: number): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(projectDir, '.pids', `${name}.pid`), String(pid)),
    fs.writeFile(path.join(projectDir, '.pids', `${name}.start`), await processStartTime(pid)),
  ]);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe.runIf(process.platform !== 'win32')('stop.sh', () => {
  it('migrates matching legacy server and client PID records when starting', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-start-legacy-'));
    temporaryRoots.push(projectDir);
    await Promise.all([
      fs.mkdir(path.join(projectDir, 'server', 'src'), { recursive: true }),
      fs.mkdir(path.join(projectDir, 'client'), { recursive: true }),
    ]);
    await Promise.all([
      fs.mkdir(path.join(projectDir, '.pids')),
      fs.mkdir(path.join(projectDir, '.logs')),
      fs.mkdir(path.join(projectDir, 'server', 'node_modules'), { recursive: true }),
      fs.mkdir(path.join(projectDir, 'client', 'node_modules'), { recursive: true }),
      fs.copyFile(sourceStartScript, path.join(projectDir, 'start.sh')),
      fs.writeFile(path.join(projectDir, '.env'), 'PORT=65427\nFRONTEND_PORT=65428\n'),
      fs.writeFile(path.join(projectDir, 'server', 'src', 'index.ts'), 'setInterval(() => {}, 1000);\n'),
      fs.writeFile(path.join(projectDir, 'client', 'vite'), 'setInterval(() => {}, 1000);\n'),
    ]);

    const server = spawn(process.execPath, ['src/index.ts'], {
      cwd: path.join(projectDir, 'server'),
      stdio: 'ignore',
    });
    const client = spawn(process.execPath, ['vite'], {
      cwd: path.join(projectDir, 'client'),
      stdio: 'ignore',
    });
    await Promise.all([once(server, 'spawn'), once(client, 'spawn')]);
    await Promise.all([
      fs.writeFile(path.join(projectDir, '.pids', 'server.pid'), String(server.pid)),
      fs.writeFile(path.join(projectDir, '.pids', 'client.pid'), String(client.pid)),
    ]);

    try {
      const result = await execFileAsync('bash', [path.join(projectDir, 'start.sh')], {
        env: { ...process.env, PORT: '65427', FRONTEND_PORT: '65428' },
      });

      expect(result.stdout).toContain('Server already running');
      expect(result.stdout).toContain('Client already running');
      await expect(fs.readFile(path.join(projectDir, '.pids', 'server.start'), 'utf8'))
        .resolves.toBe(`${await processStartTime(server.pid!)}\n`);
      await expect(fs.readFile(path.join(projectDir, '.pids', 'client.start'), 'utf8'))
        .resolves.toBe(`${await processStartTime(client.pid!)}\n`);
    } finally {
      for (const child of [server, client]) {
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }
  }, 15_000);

  it('refuses to terminate a stale PID that belongs to another working directory', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-stop-project-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-stop-outside-'));
    temporaryRoots.push(projectDir, outsideDir);
    await fs.mkdir(path.join(outsideDir, 'src'));
    await Promise.all([
      fs.mkdir(path.join(projectDir, '.pids')),
      fs.mkdir(path.join(projectDir, 'server')),
      fs.mkdir(path.join(projectDir, 'client')),
      fs.copyFile(sourceScript, path.join(projectDir, 'stop.sh')),
      fs.writeFile(path.join(projectDir, '.env'), 'PORT=65431\nFRONTEND_PORT=65432\n'),
      fs.writeFile(path.join(outsideDir, 'src', 'index.ts'), 'setInterval(() => {}, 1000);\n'),
    ]);

    const unrelated = spawn(process.execPath, ['src/index.ts'], {
      cwd: outsideDir,
      stdio: 'ignore',
    });
    await once(unrelated, 'spawn');
    await recordProcess(projectDir, 'server', unrelated.pid!);

    try {
      const result = await execFileAsync('bash', [path.join(projectDir, 'stop.sh')], {
        env: { ...process.env, PORT: '65431', FRONTEND_PORT: '65432' },
      });

      expect(unrelated.exitCode).toBeNull();
      expect(result.stdout).toContain('Refusing to stop server');
    } finally {
      if (unrelated.exitCode === null) {
        const exited = once(unrelated, 'exit');
        unrelated.kill('SIGKILL');
        await Promise.race([
          exited,
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    }
  }, 15_000);

  it('terminates a verified Pi Cloud server process from the recorded PID', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-stop-owned-'));
    temporaryRoots.push(projectDir);
    await fs.mkdir(path.join(projectDir, 'server', 'src'), { recursive: true });
    await Promise.all([
      fs.mkdir(path.join(projectDir, '.pids')),
      fs.mkdir(path.join(projectDir, 'client')),
      fs.copyFile(sourceScript, path.join(projectDir, 'stop.sh')),
      fs.writeFile(path.join(projectDir, '.env'), 'PORT=65433\nFRONTEND_PORT=65434\n'),
      fs.writeFile(path.join(projectDir, 'server', 'src', 'index.ts'), 'setInterval(() => {}, 1000);\n'),
    ]);

    const server = spawn(process.execPath, ['src/index.ts'], {
      cwd: path.join(projectDir, 'server'),
      stdio: 'ignore',
    });
    await once(server, 'spawn');
    await recordProcess(projectDir, 'server', server.pid!);

    try {
      const result = await execFileAsync('bash', [path.join(projectDir, 'stop.sh')], {
        env: { ...process.env, PORT: '65433', FRONTEND_PORT: '65434' },
      });
      if (server.exitCode === null) {
        await Promise.race([
          once(server, 'exit'),
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }

      expect(result.stdout).toContain('Stopping server');
      expect(server.exitCode !== null || server.signalCode !== null).toBe(true);
    } finally {
      if (server.exitCode === null) server.kill('SIGKILL');
    }
  }, 15_000);

  it('refuses to terminate a matching process when its recorded start identity is stale', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-cloud-stop-reused-'));
    temporaryRoots.push(projectDir);
    await fs.mkdir(path.join(projectDir, 'server', 'src'), { recursive: true });
    await Promise.all([
      fs.mkdir(path.join(projectDir, '.pids')),
      fs.mkdir(path.join(projectDir, 'client')),
      fs.copyFile(sourceScript, path.join(projectDir, 'stop.sh')),
      fs.writeFile(path.join(projectDir, '.env'), 'PORT=65435\nFRONTEND_PORT=65436\n'),
      fs.writeFile(path.join(projectDir, 'server', 'src', 'index.ts'), 'setInterval(() => {}, 1000);\n'),
    ]);

    const server = spawn(process.execPath, ['src/index.ts'], {
      cwd: path.join(projectDir, 'server'),
      stdio: 'ignore',
    });
    await once(server, 'spawn');
    await fs.writeFile(path.join(projectDir, '.pids', 'server.pid'), String(server.pid));
    await fs.writeFile(path.join(projectDir, '.pids', 'server.start'), 'stale process identity');

    try {
      const result = await execFileAsync('bash', [path.join(projectDir, 'stop.sh')], {
        env: { ...process.env, PORT: '65435', FRONTEND_PORT: '65436' },
      });

      expect(server.exitCode).toBeNull();
      expect(result.stdout).toContain('Refusing to stop server');
    } finally {
      if (server.exitCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGKILL');
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
      }
    }
  }, 15_000);
});
