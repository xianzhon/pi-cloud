import type { FastifyInstance } from 'fastify';
import type { McpToolChange } from '../services/mcp-management.js';

export async function mcpRoutes(app: FastifyInstance) {
  const service = app.services.sessions;
  const query = (value: unknown) => value as { projectPath?: string; clientId?: string };
  const profile = (value: unknown) => (value as { profileId: string }).profileId;
  const body = (value: unknown) => (value || {}) as { changes: McpToolChange[]; config: unknown; server: string; clientId: string; projectPath?: string };
  async function handle(reply: import('fastify').FastifyReply, work: () => Promise<unknown>) {
    try { return await work(); } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP request failed';
      const status = (error as { statusCode?: number })?.statusCode || (message.includes('streaming') ? 409 : message.includes('not found') ? 404 : 400);
      return reply.status(status).send({ error: message });
    }
  }
  app.get('/agent-profiles/:profileId/mcp', (req, reply) => handle(reply, () => service.getProfileMcp(profile(req.params), query(req.query).projectPath)));
  app.put('/agent-profiles/:profileId/mcp/servers', (req, reply) => handle(reply, () => service.updateProfileMcp(profile(req.params), body(req.body).changes, body(req.body).projectPath)));
  app.put('/agent-profiles/:profileId/mcp/tools', (req, reply) => handle(reply, () => service.updateProfileMcp(profile(req.params), body(req.body).changes, body(req.body).projectPath)));
  app.put('/agent-profiles/:profileId/mcp/servers/:server', (req, reply) => handle(reply, () => service.saveMcpServer(profile(req.params), (req.params as { server: string }).server, body(req.body).config, body(req.body).projectPath)));
  app.delete('/agent-profiles/:profileId/mcp/servers/:server', (req, reply) => handle(reply, () => service.removeMcpServer(profile(req.params), (req.params as { server: string }).server, query(req.query).projectPath)));
  app.post('/agent-profiles/:profileId/mcp/discover', (req, reply) => handle(reply, () => service.discoverMcp(profile(req.params), body(req.body).server, body(req.body).projectPath)));
  app.get('/:id/mcp', (req, reply) => handle(reply, () => {
    const clientId = query(req.query).clientId;
    if (typeof clientId !== 'string' || !clientId) throw new Error('clientId is required');
    return service.getSessionMcp(clientId, (req.params as { id: string }).id);
  }));
  app.put('/:id/mcp', (req, reply) => handle(reply, () => {
    const data = body(req.body);
    if (typeof data.clientId !== 'string' || !data.clientId) throw new Error('clientId is required');
    return service.updateSessionMcp(data.clientId, (req.params as { id: string }).id, data.changes);
  }));
}
