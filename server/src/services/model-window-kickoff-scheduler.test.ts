import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { ModelWindowKickoffScheduler } from './model-window-kickoff-scheduler.js';
import { ModelWindowKickoffStore } from './model-window-kickoff-store.js';
import type { NotificationChannelService } from './notification-channel.js';

const databases: ReturnType<typeof openPiCloudDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup(probe: () => Promise<void>, now = new Date('2026-01-01T00:00:00.000Z')) {
  const db = openPiCloudDatabase(':memory:');
  databases.push(db);
  const store = new ModelWindowKickoffStore(db);
  const kickoff = store.create({
    profileId: 'default', provider: 'anthropic', modelId: 'claude',
    windowDurationMinutes: 300, safetyBufferSeconds: 60, nextRunAt: now.toISOString(),
  }, now.toISOString());
  const send = vi.fn().mockResolvedValue(undefined);
  const scheduler = new ModelWindowKickoffScheduler({
    store,
    notifications: { send } as unknown as NotificationChannelService,
    resolveProfile: async () => ({ id: 'default', label: 'Default', path: '/tmp/agent', isDefault: true }),
    resolveProxy: async () => ({}),
    now: () => now,
    probe: async () => probe(),
  });
  return { store, kickoff, scheduler, send };
}

describe('ModelWindowKickoffScheduler', () => {
  it('schedules the next run from the successful request time', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const { store, kickoff, scheduler } = setup(probe);

    await scheduler.tick();

    expect(probe).toHaveBeenCalledOnce();
    expect(store.get(kickoff.id)).toMatchObject({
      lastAttemptAt: '2026-01-01T00:00:00.000Z',
      lastSuccessAt: '2026-01-01T00:00:00.000Z',
      nextRunAt: '2026-01-01T05:01:00.000Z',
      lastError: null,
    });
  });

  it('records failures and retries in one hour', async () => {
    const { store, kickoff, scheduler } = setup(async () => { throw new Error('rate limited'); });

    await scheduler.tick();

    expect(store.get(kickoff.id)).toMatchObject({
      nextRunAt: '2026-01-01T01:00:00.000Z',
      lastSuccessAt: null,
      lastError: 'rate limited',
    });
  });

  it('does not run the same kickoff twice during overlapping ticks', async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { scheduler } = setup(probe);

    const first = scheduler.tick();
    const second = scheduler.tick();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);

    expect(probe).toHaveBeenCalledOnce();
  });
});
