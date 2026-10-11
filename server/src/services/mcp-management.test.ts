import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpManagement, mcpServerHash } from './mcp-management.js';
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const roots: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'cloud-mcp-')); roots.push(root);
  const profile = join(root, 'profile'); const cwd = join(root, 'project'); mkdirSync(profile); mkdirSync(cwd);
  writeFileSync(join(profile, 'mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', args: ['server.js'], env: { TOKEN: 'sensitive-test-token' }, directTools: true } } }));
  writeFileSync(join(profile, 'mcp-cache.json'), JSON.stringify({ version: 1, servers: { docs: { configHash: mcpServerHash({ command: 'node', args: ['server.js'], env: { TOKEN: 'sensitive-test-token' }, directTools: true }), tools: [{ name: 'read-doc', description: 'Read docs' }, { name: 'delete_doc' }], cachedAt: Date.now() } } }));
  return { profile, cwd, manager: new McpManagement(profile, cwd, []) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('MCP management', () => {
  it('lists raw cached tools and never returns credentials', () => {
    const { manager } = setup(); const view = manager.list('s1');
    expect(view.servers[0].tools.map(t => t.name)).toEqual(['read-doc', 'delete_doc']);
    expect(view.servers[0].source).toContain('mcp.json');
    expect(JSON.stringify(view)).not.toContain('sensitive-test-token');
  });
  it('persists profile restrictions and session restrictions separately, with no session re-enable', async () => {
    const { manager, profile, cwd } = setup();
    await manager.setProfileTools([{ server: 'docs', tool: 'read-doc', enabled: false }]);
    await manager.setSessionTools('s1', [{ server: 'docs', tool: 'read-doc', enabled: true }, { server: 'docs', tool: 'delete_doc', enabled: false }]);
    const resumed = new McpManagement(profile, cwd, []);
    expect(resumed.list('s1').servers[0].tools.map(t => t.enabled)).toEqual([false, false]);
    expect(resumed.list('s2').servers[0].tools.map(t => t.enabled)).toEqual([false, true]);
    expect(setup().manager.list('s1').servers[0].tools.every(t => t.enabled)).toBe(true);
  });
  it('disables servers independently of cached tools and preserves tool restrictions', async () => {
    const { manager, profile, cwd } = setup();
    await manager.setProfileTools([{ server: 'docs', tool: 'read-doc', enabled: false }]);
    await manager.setProfileTools([{ server: 'docs', enabled: false }]);
    expect(manager.list().servers[0].enabled).toBe(false);
    const cachePath = join(profile, 'mcp-cache.json');
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    cache.servers.docs.tools.push({ name: 'new_tool' });
    writeFileSync(cachePath, JSON.stringify(cache));
    const resumed = new McpManagement(profile, cwd, []);
    for (const tool of ['read-doc', 'delete_doc', 'new_tool']) expect(() => resumed.assertAllowed('s1', tool, 'docs')).toThrow(/disabled/);
    await expect(resumed.setSessionTools('s1', [{ server: 'docs', enabled: true }])).rejects.toThrow(/profile/);
    await resumed.setProfileTools([{ server: 'docs', enabled: true }]);
    expect(() => resumed.assertAllowed('s1', 'read-doc', 'docs')).toThrow(/disabled/);
    expect(() => resumed.assertAllowed('s1', 'new_tool', 'docs')).not.toThrow();
    await resumed.setSessionTools('s1', [{ server: 'docs', enabled: false }]);
    expect(resumed.list('s1').servers[0].enabled).toBe(false);
    expect(resumed.list('s2').servers[0].enabled).toBe(true);
    await resumed.saveServer('uncached', { command: 'node' });
    await resumed.setProfileTools([{ server: 'uncached', enabled: false }]);
    expect(resumed.list().servers.find(s => s.name === 'uncached')?.enabled).toBe(false);
    const policy = JSON.parse(readFileSync(join(profile, 'pi-cloud-mcp.json'), 'utf8'));
    expect(policy.disabledTools).toEqual([JSON.stringify(['docs', 'read-doc'])]);
    expect(policy.disabledServers).toEqual(['uncached']);
  });
  it('denies gateway fuzzy/original/prefixed and direct names, fails closed for unknown tools', async () => {
    const { manager } = setup();
    await manager.setProfileTools([{ server: 'docs', tool: 'read-doc', enabled: false }]);
    for (const name of ['read-doc', 'docs_read-doc', 'docs_read_doc']) expect(() => manager.assertAllowed('s1', name, 'docs')).toThrow(/disabled/);
    expect(() => manager.assertAllowed('s1', 'made_up')).toThrow(/discover/i);
    expect(() => manager.assertAllowed('s1', 'docs_delete_doc')).not.toThrow();
  });
  it('enforces policy through real SDK tool definitions, filters discovery, and survives session recreation', async () => {
    const { manager, profile, cwd } = setup();
    const executions: string[] = [];
    async function create(sessionId: string) {
      const loader = new DefaultResourceLoader({ cwd, agentDir: profile, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        settingsManager: SettingsManager.inMemory(),
        extensionFactories: [pi => {
          pi.registerTool({ name: 'mcp', label: 'MCP', description: 'gateway', parameters: Type.Any(), async execute(_id, params) {
            if (params.search) return { content: [{ type: 'text', text: 'unfiltered secrets' }], details: { mode: 'search', matches: [{ server: 'docs', tool: 'docs_read-doc' }, { server: 'docs', tool: 'docs_delete_doc' }] } };
            if (params.describe) return { content: [{ type: 'text', text: params.describe }], details: { mode: 'describe', matches: [] } };
            executions.push(`${params.server}:${params.tool}`);
            return { content: [{ type: 'text', text: 'executed' }], details: { mode: 'call', matches: [] } };
          } });
          for (const name of ['docs_read-doc', 'docs_delete_doc']) pi.registerTool({ name, label: 'MCP', description: 'direct', parameters: Type.Any(), async execute() { executions.push(name); return { content: [{ type: 'text', text: 'executed' }], details: {} }; } });
        }],
        extensionsOverride: base => { base.extensions[0].resolvedPath = '/fixture/pi-mcp-adapter/index.ts'; return manager.wrapExtensions(base, sessionId, work => work()); },
      });
      await loader.reload();
      const { session } = await createAgentSession({ cwd, agentDir: profile, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory() });
      await session.bindExtensions({ mode: 'print' });
      return session;
    }
    await manager.setProfileTools([{ server: 'docs', tool: 'read-doc', enabled: false }]);
    await manager.setSessionTools('s1', [{ server: 'docs', tool: 'delete_doc', enabled: false }]);
    const blocked = await create('s1'); const other = await create('s2');
    try {
      manager.refreshActiveTools(other);
      expect(other.getActiveToolNames()).not.toContain('docs_read-doc');
      expect(other.getActiveToolNames()).toContain('docs_delete_doc');
      const invoke = (session: typeof blocked, name: string, params: Record<string, unknown>) => session.extensionRunner.getToolDefinition(name)!.execute('test', params, new AbortController().signal, undefined, session.extensionRunner.createContext());
      for (const tool of ['read-doc', 'docs_read_doc']) await expect(invoke(other, 'mcp', { tool, server: 'docs' })).rejects.toThrow(/disabled/);
      await expect(invoke(other, 'docs_read-doc', {})).rejects.toThrow(/disabled/);
      await expect(invoke(blocked, 'mcp', { tool: 'docs_delete_doc' })).rejects.toThrow(/disabled/);
      await expect(invoke(blocked, 'docs_delete_doc', {})).rejects.toThrow(/disabled/);
      expect(executions).toEqual([]);
      await invoke(other, 'mcp', { tool: 'delete_doc', server: 'docs' });
      expect(executions).toEqual(['docs:docs_delete_doc']);
      const search = await invoke(other, 'mcp', { search: 'doc' });
      expect(JSON.stringify(search)).not.toContain('read-doc');
      expect(JSON.stringify(search)).toContain('delete_doc');
      await manager.setProfileTools([{ server: 'docs', enabled: false }]);
      manager.refreshActiveTools(other);
      expect(other.getActiveToolNames()).not.toContain('docs_delete_doc');
      await expect(invoke(other, 'mcp', { connect: 'docs' })).rejects.toThrow(/disabled/);
      await expect(invoke(other, 'mcp', { tool: 'delete_doc', server: 'docs' })).rejects.toThrow(/disabled/);
      await expect(invoke(other, 'docs_delete_doc', {})).rejects.toThrow(/disabled/);
      expect(JSON.stringify(await invoke(other, 'mcp', { search: 'doc' }))).not.toContain('delete_doc');
      await manager.setProfileTools([{ server: 'docs', enabled: true }]);
      await expect(invoke(other, 'mcp', { tool: 'docs_made_up', server: 'docs' })).rejects.toThrow(/Discover/);
      await manager.saveServer('docs', { command: 'node', args: ['replacement.js'] });
      const cachePath = join(profile, 'mcp-cache.json');
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      cache.servers.docs.configHash = mcpServerHash({ command: 'node', args: ['replacement.js'], env: { TOKEN: 'sensitive-test-token' } });
      writeFileSync(cachePath, JSON.stringify(cache));
      // Even a fresh cache populated by another session cannot authorize this old connection.
      await expect(invoke(other, 'mcp', { tool: 'docs_delete_doc' })).rejects.toThrow(/Resume/);
      await expect(invoke(other, 'docs_delete_doc', {})).rejects.toThrow(/Resume/);
      expect(executions).toEqual(['docs:docs_delete_doc']);
    } finally { blocked.dispose(); other.dispose(); }
    const resumed = await create('s1');
    try { await expect(resumed.extensionRunner.getToolDefinition('docs_delete_doc')!.execute('test', {}, new AbortController().signal, undefined, resumed.extensionRunner.createContext())).rejects.toThrow(/disabled/); }
    finally { resumed.dispose(); }
  });

  it('honors adapter exclusions and project provenance without writing shared files', async () => {
    const { manager, profile, cwd } = setup();
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', excludeTools: ['read-doc'] } } }));
    expect(manager.list().servers[0].tools[0].profileEnabled).toBe(false);
    expect(manager.list().servers[0].source).toBe(join(cwd, '.mcp.json'));
    await manager.saveServer('new', { url: 'https://example.com/mcp' });
    expect(JSON.parse(readFileSync(join(profile, 'mcp.json'), 'utf8')).mcpServers.new.url).toBe('https://example.com/mcp');
    expect(JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8')).mcpServers.new).toBeUndefined();
  });
  it('preserves sibling servers and credentials when editing or removing legacy mcp-servers entries', async () => {
    const { manager, profile } = setup();
    const path = join(profile, 'mcp.json');
    const legacy = { settings: { idleTimeout: 20 }, 'mcp-servers': { a: { command: 'first', env: { TOKEN: 'private-token' } }, b: { command: 'second', args: ['keep-me'] } } };
    writeFileSync(path, JSON.stringify(legacy));
    await manager.saveServer('a', { command: 'updated' });
    const edited = JSON.parse(readFileSync(path, 'utf8'));
    expect(edited.mcpServers).toEqual({ a: { command: 'updated', env: { TOKEN: 'private-token' } }, b: legacy['mcp-servers'].b });
    expect(edited.settings).toEqual(legacy.settings);
    writeFileSync(path, JSON.stringify(legacy));
    await manager.removeServer('a');
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers).toEqual({ b: legacy['mcp-servers'].b });
  });

  it('validates transports and preserves secrets during edits', async () => {
    const { manager, profile } = setup();
    for (const value of [{}, { command: 'x', url: 'https://x' }, { url: 'file:///tmp/x' }, { command: 'x', args: 'bad' }]) await expect(manager.saveServer('invalid', value)).rejects.toThrow();
    await manager.saveServer('docs', { command: 'node', args: ['new.js'] });
    expect(() => manager.assertAllowed('s1', 'docs_delete_doc')).toThrow(/stale/);
    expect(JSON.parse(readFileSync(join(profile, 'mcp.json'), 'utf8')).mcpServers.docs.env.TOKEN).toBe('sensitive-test-token');
    await manager.saveServer('docs', { url: 'https://example.com/mcp', headers: { Authorization: '${TOKEN}' } });
    await manager.saveServer('docs', { url: 'https://example.com/mcp', headers: { Accept: 'application/json' } });
    const entry = JSON.parse(readFileSync(join(profile, 'mcp.json'), 'utf8')).mcpServers.docs;
    expect(entry.command).toBeUndefined(); expect(entry.args).toBeUndefined();
    expect(entry.env.TOKEN).toBe('sensitive-test-token');
    expect(entry.headers).toEqual({ Authorization: '${TOKEN}', Accept: 'application/json' });
    await manager.saveServer('docs', { command: 'node' });
    expect(JSON.parse(readFileSync(join(profile, 'mcp.json'), 'utf8')).mcpServers.docs.url).toBeUndefined();
    await manager.removeServer('docs'); expect(manager.list().servers).toHaveLength(0);
  });
});
