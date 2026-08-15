#!/usr/bin/env node

import { homedir } from 'node:os';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadRuntimeConfig } from './runtime-config.mjs';

function printHelp() {
  console.log(`Usage: pi-webui [options]

Options:
  -p, --port <port>       Listen on this port (default: 3000)
  -H, --hostname <host>   Bind to this hostname (default: 127.0.0.1)
      --no-open           Do not open the browser
  -v, --version           Show the current version
  -h, --help              Show this help

Environment variables PORT and HOST are also supported.

Service commands:
  service install          Install and enable automatic startup
  service start            Start the service
  service stop             Stop the service
  service restart          Restart the service
  service status           Show service status
  service uninstall        Remove the service
  update [version]         Update the global npm installation
  update --check           Check for available updates`);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '-v' || arg === '--version') {
      console.log(installedVersion());
      process.exit(0);
    }
    if (arg === '--no-open') {
      options.noOpen = true;
      continue;
    }
    if (arg === '-p' || arg === '--port' || arg === '-H' || arg === '--hostname') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      options[arg === '-p' || arg === '--port' ? 'port' : 'hostname'] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

const SERVICE_NAME = 'pi-webui';
const SERVICE_LABEL = 'com.pi-webui';
const NPM_PACKAGE_NAME = '@xianzhon/pi-webui';
const scriptPath = fileURLToPath(import.meta.url);

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function spawnNpm(args, options) {
  if (process.platform === 'win32') {
    // npm is installed as npm.cmd on Windows, which must run through cmd.exe.
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], options);
  }
  return spawnSync('npm', args, options);
}

function runNpm(args) {
  const result = spawnNpm(args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm exited with status ${result.status}`);
}

function linuxServicePath() {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'systemd', 'user', `${SERVICE_NAME}.service`);
}

function macServicePath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function installLinuxService() {
  const servicePath = linuxServicePath();
  mkdirSync(join(servicePath, '..'), { recursive: true });
  writeFileSync(servicePath, `[Unit]\nDescription=Pi WebUI\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart="${process.execPath}" "${scriptPath}" --no-open\nWorkingDirectory=${homedir()}\nEnvironment=HOME=${homedir()}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`);
  runCommand('systemctl', ['--user', 'daemon-reload']);
  runCommand('systemctl', ['--user', 'enable', '--now', SERVICE_NAME]);
  console.log(`Installed Linux service at ${servicePath}`);
  console.log('To start automatically before login, enable user lingering with: sudo loginctl enable-linger "$USER"');
}

function installMacService() {
  const servicePath = macServicePath();
  mkdirSync(join(servicePath, '..'), { recursive: true });
  const xmlEscape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  writeFileSync(servicePath, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${SERVICE_LABEL}</string>\n<key>ProgramArguments</key><array><string>${xmlEscape(process.execPath)}</string><string>${xmlEscape(scriptPath)}</string><string>--no-open</string></array>\n<key>WorkingDirectory</key><string>${xmlEscape(homedir())}</string>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n</dict></plist>\n`);
  const domain = `gui/${process.getuid()}`;
  spawnSync('launchctl', ['bootout', domain, servicePath], { stdio: 'ignore' });
  runCommand('launchctl', ['bootstrap', domain, servicePath]);
  console.log(`Installed macOS LaunchAgent at ${servicePath}`);
}

function installWindowsService() {
  const taskCommand = `"${process.execPath}" "${scriptPath}" --no-open`;
  runCommand('schtasks', ['/Create', '/TN', SERVICE_NAME, '/SC', 'ONLOGON', '/TR', taskCommand, '/F']);
  runCommand('schtasks', ['/Run', '/TN', SERVICE_NAME]);
  console.log('Installed Windows startup task Pi WebUI.');
}

