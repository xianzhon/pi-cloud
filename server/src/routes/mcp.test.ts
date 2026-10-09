import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { mcpRoutes } from './mcp.js';
import { PiSessionService } from '../services/session-manager.js';
import { mcpServerHash } from '../services/mcp-management.js';
import type { AppServices } from '../app-services.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cloud-mcp-api-')); roots.push(root);
  const profile = join(root, 'profile'); mkdirSync(profile);
  const entry = { command: 'node', args: ['server.js'], env: { TOKEN: 'sensitive-api-token' } };
  writeFileSync(join(profile, 'mcp.json'), JSON.stringify({ mcpServers: { docs: entry } }));
  writeFileSync(join(profile, 'mcp-cache.json'), JSON.stringify({ version: 1, servers: { docs: { configHash: mcpServerHash(entry), cachedAt: Date.now(), tools: [{ name: 'read_doc' }] } } }));
  vi.stubEnv('PI_CLOUD_ALLOWED_ROOTS', root); vi.stubEnv('PI_CLOUD_DISABLE_PATH_CHECK', 'false');
  const service = new PiSessionService();
  const agentProfile = { id: 'test', path: profile, label: 'Test', name: 'Test', isDefault: false };
  vi.spyOn(service, 'listAgentProfiles').mockResolvedValue([agentProfile]);
  vi.spyOn(service, 'getClientAgentProfile').mockResolvedValue(agentProfile);
  const app = Fastify(); app.decorate('services', { sessions: service } as AppServices);
  await app.register(mcpRoutes, { prefix: '/api/sessions' });
  return { root, profile, app, service };
}

it('protects MCP filesystem boundaries, validates transports and never returns stored secrets', async () => {
  const { root, profile, app } = await fixture();
  const outside = mkdtempSync(join(tmpdir(), 'outside-mcp-')); roots.push(outside);
  symlinkSync(outside, join(root, 'escape'));
  vi.stubEnv('PI_CLOUD_ALLOWED_ROOTS', `${root},${process.cwd()}`);
  vi.stubEnv('MCP_OUTSIDE_TEST', outside);
  try {
    const base = '/api/sessions/agent-profiles/test/mcp';
    for (const projectPath of [outside, join(root, 'escape')]) {
      const response = await app.inject({ url: `${base}?projectPath=${encodeURIComponent(projectPath)}` });
      expect(response.statusCode).toBe(403);
    }
    for (const config of [{ command: 'node', cwd: outside }, { command: 'node', cwd: join(root, 'escape') }, { command: 'node', cwd: '${MCP_OUTSIDE_TEST}' }]) {
      expect((await app.inject({ method: 'PUT', url: `${base}/servers/escape`, payload: { config } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'PUT', url: `${base}/servers/bad`, payload: { config: { url: 'file:///etc/passwd' } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `${base}/servers/bad`, payload: { config: { command: 'node', url: 'http://localhost' } } })).statusCode).toBe(400);
    expect((await app.inject({ url: base })).body).not.toContain('sensitive-api-token');
    expect(JSON.parse(readFileSync(join(profile, 'mcp.json'), 'utf8')).mcpServers.escape).toBeUndefined();
    expect((await app.inject({ url: '/api/sessions/agent-profiles/missing/mcp' })).statusCode).toBe(400);
  } finally { await app.close(); }
});

it('requires session context and rejects busy-session writes without changing durable permissions', async () => {
  const { app, service, root, profile } = await fixture();
  const { session } = await service.createSession('client-1', { cwd: root, agentProfileId: 'test', noSession: true, memoryEnabled: false });
  try {
    const url = `/api/sessions/${session.sessionId}/mcp`;
    expect((await app.inject({ url })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/sessions/missing/mcp?clientId=client-1' })).statusCode).toBe(404);
    const payload = { clientId: 'client-1', changes: [{ server: 'docs', tool: 'read_doc', enabled: false }] };
    const streaming = vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true);
    expect((await app.inject({ method: 'PUT', url, payload })).statusCode).toBe(409);
    streaming.mockReturnValue(false);
    expect((await app.inject({ url: `${url}?clientId=client-1` })).json().servers.find((server: { name: string }) => server.name === 'docs').tools[0].enabled).toBe(true);
    expect((await app.inject({ method: 'PUT', url, payload })).statusCode).toBe(200);
    expect(JSON.parse(readFileSync(join(profile, 'pi-cloud-mcp.json'), 'utf8')).sessions[session.sessionId]).toHaveLength(1);
    expect((await app.inject({ url: `/api/sessions/agent-profiles/test/mcp` })).json().servers.find((server: { name: string }) => server.name === 'docs').tools[0].enabled).toBe(true);
  } finally { service.disposeAll(); await app.close(); }
});

it('cannot write a globally active session policy into another selected profile', async () => {
  const { app, service, root, profile } = await fixture();
  const { session } = await service.createSession('owner', { cwd: root, agentProfileId: 'test', noSession: true, memoryEnabled: false });
  const foreign = join(root, 'foreign'); mkdirSync(foreign);
  writeFileSync(join(foreign, 'mcp.json'), readFileSync(join(profile, 'mcp.json')));
  writeFileSync(join(foreign, 'mcp-cache.json'), readFileSync(join(profile, 'mcp-cache.json')));
  const selected = vi.mocked(service.getClientAgentProfile);
  selected.mockResolvedValue({ id: 'foreign', path: foreign, label: 'Foreign', isDefault: false });
  try {
    const url = `/api/sessions/${session.sessionId}/mcp`;
    const result = await app.inject({ method: 'PUT', url, payload: { clientId: 'different-profile-client', changes: [{ server: 'docs', tool: 'read_doc', enabled: false }] } });
    expect(result.statusCode).toBe(404);
    expect(result.json().error).toContain('selected agent profile');
    expect(() => readFileSync(join(foreign, 'pi-cloud-mcp.json'))).toThrow();
    selected.mockResolvedValue({ id: 'test', path: profile, label: 'Test', isDefault: false });
    const inventory = (await app.inject({ url: `${url}?clientId=owner` })).json();
    expect(inventory.servers.find((server: { name: string }) => server.name === 'docs').tools[0].enabled).toBe(true);
  } finally { service.disposeAll(); await app.close(); }
});
