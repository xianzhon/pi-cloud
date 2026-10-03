import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { RoutineStore } from '../routines/store.js';
import { RoutineScheduler } from '../routines/scheduler.js';
import { NotificationChannelService } from '../services/notification-channel.js';
import { routineRoutes } from './routines.js';
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.unstubAllEnvs();
});
async function setup() {
  vi.stubEnv('PI_CLOUD_ALLOWED_ROOTS', '/tmp');
  vi.stubEnv('PI_CLOUD_DISABLE_PATH_CHECK', 'false');
  const db = openPiCloudDatabase(':memory:');
  cleanup.push(() => {
    db.close();
  });
  const store = new RoutineStore(db);
  const notifications = new NotificationChannelService(db);
  const scheduler = new RoutineScheduler({
    store,
    busy: () => false,
    execute: async () => 'done',
    send: async () => {},
  });
  // Keep HTTP commands queued so tests inspect persistence rather than timing a worker.
  scheduler.wake = () => {};
  const app = Fastify();
  cleanup.push(() => app.close());
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.authorization !== 'test-owner')
      return reply.status(401).send({ error: 'Unauthorized' });
  });
  await app.register(routineRoutes, {
    prefix: '/api/routines',
    store,
    scheduler,
    notifications,
    sessions: {
      listAgentProfileModels: async () => [{ provider: 'test', id: 'model' }],
    } as never,
  });
  const input = {
    name: 'Check CI',
    prompt: 'check',
    projectPath: '/tmp',
    profileId: 'default',
    provider: 'test',
    modelId: 'model',
    enabled: false,
    schedule: {
      kind: 'interval',
      startAt: '2099-01-01T00:00:00Z',
      minutes: 60,
    },
    timeoutMinutes: 30,
    notificationChannelId: null,
  };
  const inject = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: { authorization: 'test-owner' },
    });
  return { app, store, input, inject };
}
it('inherits authentication and exposes no routine data to unauthenticated requests', async () => {
  const { app } = await setup();
  expect((await app.inject('/api/routines')).statusCode).toBe(401);
});
it('validates allowed roots, model, notification channel and pagination', async () => {
  const { inject, input } = await setup();
  expect(
    (await inject('POST', '/api/routines', { ...input, projectPath: '/' }))
      .statusCode,
  ).toBe(403);
  expect(
    (await inject('POST', '/api/routines', { ...input, modelId: 'missing' }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await inject('POST', '/api/routines', {
        ...input,
        notificationChannelId: 'missing',
      })
    ).statusCode,
  ).toBe(400);
  expect((await inject('GET', '/api/routines/runs?offset=-1')).statusCode).toBe(
    400,
  );
});
it('creates, updates, queues and cancels runs through the authenticated API', async () => {
  const { inject, input, store } = await setup();
  const created = await inject('POST', '/api/routines', input);
  expect(created.statusCode).toBe(201);
  const r = created.json().routine;
  expect(r.enabled).toBe(false);
  expect(
    (await inject('PUT', `/api/routines/${r.id}`, { ...input, revision: 0 }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await inject('PUT', `/api/routines/${r.id}`, {
        ...input,
        name: 'Updated',
        revision: 1,
      })
    ).statusCode,
  ).toBe(200);
  const queued = await inject('POST', `/api/routines/${r.id}/run`);
  expect(queued.statusCode).toBe(202);
  const run = queued.json().run;
  expect((await inject('POST', `/api/routines/${r.id}/run`)).statusCode).toBe(
    409,
  );
  expect((await inject('DELETE', `/api/routines/${r.id}`)).statusCode).toBe(
    409,
  );
  expect(
    (await inject('POST', `/api/routines/runs/${run.id}/cancel`)).json().run
      .status,
  ).toBe('cancelled');
  expect((await inject('DELETE', `/api/routines/${r.id}`)).statusCode).toBe(
    204,
  );
  expect(store.history()[0].snapshot.name).toBe('Updated');
  expect((await inject('POST', '/api/routines/missing/run')).statusCode).toBe(
    404,
  );
});
