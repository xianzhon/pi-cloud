import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { MemoryStore } from './store.js';
import { MEMORY_UPDATED_EVENT, createMemoryRuntime } from './runtime.js';
import type { MemoryUpdatedEvent } from './types.js';

describe('MemoryRuntime', () => {
  let db: PiuiDatabase;
  let events: EventEmitter;

  beforeEach(() => {
    db = openPiuiDatabase(':memory:');
    events = new EventEmitter();
  });

  afterEach(() => {
    db.close();
  });

  function createRuntime() {
    return createMemoryRuntime({
      db,
      worktrees: { get: vi.fn(() => null) },
      resolveProfile: vi.fn(async () => ({
        id: 'default', label: 'default', path: '/profiles/default', isDefault: true,
        defaultProvider: 'anthropic', defaultModel: 'claude-sonnet',
      })),
      events,
    });
  }

  it('composes a named extension and delegates foreground work', async () => {
    const runtime = createRuntime();
    runtime.start();

    const extension = runtime.createExtension({ profileId: 'default', cwd: '/repo/app' });
    expect(typeof extension === 'function' ? undefined : extension.name).toBe('webui-memory');
    await expect(runtime.withForeground('default', async () => 'done')).resolves.toBe('done');

    await runtime.stop();
  });

  it('subscribes and unsubscribes the exact update listener', async () => {
    const runtime = createRuntime();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = runtime.onUpdated(first);
    runtime.onUpdated(second);
    const event: MemoryUpdatedEvent = {
      profileId: 'default', projectId: 'project-1', extractionRunId: 'run-1',
      activeProjectCount: 1, pendingGlobalCount: 0, failed: false,
    };

    events.emit(MEMORY_UPDATED_EVENT, event);
    unsubscribeFirst();
    events.emit(MEMORY_UPDATED_EVENT, event);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    await runtime.stop();
    expect(events.listenerCount(MEMORY_UPDATED_EVENT)).toBe(0);
  });

  it('deletes profile memory and canonicalizes relocated project paths', async () => {
    const store = new MemoryStore(db);
    const project = store.getOrCreateProject('work', '/repo/app');
    store.createMemory({
      profileId: 'work', projectId: project.id, scope: 'project', category: 'fact',
      content: 'Project memory', tags: [], pinned: false, status: 'active', source: 'manual_ui',
    });
    const runtime = createRuntime();

    await runtime.relocateProject(project.id, '/repo/next/../moved');
    expect(store.getProjectById(project.id)?.canonicalPath).toBe('/repo/moved');

    runtime.deleteProfile('work');
    expect(store.getProjectById(project.id)).toBeNull();
    await runtime.stop();
  });
});
