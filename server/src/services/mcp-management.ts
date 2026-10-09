import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import type { AgentSession, LoadExtensionsResult, ToolDefinition } from '@earendil-works/pi-coding-agent';

interface ServerEntry { command?: string; args?: string[]; url?: string; cwd?: string; directTools?: boolean | string[]; excludeTools?: string[]; [key: string]: unknown }
interface Config { mcpServers?: Record<string, ServerEntry>; settings?: { toolPrefix?: string; directTools?: boolean }; imports?: string[]; [key: string]: unknown }
interface Policy { disabledTools: string[]; sessions: Record<string, string[]>; disabledServers: string[]; sessionServers: Record<string, string[]> }
export interface McpToolChange { server: string; tool?: string; enabled: boolean }
interface CachedTool { name: string; description?: string }
const normalize = (name: string) => name.replace(/-/g, '_');
const key = (server: string, tool: string) => JSON.stringify([server, tool]);
function resourceToolName(name: string) {
  let result = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  if (!result || /^\d/.test(result)) result = `resource${result ? `_${result}` : ''}`;
  return `get_${result}`;
}
// Compatibility with pi-mcp-adapter cache v1: validate identity before authorizing calls.
export function mcpServerHash(entry: ServerEntry): string {
  const interpolate = (value: string) => value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '').replace(/\$env:(\w+)/g, (_, name) => process.env[name] ?? '');
  const record = (value: unknown) => value ? Object.fromEntries(Object.entries(value as Record<string, string>).map(([k, v]) => [k, interpolate(v)])) : undefined;
  let cwd = entry.cwd === undefined ? undefined : interpolate(entry.cwd);
  if (cwd === '~') cwd = homedir();
  else if (cwd?.startsWith('~/') || cwd?.startsWith('~\\')) cwd = join(homedir(), cwd.slice(2));
  const identity = {
    command: entry.command, args: entry.args, env: record(entry.env), cwd,
    url: entry.url, headers: record(entry.headers), auth: entry.auth,
    bearerToken: entry.bearerToken !== undefined ? interpolate(entry.bearerToken as string) : entry.bearerTokenEnv ? process.env[entry.bearerTokenEnv as string] : undefined,
    bearerTokenEnv: entry.bearerTokenEnv, exposeResources: entry.exposeResources, excludeTools: entry.excludeTools,
  };
  function stable(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${stable(object[k])}`).join(',')}}`;
  }
  return createHash('sha256').update(stable(identity)).digest('hex');
}
function read<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
function atomicWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

