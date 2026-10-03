import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { RoutineStore } from './store.js';
import { nextOccurrence } from './schedule.js';
import { RoutineScheduler } from './scheduler.js';
const databases: ReturnType<typeof openPiCloudDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup() {
  const db = openPiCloudDatabase(':memory:');
  databases.push(db);
  const store = new RoutineStore(db);
  const routine = store.create(
    {
      name: 'Check CI',
      prompt: 'Check',
      projectPath: '/tmp',
      profileId: 'default',
      provider: 'test',
      modelId: 'model',
      enabled: true,
      schedule: {
        kind: 'interval',
        startAt: '2026-01-01T00:00:00.000Z',
        minutes: 60,
      },
      timeoutMinutes: 30,
      notificationChannelId: 'channel',
    },
    '2025-12-31T00:00:00.000Z',
  );
  return { db, store, routine };
}
describe('routine schedules', () => {
  it('keeps intervals anchored while coalescing missed occurrences', () => {
    expect(
      nextOccurrence(
        { kind: 'interval', startAt: '2026-01-01T00:00:00Z', minutes: 60 },
        '2026-01-01T03:20:00Z',
      ),
    ).toBe('2026-01-01T04:00:00.000Z');
  });
  it('calculates tomorrow when today’s local daily time has passed', () => {
    const now = new Date(2026, 0, 1, 10, 0);
    const expected = new Date(2026, 0, 2, 8, 0).toISOString();
    expect(
      nextOccurrence({ kind: 'daily', time: '08:00' }, now.toISOString()),
    ).toBe(expected);
  });
});
describe('durable routines', () => {
  it('materializes one overdue run and advances to a future occurrence', () => {
    const { store, routine } = setup();
    store.materialize('2026-01-01T03:20:00.000Z');
    store.materialize('2026-01-01T03:20:00.000Z');
    expect(store.history().length).toBe(1);
    expect(store.get(routine.id).nextRunAt).toBe('2026-01-01T04:00:00.000Z');
  });
  it('rejects overlapping manual runs and stale edits', () => {
    const { store, routine } = setup();
    store.manual(routine.id);
    expect(() => store.manual(routine.id)).toThrow();
    expect(() =>
      store.update(routine.id, { ...routine, revision: 0 }),
    ).toThrow();
  });
  it('preserves queued work but marks started work interrupted after restart', () => {
    const { store, routine } = setup();
    const run = store.manual(routine.id);
    store.claim(run.id);
    store.recover();
    expect(store.run(run.id).status).toBe('interrupted');
    expect(store.pendingDeliveries(new Date().toISOString())).toHaveLength(1);
  });
  it('cancels obsolete queued work when the routine is disabled', () => {
    const { store, routine } = setup();
    store.materialize('2026-01-01T00:00:00.000Z');
    store.update(routine.id, { ...routine, enabled: false });
    expect(store.history()[0].status).toBe('cancelled');
  });
  it('retries notification delivery without executing the successful prompt again', async () => {
    const { store } = setup();
    let executions = 0;
    let sends = 0;
    let now = '2026-01-01T00:00:00.000Z';
    const scheduler = new RoutineScheduler({
      store,
      now: () => now,
      busy: () => false,
      execute: async () => {
        executions++;
        return 'Done';
      },
      send: async () => {
        sends++;
        if (sends === 1) throw new Error('offline');
      },
    });
    await scheduler.tick();
    expect(store.history()[0].status).toBe('succeeded');
    expect(store.history()[0].delivery?.status).toBe('pending');
    now = '2026-01-01T00:01:00.000Z';
    await scheduler.tick();
    expect(executions).toBe(1);
    expect(store.history()[0].delivery?.status).toBe('sent');
  });
});

