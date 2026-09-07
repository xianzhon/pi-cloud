import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiCloudDatabase } from '../db/database.js';
import { ModelWindowKickoffScheduler, probeModel } from './model-window-kickoff-scheduler.js';
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
    sessions: {} as never,
    resolveProfile: async () => ({ id: 'default', label: 'Default', path: '/tmp/agent', isDefault: true }),
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

  it('sends the probe through a named persistent Pi session', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const session = {
      sessionId: 'session-1',
      prompt,
      messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'OK' }] }],
    };
    const sessions = {
      setClientAgentProfile: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockReturnValue(undefined),
      listSessions: vi.fn().mockResolvedValue([]),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue({ session }),
      renameSession: vi.fn().mockResolvedValue(undefined),
      setSessionModel: vi.fn().mockResolvedValue(undefined),
      runForegroundWithClientProfileProxy: vi.fn(async (_clientId, run) => run()),
    };
    const kickoff = {
      id: '12345678-abcd', profileId: 'codex', provider: 'openai-codex', modelId: 'gpt-5.6-luna', prompt: 'Ping',
    } as Parameters<typeof probeModel>[0];

    await probeModel(kickoff, sessions as never);

    expect(sessions.createSession).toHaveBeenCalledWith('model-window-kickoff:12345678-abcd', expect.objectContaining({
      agentProfileId: 'codex',
      modelProvider: 'openai-codex',
      modelId: 'gpt-5.6-luna',
      memoryEnabled: false,
    }));
    expect(sessions.renameSession).toHaveBeenCalledWith(
      'model-window-kickoff:12345678-abcd',
      'session-1',
      'Model window kickoff: openai-codex/gpt-5.6-luna (12345678)',
    );
    expect(sessions.runForegroundWithClientProfileProxy).toHaveBeenCalledWith(
      'model-window-kickoff:12345678-abcd',
      expect.any(Function),
    );
    expect(prompt).toHaveBeenCalledWith('Ping');
  });
});
