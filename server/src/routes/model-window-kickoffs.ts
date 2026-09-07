import { stat } from 'node:fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { PiSessionService } from '../services/session-manager.js';
import { ModelWindowKickoffStore, type ModelWindowKickoffInput } from '../services/model-window-kickoff-store.js';
import { NotificationChannelService } from '../services/notification-channel.js';
import { resolveAllowedExistingPath } from '../utils/path-security.js';

interface Options {
  store: ModelWindowKickoffStore;
  notifications: NotificationChannelService;
  sessions: PiSessionService;
}

export const modelWindowKickoffRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  app.get('/', async () => ({ kickoffs: options.store.list() }));

  app.post('/', async (req, reply) => {
    try {
      const input = await validateInput(options.sessions, req.body as ModelWindowKickoffInput);
      return reply.status(201).send({ kickoff: options.store.create(input) });
    } catch (error) {
      return reply.status(errorStatus(error, 400)).send({ error: message(error) });
    }
  });

  app.put('/:id', async (req, reply) => {
    try {
      const input = await validateInput(options.sessions, req.body as ModelWindowKickoffInput);
      return { kickoff: options.store.update((req.params as { id: string }).id, input) };
    } catch (error) {
      const fallback = message(error).includes('not found') ? 404 : 400;
      return reply.status(errorStatus(error, fallback)).send({ error: message(error) });
    }
  });

  app.delete('/:id', async (req, reply) => {
    try {
      options.store.delete((req.params as { id: string }).id);
      return reply.status(204).send();
    } catch (error) {
      return reply.status(404).send({ error: message(error) });
    }
  });

  app.get('/notification-channels', async () => ({ channels: options.notifications.list() }));

  app.post('/notification-channels/wecom', async (req, reply) => {
    try {
      return { channel: options.notifications.saveWecom(req.body as { id?: string; name?: string; botKey?: string }) };
    } catch (error) {
      return reply.status(400).send({ error: message(error) });
    }
  });

  app.delete('/notification-channels/:id', async (req, reply) => {
    try {
      options.notifications.delete((req.params as { id: string }).id);
      return reply.status(204).send();
    } catch (error) {
      return reply.status(404).send({ error: message(error) });
    }
  });
};

async function validateInput(sessions: PiSessionService, input: ModelWindowKickoffInput): Promise<ModelWindowKickoffInput> {
  if (!input?.profileId || !input.provider || !input.modelId) throw new Error('Profile, provider, and model are required');
  const models = await sessions.listAgentProfileModels(input.profileId);
  if (!models.some((model) => model.provider === input.provider && model.id === input.modelId)) {
    throw new Error(`Unknown model: ${input.provider}/${input.modelId}`);
  }

  const projectPath = await resolveAllowedExistingPath(input.projectPath || '~');
  if (!(await stat(projectPath)).isDirectory()) throw new Error('Project path must be a directory');
  return { ...input, projectPath };
}

function errorStatus(error: unknown, fallback: number): number {
  return typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode
    : fallback;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
