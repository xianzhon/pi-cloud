import type { FastifyInstance } from 'fastify';
import type { ReviewSourceListOptions } from '../types.js';
import type { ReviewSourceService } from '../services/review-source-service.js';

export interface ReviewSourceRouteOptions {
  reviewSourceService: ReviewSourceService;
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