it('keeps WeCom payloads below the byte limit with Chinese summaries', () => {
  const { store, routine } = setup();
  const run = store.manual(routine.id);
  store.claim(run.id);
  store.settle(run.id, 'succeeded', '结果'.repeat(4000));
  expect(
    Buffer.byteLength(store.run(run.id).delivery!.message, 'utf8'),
  ).toBeLessThanOrEqual(3600);
});
it('keeps a cancelled worker occupied until the underlying execution settles', async () => {
  const { store } = setup();
  let finish!: (value: string) => void;
  let started = 0;
  const scheduler = new RoutineScheduler({
    store,
    now: () => '2026-01-01T00:00:00.000Z',
    busy: () => false,
    execute: async () => {
      started++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
    send: async () => {},
  });
  const first = scheduler.tick();
  const run = store.history()[0];
  scheduler.cancel(run.id);
  expect(store.run(run.id).status).toBe('running');
  const second = scheduler.tick();
  finish('finished despite abort');
  await Promise.all([first, second]);
  expect(started).toBe(1);
  expect(store.run(run.id).status).toBe('cancelled');
});
it('exhausts delivery retries without retrying the execution', async () => {
  const { store, routine } = setup();
  store.update(routine.id, { ...routine, enabled: false });
  store.manual(routine.id);
  let executions = 0;
  let now = '2026-01-01T00:00:00.000Z';
  const scheduler = new RoutineScheduler({
    store,
    now: () => now,
    busy: () => false,
    execute: async () => {
      executions++;
      return 'Done';
    },
    send: async () => {
      throw new Error('offline');
    },
  });
  for (const time of ['00:00', '00:01', '00:06', '00:36', '00:50']) {
    now = `2026-01-01T${time}:00.000Z`;
    await scheduler.tick();
  }
  const run = store.history()[0];
  expect(run.status).toBe('succeeded');
  expect(run.delivery).toMatchObject({ status: 'failed', attempts: 4 });
  expect(executions).toBe(1);
  store.retryDelivery(run.id);
  expect(store.run(run.id).delivery?.status).toBe('pending');
});
it('materializes a one-time routine once and keeps its historical snapshot after deletion', () => {
  const { store, routine } = setup();
  const once = store.create(
    {
      ...routine,
      name: 'once',
      schedule: { kind: 'once', startAt: '2026-01-01T00:00:00Z' },
    },
    '2025-12-31T00:00:00Z',
  );
  store.materialize('2026-01-01T00:00:00.000Z');
  const run = store.history().find((r) => r.routineId === once.id)!;
  store.settle(run.id, 'succeeded', 'done');
  store.delete(once.id);
  store.materialize('2026-01-01T00:10:00.000Z');
  expect(store.run(run.id).snapshot.name).toBe('once');
  expect(store.history().filter((r) => r.routineId === once.id)).toHaveLength(
    1,
  );
});
it('retains queued manual work across recovery', () => {
  const { store, routine } = setup();
  const run = store.manual(routine.id);
  store.recover();
  expect(store.run(run.id).status).toBe('queued');
});

it('dispatches earlier notifications while another execution is still running', async () => {
  const { store, routine } = setup();
  store.update(routine.id, { ...routine, enabled: false });
  const earlier = store.manual(routine.id);
  store.settle(
    earlier.id,
    'succeeded',
    'earlier',
    null,
    '2026-01-01T00:00:00.000Z',
  );
  store.manual(routine.id);
  let finish!: (value: string) => void;
  let sends = 0;
  const scheduler = new RoutineScheduler({
    store,
    now: () => '2026-01-01T00:01:00.000Z',
    busy: () => false,
    execute: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    send: async () => {
      sends++;
    },
  });
  const work = scheduler.tick();
  try {
    await Promise.resolve();
    expect(sends).toBe(1);
    expect(store.run(earlier.id).delivery?.status).toBe('sent');
  } finally {
    finish('done');
    await work;
    await scheduler.stop();
  }
});
it('does not exceed the delivery attempt limit after an uncertain fourth send', () => {
  const { store, routine } = setup();
  const run = store.manual(routine.id);
  store.settle(run.id, 'succeeded', 'done');
  const delivery = store.run(run.id).delivery!;
  store.saveDelivery({ ...delivery, status: 'sending', attempts: 4 });
  store.recover();
  expect(store.run(run.id).delivery?.status).toBe('failed');
  expect(store.pendingDeliveries('2099-01-01T00:00:00Z')).toHaveLength(0);
});
it('returns each routine’s latest run independently of paginated history', () => {
  const { store, routine } = setup();
  const old = store.manual(routine.id);
  store.settle(old.id, 'succeeded', 'old');
  const other = store.create(
    { ...routine, name: 'Other', enabled: false },
    '2025-12-31T00:00:00Z',
  );
  for (let i = 0; i < 25; i++) {
    const run = store.manual(other.id);
    store.settle(run.id, 'succeeded', 'other');
  }
  expect(store.history(0, 20).some((run) => run.routineId === routine.id)).toBe(
    false,
  );
  expect(
    store.latestRuns().find((run) => run.routineId === routine.id)?.id,
  ).toBe(old.id);
});

it('keeps a timed-out worker occupied until the agent acknowledges abort', async () => {
  const { store, routine } = setup();
  store.update(routine.id, { ...routine, enabled: false });
  const queued = store.manual(routine.id);
  let finish!: (value: string) => void;
  vi.useFakeTimers();
  const scheduler = new RoutineScheduler({
    store,
    busy: () => false,
    execute: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    send: async () => {},
  });
  try {
    const work = scheduler.tick();
    await vi.advanceTimersByTimeAsync(30 * 60000);
    expect(store.run(queued.id).status).toBe('running');
    finish('partial');
    await work;
    expect(store.run(queued.id).status).toBe('timed_out');
    await scheduler.stop();
  } finally {
    vi.useRealTimers();
  }
});
it('defers busy directories while executing another eligible queued run', async () => {
  const { store, routine } = setup();
  store.update(routine.id, { ...routine, enabled: false });
  const blocked = store.manual(routine.id);
  const other = store.create(
    { ...routine, projectPath: '/tmp/other', enabled: false },
    '2025-12-31T00:00:00Z',
  );
  const ready = store.manual(other.id);
  const scheduler = new RoutineScheduler({
    store,
    busy: (path) => path === '/tmp',
    execute: async () => 'done',
    send: async () => {},
  });
  await scheduler.tick();
  await scheduler.stop();
  expect(store.run(blocked.id).status).toBe('queued');
  expect(store.run(ready.id).status).toBe('succeeded');
});