// Owns Pi Cloud permissions only. The adapter still owns connections, OAuth and tool execution.
export class McpManagement {
  private static writes = new Map<string, Promise<unknown>>();
  private readonly policyPath: string;
  private readonly managedToolNames = new Set<string>();
  constructor(readonly profilePath: string, readonly cwd: string, private readonly sharedPaths = [join(homedir(), '.config/mcp/mcp.json')]) {
    this.policyPath = join(profilePath, 'pi-cloud-mcp.json');
  }
  private configuration() {
    const servers = new Map<string, { entry: ServerEntry; source: string }>();
    let settings: Config['settings'] = {};
    const imports: Record<string, string[]> = {
      cursor: [join(homedir(), '.cursor/mcp.json')],
      'claude-code': [join(homedir(), '.claude/mcp.json'), join(homedir(), '.claude.json'), join(homedir(), '.claude/claude_desktop_config.json')],
      'claude-desktop': [join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json')],
      codex: [join(homedir(), '.codex/config.json')], windsurf: [join(homedir(), '.windsurf/mcp.json')], vscode: [join(this.cwd, '.vscode/mcp.json')],
    };
    for (const path of [...this.sharedPaths, join(this.profilePath, 'mcp.json'), join(this.cwd, '.mcp.json'), join(this.cwd, '.pi/mcp.json')]) {
      const config = read<Config>(path, {});
      const importedForSource = new Map<string, { entry: ServerEntry; source: string }>();
      for (const kind of config.imports || []) {
        const source = imports[kind]?.find(existsSync);
        if (!source) continue;
        const imported = read<Config>(source, {});
        for (const [name, entry] of Object.entries(imported.mcpServers || imported['mcp-servers'] || {})) {
          if (!importedForSource.has(name)) importedForSource.set(name, { entry: entry as ServerEntry, source });
        }
      }
      for (const [name, value] of importedForSource) servers.set(name, value);
      for (const [name, entry] of Object.entries(config.mcpServers || config['mcp-servers'] || {})) servers.set(name, { entry: entry as ServerEntry, source: path });
      settings = { ...settings, ...config.settings };
    }
    return { servers, settings };
  }
  private policy(): Policy {
    const policy = read<Partial<Policy>>(this.policyPath, {});
    return { disabledTools: policy.disabledTools || [], sessions: policy.sessions || {}, disabledServers: policy.disabledServers || [], sessionServers: policy.sessionServers || {} };
  }
  list(sessionId?: string) {
    const { servers, settings } = this.configuration();
    const cache = read<{ version: number; servers: Record<string, { tools: CachedTool[]; resources?: { name: string }[]; cachedAt?: number; configHash?: string }> }>(join(this.profilePath, 'mcp-cache.json'), { version: 1, servers: {} });
    const policy = this.policy();
    return { servers: [...servers].map(([name, { entry, source }]) => {
      const cached = cache.version === 1 ? cache.servers[name] : undefined;
      const cacheValid = Boolean(cached?.cachedAt && cached.configHash === mcpServerHash(entry) && Date.now() - cached.cachedAt < 7 * 24 * 60 * 60 * 1000);
      const profileEnabled = !policy.disabledServers.includes(name);
      const sessionEnabled = !sessionId || !(policy.sessionServers[sessionId] || []).includes(name);
      const names = [...(cached?.tools || []), ...(entry.exposeResources === false ? [] : (cached?.resources || []).map(resource => ({ name: resourceToolName(resource.name), description: 'MCP resource' })))];
      return {
        name, source, editable: source === join(this.profilePath, 'mcp.json'),
        canOverride: ![join(this.cwd, '.mcp.json'), join(this.cwd, '.pi/mcp.json')].includes(source),
        transport: entry.url ? 'http' : 'stdio',
        profileEnabled, sessionEnabled, enabled: profileEnabled && sessionEnabled,
        config: Object.fromEntries(['command', 'args', 'url', 'cwd', 'directTools', 'excludeTools', 'lifecycle', 'idleTimeout', 'debug', 'exposeResources', 'auth', 'bearerTokenEnv'].filter(field => entry[field] !== undefined).map(field => [field, entry[field]])),
        secretFields: ['env', 'headers', 'bearerToken', 'oauth'].filter(field => entry[field] !== undefined),
        cachedAt: cached?.cachedAt ?? null, cacheValid,
        tools: names.map(tool => {
          const prefixedName = this.toolName(name, tool.name, settings?.toolPrefix);
          const excluded = (entry.excludeTools || []).some(exclusion => normalize(exclusion) === normalize(tool.name) || normalize(exclusion) === normalize(prefixedName));
          const toolProfileEnabled = profileEnabled && !excluded && !policy.disabledTools.includes(key(name, tool.name));
          const toolSessionEnabled = sessionEnabled && (!sessionId || !(policy.sessions[sessionId] || []).includes(key(name, tool.name)));
          const direct = entry.directTools ?? settings?.directTools ?? false;
          return { name: tool.name, prefixedName, description: tool.description || '', profileEnabled: toolProfileEnabled, sessionEnabled: toolSessionEnabled, enabled: toolProfileEnabled && toolSessionEnabled, excluded, exposure: direct === true || (Array.isArray(direct) && direct.includes(tool.name)) ? 'direct' : 'proxy' };
        }),
      };
    }) };
  }
  private toolName(server: string, tool: string, prefix = 'server') {
    const serverPrefix = prefix === 'none' ? '' : prefix === 'short' ? server.replace(/-?mcp$/i, '').replace(/-/g, '_') || 'mcp' : server.replace(/-/g, '_');
    return serverPrefix ? `${serverPrefix}_${tool}` : tool;
  }
  assertAllowed(sessionId: string, name: string, server?: string) {
    const matches = this.list(sessionId).servers.filter(s => !server || s.name === server).flatMap(s => s.tools.filter(t => normalize(t.name) === normalize(name) || normalize(t.prefixedName) === normalize(name)).map(tool => ({ ...tool, server: s.name, cacheValid: s.cacheValid })));
    if (!matches.length || matches.some(tool => !tool.cacheValid)) throw new Error('Unknown or stale MCP tool. Discover tools for this server before calling it.');
    if (matches.some(tool => !tool.enabled)) throw new Error('MCP tool is disabled by profile or session settings');
    if (matches.length !== 1) throw new Error('Ambiguous MCP tool; specify its server');
    return matches[0];
  }
  private write<T>(work: () => T): Promise<T> {
    const previous = McpManagement.writes.get(this.profilePath) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    McpManagement.writes.set(this.profilePath, next);
    void next.finally(() => { if (McpManagement.writes.get(this.profilePath) === next) McpManagement.writes.delete(this.profilePath); }).catch(() => {});
    return next;
  }
  private updateTools(changes: McpToolChange[], sessionId?: string) {
    return this.write(() => {
      if (!Array.isArray(changes) || changes.length > 5000) throw new Error('Invalid MCP tool changes');
      const inventory = this.list(sessionId);
      const policy = this.policy();
      const disabled = new Set(sessionId ? policy.sessions[sessionId] || [] : policy.disabledTools);
      const disabledServers = new Set(sessionId ? policy.sessionServers[sessionId] || [] : policy.disabledServers);
      for (const change of changes) {
        const server = change && inventory.servers.find(s => s.name === change.server);
        if (!server || typeof change.enabled !== 'boolean') throw new Error('Unknown MCP server or invalid enabled state');
        if (change.tool === undefined) {
          if (sessionId && change.enabled && !server.profileEnabled) throw new Error('MCP server is disabled by profile settings');
          if (change.enabled) disabledServers.delete(change.server); else disabledServers.add(change.server);
        } else {
          if (!server.tools.some(t => t.name === change.tool)) throw new Error('Unknown MCP tool');
          const id = key(change.server, change.tool);
          if (change.enabled) disabled.delete(id); else disabled.add(id);
        }
      }
      if (sessionId) { policy.sessions[sessionId] = [...disabled]; policy.sessionServers[sessionId] = [...disabledServers]; }
      else { policy.disabledTools = [...disabled]; policy.disabledServers = [...disabledServers]; }
      mkdirSync(this.profilePath, { recursive: true }); atomicWrite(this.policyPath, policy);
      return this.list(sessionId);
    });
  }
  setProfileTools(changes: McpToolChange[]) { return this.updateTools(changes); }
  setSessionTools(sessionId: string, changes: McpToolChange[]) { return this.updateTools(changes, sessionId); }
  saveServer(name: string, input: unknown) {
    return this.write(() => {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid MCP server name');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid MCP server configuration');
      const entry = input as ServerEntry;
      const fields = ['command', 'args', 'url', 'cwd', 'env', 'headers', 'auth', 'bearerToken', 'bearerTokenEnv', 'oauth', 'directTools', 'excludeTools', 'lifecycle', 'idleTimeout', 'debug', 'exposeResources'];
      if (Object.keys(entry).some(field => !fields.includes(field))) throw new Error('Unsupported MCP server option');
      for (const field of ['bearerToken', 'bearerTokenEnv']) if (entry[field] !== undefined && typeof entry[field] !== 'string') throw new Error(`Invalid ${field}`);
      for (const field of ['debug', 'exposeResources']) if (entry[field] !== undefined && typeof entry[field] !== 'boolean') throw new Error(`Invalid ${field}`);
      if (entry.auth !== undefined && !['bearer', 'oauth'].includes(entry.auth as string)) throw new Error('Invalid auth');
      if (entry.lifecycle !== undefined && !['lazy', 'eager', 'keep-alive'].includes(entry.lifecycle as string)) throw new Error('Invalid lifecycle');
      if (entry.idleTimeout !== undefined && (typeof entry.idleTimeout !== 'number' || !Number.isFinite(entry.idleTimeout) || entry.idleTimeout < 0)) throw new Error('Invalid idleTimeout');
      if (entry.directTools !== undefined && typeof entry.directTools !== 'boolean' && (!Array.isArray(entry.directTools) || entry.directTools.some(name => typeof name !== 'string'))) throw new Error('Invalid directTools');
      if (entry.excludeTools !== undefined && (!Array.isArray(entry.excludeTools) || entry.excludeTools.some(name => typeof name !== 'string'))) throw new Error('Invalid excludeTools');
      if (entry.oauth !== undefined && (!entry.oauth || typeof entry.oauth !== 'object' || Array.isArray(entry.oauth) || Object.values(entry.oauth).some(value => typeof value !== 'string'))) throw new Error('Invalid oauth');
      if (Boolean(entry.command) === Boolean(entry.url)) throw new Error('Specify exactly one command or HTTP URL');
      if (entry.command !== undefined && (typeof entry.command !== 'string' || !entry.command.trim())) throw new Error('Invalid command');
      if (entry.url !== undefined) {
        if (typeof entry.url !== 'string' || !['http:', 'https:'].includes(new URL(entry.url).protocol)) throw new Error('Only HTTP(S) MCP URLs are supported');
        const url = new URL(entry.url); if (url.username || url.password) throw new Error('Use environment variables for credentials');
      }
      if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== 'string'))) throw new Error('args must be an array of strings');
      if (entry.cwd !== undefined && typeof entry.cwd !== 'string') throw new Error('Invalid cwd');
      for (const field of ['env', 'headers']) if (entry[field] !== undefined && (!entry[field] || typeof entry[field] !== 'object' || Array.isArray(entry[field]) || Object.values(entry[field] as object).some(v => typeof v !== 'string'))) throw new Error(`Invalid ${field}`);
      const path = join(this.profilePath, 'mcp.json'); const config = read<Config>(path, {});
      const effective = this.configuration().servers.get(name);
      if (effective && [join(this.cwd, '.mcp.json'), join(this.cwd, '.pi/mcp.json')].includes(effective.source)) throw new Error('This server is defined by a project override. Edit its project configuration file instead.');
      const owned = (config.mcpServers || config['mcp-servers'] || {}) as Record<string, ServerEntry>;
      const previous = owned[name] || effective?.entry || {};
      const next = { ...previous, ...entry };
      for (const field of ['env', 'headers']) {
        if (entry[field]) next[field] = { ...(previous[field] as Record<string, string> || {}), ...(entry[field] as Record<string, string>) };
      }
      if (entry.url) { delete next.command; delete next.args; } else delete next.url;
      config.mcpServers = { ...owned, [name]: next };
      delete config['mcp-servers'];
      mkdirSync(this.profilePath, { recursive: true }); atomicWrite(path, config);
      return this.list();
    });
  }
  removeServer(name: string) {
    return this.write(() => {
      const path = join(this.profilePath, 'mcp.json'); const config = read<Config>(path, {});
      const owned = (config.mcpServers || config['mcp-servers'] || {}) as Record<string, ServerEntry>;
      if (!Object.hasOwn(owned, name)) throw new Error('Only profile-owned server entries can be removed; shared files are read-only');
      config.mcpServers = { ...owned }; delete config.mcpServers[name]; delete config['mcp-servers'];
      atomicWrite(path, config); return this.list();
    });
  }
  refreshActiveTools(session: AgentSession) {
    if (!this.managedToolNames.size) return;
    const enabled = [...this.managedToolNames].filter(name => {
      if (name === 'mcp') return true;
      try { this.assertAllowed(session.sessionId, name); return true; } catch { return false; }
    });
    session.setActiveToolsByName([...session.getActiveToolNames().filter(name => !this.managedToolNames.has(name)), ...enabled]);
  }
  wrapExtensions(base: LoadExtensionsResult, sessionId: string, run: <T>(work: () => Promise<T>) => Promise<T>): LoadExtensionsResult {
    const signatures = new Map([...this.configuration().servers].map(([name, value]) => [name, JSON.stringify(value.entry)]));
    const assertCurrent = (server: string) => {
      const current = this.configuration().servers.get(server);
      if (!current || signatures.get(server) !== JSON.stringify(current.entry)) throw new Error('MCP server configuration changed. Resume this session to reconnect before using its tools.');
    };
    for (const extension of base.extensions) {
      if (!/(^|[/\\])pi-mcp-adapter([/\\]|$)/.test(extension.resolvedPath)) continue;
      const shutdown = extension.handlers.get('session_shutdown');
      if (shutdown) extension.handlers.set('session_shutdown', shutdown.map(handler => ((...args: Parameters<typeof handler>) => run(() => Promise.resolve(handler(...args)))) as typeof handler));
      for (const registered of extension.tools.values()) {
        const tool = registered.definition;
        this.managedToolNames.add(tool.name);
        const execute = tool.execute;
        registered.definition = { ...tool, execute: async (...args: Parameters<ToolDefinition['execute']>) => {
          const params = args[1] as Record<string, unknown>;
          if (tool.name === 'mcp') {
            if (params.tool !== undefined) {
              if (typeof params.tool !== 'string' || (params.server !== undefined && typeof params.server !== 'string')) throw new Error('Invalid MCP tool name');
              const resolved = this.assertAllowed(sessionId, params.tool, params.server as string | undefined);
              assertCurrent(resolved.server);
              args[1] = { ...params, tool: resolved.prefixedName, server: resolved.server };
            } else if (typeof params.describe === 'string') {
              const resolved = this.assertAllowed(sessionId, params.describe);
              assertCurrent(resolved.server);
              args[1] = { ...params, describe: resolved.prefixedName };
            } else if (!params.action && (params.connect !== undefined || params.search !== undefined || params.server !== undefined)) {
              const target = params.connect ?? params.server;
              if (typeof target === 'string') {
                const server = this.list(sessionId).servers.find(server => server.name === target);
                if (!server?.enabled) throw new Error('MCP server is disabled or unknown');
                assertCurrent(target);
              }
              const result = await run(() => execute(...args));
              const details = result.details as { mode?: string; error?: string; server?: string; tools?: string[]; matches?: { server: string; tool: string }[] };
              if (details?.error) return result;
              const matches = details?.matches || (details?.tools || []).map(name => ({ server: details.server!, tool: name }));
              const allowed = matches.flatMap(match => {
                try { assertCurrent(match.server); return [this.assertAllowed(sessionId, match.tool, match.server)]; } catch { return []; }
              });
              const content = [];
              for (const resolved of allowed) {
                const described = await run(() => execute(args[0], { describe: resolved.prefixedName }, args[2], args[3], args[4]));
                content.push(...described.content);
              }
              return { content: content.length ? content : [{ type: 'text' as const, text: 'No enabled MCP tools. Discover tools in Settings if needed.' }], details: { mode: details?.mode, matches: allowed.map(t => ({ server: t.server, tool: t.prefixedName })), count: allowed.length } };
            }
          } else {
            const resolved = this.assertAllowed(sessionId, tool.name);
            assertCurrent(resolved.server);
          }
          return run(() => execute(...args));
        } };
      }
    }
    return base;
  }
}
