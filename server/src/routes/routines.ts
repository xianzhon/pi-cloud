import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { RoutineStore } from '../routines/store.js';
import type { RoutineScheduler } from '../routines/scheduler.js';
import type { RoutineInput } from '../routines/types.js';
import { validateProject } from '../routines/executor.js';
import type { PiSessionService } from '../services/session-manager.js';
import type { NotificationChannelService } from '../services/notification-channel.js';
type Request = FastifyRequest<{
  Params: { id: string };
  Querystring: { offset?: string; limit?: string };
  Body: RoutineInput;
}>;
interface Options {
  store: RoutineStore;
  scheduler: RoutineScheduler;
  sessions: PiSessionService;
  notifications: NotificationChannelService;
}
export const routineRoutes: FastifyPluginAsync<Options> = async (app, o) => {
  const wrap =
    (fn: (req: Request, reply: FastifyReply) => unknown) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(req as Request, reply);
      } catch (error) {
        const e = error as Error & { statusCode?: number };
        return reply.status(e.statusCode || 400).send({ error: e.message });
      }
    };
  const validate = async (input: RoutineInput) => {
    if (!input || typeof input.projectPath !== 'string')
      throw new Error('Project path is required');
    for (const field of ['profileId', 'provider', 'modelId'] as const) {
      if (typeof input[field] !== 'string' || !input[field].trim())
        throw new Error(`${field} is required`);
    }
    const projectPath = await validateProject(input.projectPath);
    if (
      !(await o.sessions.listAgentProfileModels(input.profileId)).some(
        (m) => m.provider === input.provider && m.id === input.modelId,
      )
    )
      throw new Error('Unknown profile or model');
    if (
      input.notificationChannelId &&
      !o.notifications
        .list()
        .some((c) => c.id === input.notificationChannelId && c.configured)
    )
      throw new Error('Notification channel unavailable');
    return { ...input, projectPath };
  };
  app.get(
    '/',
    wrap(() => ({
      routines: o.store.list(),
      latestRuns: o.store.latestRuns(),
      serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })),
  );
  app.get(
    '/runs',
    wrap((req) => {
      const offset = Number(req.query.offset || 0);
      const limit = Number(req.query.limit || 50);
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error('Invalid pagination');
      return { runs: o.store.history(offset, limit) };
    }),
  );
  app.post(
    '/',
    wrap(async (req, reply) =>
      reply
        .status(201)
        .send({ routine: o.store.create(await validate(req.body)) }),
    ),
  );
  app.put(
    '/:id',
    wrap(async (req) => ({
      routine: o.store.update(req.params.id, await validate(req.body)),
    })),
  );
  app.delete(
    '/:id',
    wrap((req, reply) => {
      o.store.delete(req.params.id);
      return reply.status(204).send();
    }),
  );
  app.post(
    '/:id/run',
    wrap((req, reply) => {
      const run = o.store.manual(req.params.id);
      o.scheduler.wake();
      return reply.status(202).send({ run });
    }),
  );
  app.post(
    '/runs/:id/cancel',
    wrap((req) => {
      o.scheduler.cancel(req.params.id);
      return { run: o.store.run(req.params.id) };
    }),
  );
  app.post(
    '/runs/:id/retry-delivery',
    wrap((req) => {
      o.store.retryDelivery(req.params.id);
      o.scheduler.wake();
      return { run: o.store.run(req.params.id) };
    }),
  );
};
