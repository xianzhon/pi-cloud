import type { FastifyInstance } from 'fastify';
import type { ReviewSourceListOptions } from '../types.js';
import type { ReviewSourceService } from '../services/review-source-service.js';
import type { SessionPinStore } from '../services/session-pin-store.js';

export interface ReviewSourceRouteOptions {
  reviewSourceService: ReviewSourceService;
  pinStore?: SessionPinStore;
}

type ReviewSourceListQuery = {
  projectPath?: string;
  offset?: string;
  limit?: string;
};

function parseListOptions(query: ReviewSourceListQuery): ReviewSourceListOptions {
  return {
    projectPath: query.projectPath,
    offset: query.offset ? Number(query.offset) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

export async function reviewSourceRoutes(app: FastifyInstance, options: ReviewSourceRouteOptions) {
  app.get('/', async () => {
    return { sources: options.reviewSourceService.listSources() };
  });

  app.get('/types', async () => {
    return { types: options.reviewSourceService.listTypes() };
  });

  app.post('/', async (req, reply) => {
    const body = req.body as { type?: string; label?: string; dataPath?: string };
    if (!body.type || !body.label || !body.dataPath) {
      return reply.status(400).send({ error: 'type, label, and dataPath are required' });
    }
    try {
      const source = options.reviewSourceService.createSource({
        type: body.type,
        label: body.label,
        dataPath: body.dataPath,
      });
      return { source };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create review source' });
    }
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      options.reviewSourceService.deleteSource(id);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete review source' });
    }
  });

  app.get('/:id/sessions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as ReviewSourceListQuery;
    try {
      return {
        sessions: await options.reviewSourceService.listSessions(id, parseListOptions(query)),
      };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Review source not found' });
    }
  });

  app.get('/:id/pin-groups', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id } = req.params as { id: string };
    const owner = { type: 'review' as const, id };
    const idsByGroup = options.pinStore.listSessionIdsByGroup(owner);
    return {
      groups: options.pinStore.listGroups(owner).map((group) => ({
        ...group,
        sessionIds: idsByGroup.get(group.id) || [],
      })),
    };
  });

  app.post('/:id/pin-groups', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return reply.status(400).send({ error: 'name is required' });
    try {
      return { group: options.pinStore.createGroup({ type: 'review', id }, name) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to create pin group' });
    }
  });

  app.get('/:id/pinned', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id } = req.params as { id: string };
    try {
      const sessions = await options.reviewSourceService.listSessions(id);
      const sessionsById = new Map(sessions.map((session) => [session.id, session]));
      const owner = { type: 'review' as const, id };
      const idsByGroup = options.pinStore.listSessionIdsByGroup(owner);
      return {
        groups: options.pinStore.listGroups(owner).map((group) => ({
          ...group,
          sessions: (idsByGroup.get(group.id) || [])
            .map((sessionId) => sessionsById.get(sessionId))
            .filter((session): session is NonNullable<typeof session> => Boolean(session)),
        })),
      };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Review source not found' });
    }
  });

  app.put('/:id/sessions/:sessionId/pin', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id, sessionId } = req.params as { id: string; sessionId: string };
    const { groupId } = req.body as { groupId?: string };
    if (!groupId) return reply.status(400).send({ error: 'groupId is required' });
    try {
      options.pinStore.pinSession({ type: 'review', id }, sessionId, groupId);
      return { success: true };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Pin group not found' });
    }
  });

  app.delete('/:id/sessions/:sessionId/pin', async (req, reply) => {
    if (!options.pinStore) return reply.status(503).send({ error: 'Session pins are not configured' });
    const { id, sessionId } = req.params as { id: string; sessionId: string };
    options.pinStore.unpinSession({ type: 'review', id }, sessionId);
    return { success: true };
  });

  app.get('/:id/project-paths', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { projectPaths: await options.reviewSourceService.listProjectPaths(id) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Review source not found' });
    }
  });

  app.get('/:id/search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { q, ...listQuery } = req.query as ReviewSourceListQuery & { q?: string };
    try {
      return {
        sessions: await options.reviewSourceService.searchSessions(id, q || '', parseListOptions(listQuery)),
      };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Review source not found' });
    }
  });

  app.get('/:id/sessions/:sessionId/transcript', async (req, reply) => {
    const { id, sessionId } = req.params as { id: string; sessionId: string };
    try {
      return { transcript: await options.reviewSourceService.getTranscript(id, sessionId) };
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : 'Transcript not found' });
    }
  });

  app.delete('/:id/sessions/:sessionId', async (req, reply) => {
    const { id, sessionId } = req.params as { id: string; sessionId: string };
    try {
      await options.reviewSourceService.deleteSession(id, sessionId);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to delete session' });
    }
  });
}