function installedVersion() {
  const packagePath = join(dirname(scriptPath), '..', 'package.json');
  return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

function updateCommand(version) {
  const currentVersion = installedVersion();
  if (version === '--check') {
    const result = spawnNpm(['view', NPM_PACKAGE_NAME, 'version', '--silent'], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.trim() || 'Could not check the latest version.');
    const latestVersion = result.stdout.trim();
    console.log(`Installed version: ${currentVersion}`);
    console.log(`Latest version: ${latestVersion}`);
    console.log(currentVersion === latestVersion ? 'Pi WebUI is up to date.' : 'An update is available. Run: pi-webui update');
    return;
  }

  if (version && !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) {
    throw new Error(`Invalid version or npm tag: ${version}`);
  }
  const packageSpec = version ? `${NPM_PACKAGE_NAME}@${version}` : `${NPM_PACKAGE_NAME}@latest`;
  runNpm(['install', '-g', packageSpec]);
  console.log(`Updated ${packageSpec}.`);
  console.log('If Pi WebUI is running as a service, restart it to use the new version:');
  console.log('  pi-webui service restart');
}

function serviceCommand(action) {
  if (!action) throw new Error('Usage: pi-webui service <install|start|stop|restart|status|uninstall>');

  if (process.platform === 'linux') {
    if (action === 'install') return installLinuxService();
    if (action === 'start') return runCommand('systemctl', ['--user', 'start', SERVICE_NAME]);
    if (action === 'stop') return runCommand('systemctl', ['--user', 'stop', SERVICE_NAME]);
    if (action === 'restart') return runCommand('systemctl', ['--user', 'restart', SERVICE_NAME]);
    if (action === 'status') return runCommand('systemctl', ['--user', 'status', SERVICE_NAME]);
    if (action === 'uninstall') {
      runCommand('systemctl', ['--user', 'disable', '--now', SERVICE_NAME]);
      rmSync(linuxServicePath(), { force: true });
      return runCommand('systemctl', ['--user', 'daemon-reload']);
    }
  } else if (process.platform === 'darwin') {
    const domain = `gui/${process.getuid()}`;
    const servicePath = macServicePath();
    if (action === 'install') return installMacService();
    if (action === 'start') return runCommand('launchctl', ['kickstart', `${domain}/${SERVICE_LABEL}`]);
    if (action === 'stop') return runCommand('launchctl', ['kill', 'SIGTERM', `${domain}/${SERVICE_LABEL}`]);
    if (action === 'restart') return runCommand('launchctl', ['kickstart', '-k', `${domain}/${SERVICE_LABEL}`]);
    if (action === 'status') return runCommand('launchctl', ['print', `${domain}/${SERVICE_LABEL}`]);
    if (action === 'uninstall') {
      runCommand('launchctl', ['bootout', domain, servicePath]);
      return rmSync(servicePath, { force: true });
    }
  } else if (process.platform === 'win32') {
    if (action === 'install') return installWindowsService();
    if (action === 'start') return runCommand('schtasks', ['/Run', '/TN', SERVICE_NAME]);
    if (action === 'stop') return runCommand('schtasks', ['/End', '/TN', SERVICE_NAME]);
    if (action === 'restart') {
      runCommand('schtasks', ['/End', '/TN', SERVICE_NAME]);
      return runCommand('schtasks', ['/Run', '/TN', SERVICE_NAME]);
    }
    if (action === 'status') return runCommand('schtasks', ['/Query', '/TN', SERVICE_NAME]);
    if (action === 'uninstall') return runCommand('schtasks', ['/Delete', '/TN', SERVICE_NAME, '/F']);
  }

  throw new Error(`Unknown service action: ${action}`);
}

function openBrowser(url) {
  let command;
  let args;
  let shell = false;

  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell });
  child.on('error', (error) => {
    if (error.code === 'ENOENT') {
      console.warn(`Could not find ${command}; open ${url} manually or use --no-open.`);
      return;
    }
    console.warn(`Could not open ${url}: ${error.message}`);
  });
  child.unref();
}

try {
  const args = process.argv.slice(2);
  if (args[0] === 'service') {
    serviceCommand(args[1]);
    process.exit(0);
  }
  if (args[0] === 'update') {
    updateCommand(args[1]);
    process.exit(0);
  }

  const options = parseArgs(args);
  process.env.PI_WEBUI_CLI_IMPORT = '1';

  const { startServer } = await loadRuntimeConfig(options, () => import('../server/dist/index.js'));
  const app = await startServer();
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : process.env.PORT;
  const url = `http://${process.env.HOST}:${port}`;
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const configPath = join(configHome, 'pi-webui', '.env');
  const databasePath = process.env.PI_WEBUI_DB_PATH ?? join(configHome, 'pi-webui', 'pi-webui.sqlite');
  console.log(`Pi WebUI running at ${url}`);
  console.log(`Configuration: ${configPath}`);
  console.log(`Database: ${databasePath}`);
  console.log('These files are preserved when Pi WebUI is uninstalled.');
  if (!options.noOpen) openBrowser(url);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
