import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PiuiDatabase } from '../db/database';
import { openPiuiDatabase } from '../db/database';
import {
  ProjectTaskConflictError,
  ProjectTaskStore,
  ProjectTaskValidationError,
  type ProjectTaskDraft,
} from './project-task-store';

const baseDraft: ProjectTaskDraft = {
  projectPath: '/repo/app',
  title: 'Fix queue',
  prompt: 'Implement it',
  notes: 'private',
  agentProfileId: 'codex',
  modelProvider: 'openai',
  modelId: 'gpt-5.4',
  skillMode: 'enabled',
  skills: ['brainstorming'],
  worktree: { mode: 'none' },
};

describe('ProjectTaskStore', () => {
  let db: PiuiDatabase;
  let now: string;
  let nextId: number;
  let store: ProjectTaskStore;

  beforeEach(() => {
    db = openPiuiDatabase(':memory:');
    now = '2026-07-14T00:00:00.000Z';
    nextId = 1;
    store = new ProjectTaskStore(db, {
      createId: () => `task-${nextId++}`,
      now: () => now,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('creates and maps a normalized waiting task', () => {
    const task = store.create({
      ...baseDraft,
      title: '  Fix queue  ',
      prompt: '  Implement it  ',
      skills: ['brainstorming', 'brainstorming', ''],
    });

    expect(task).toEqual({
      id: 'task-1',
      ...baseDraft,
      title: 'Fix queue',
      prompt: 'Implement it',
      status: 'waiting',
      sessionId: null,
      giteaIssue: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    });
    expect(store.get(task.id)).toEqual(task);
  });

  it('lists oldest tasks first and filters by project and status', () => {
    const first = store.create(baseDraft);
    now = '2026-07-14T01:00:00.000Z';
    const second = store.create({ ...baseDraft, projectPath: '/repo/other', title: 'Second' });
    store.claimStart(second.id);

    expect(store.list()).toEqual([first, expect.objectContaining({ id: second.id, status: 'starting' })]);
    expect(store.list({ projectPath: '/repo/app', status: 'waiting' })).toEqual([first]);
    expect(store.list({ status: 'starting' })).toEqual([expect.objectContaining({ id: second.id })]);
    expect(store.listProjectPaths()).toEqual(['/repo/app', '/repo/other']);
  });

  it('updates only waiting tasks', () => {
    const task = store.create(baseDraft);
    now = '2026-07-14T02:00:00.000Z';

    const updated = store.update(task.id, {
      ...baseDraft,
      title: 'Updated',
      worktree: { mode: 'managed', branchMode: 'new', branchName: 'feature/tasks', baseBranch: 'main' },
    });

    expect(updated).toMatchObject({ title: 'Updated', updatedAt: now, worktree: { mode: 'managed', branchName: 'feature/tasks' } });
    store.claimStart(task.id);
    expect(() => store.update(task.id, baseDraft)).toThrow(ProjectTaskConflictError);
  });

  it('stores Gitea issue metadata on a task', () => {
    const task = store.create(baseDraft);
    const updated = store.attachGiteaIssue(task.id, {
      owner: 'owner',
      repo: 'repo',
      number: 12,
      url: 'https://git.example.com/owner/repo/issues/12',
    });

    expect(updated.giteaIssue).toEqual({
      owner: 'owner',
      repo: 'repo',
      number: 12,
      url: 'https://git.example.com/owner/repo/issues/12',
      createdAt: '2026-07-14T00:00:00.000Z',
    });
    expect(store.get(task.id)?.giteaIssue?.number).toBe(12);
  });

  it('claims, starts, and completes a task with conditional transitions', () => {
    const task = store.create(baseDraft);

    expect(store.claimStart(task.id).status).toBe('starting');
    expect(() => store.claimStart(task.id)).toThrow(ProjectTaskConflictError);

    now = '2026-07-14T03:00:00.000Z';
    expect(store.markStarted(task.id, 'session-1')).toMatchObject({
      status: 'started',
      sessionId: 'session-1',
      startedAt: now,
    });

    now = '2026-07-14T04:00:00.000Z';
    expect(store.complete(task.id)).toMatchObject({ status: 'completed', completedAt: now });
    expect(() => store.complete(task.id)).toThrow(ProjectTaskConflictError);
  });

  it('restores failed and orphaned starts to waiting', () => {
    const first = store.create(baseDraft);
    const second = store.create({ ...baseDraft, title: 'Second' });
    store.claimStart(first.id);
    store.claimStart(second.id);

    expect(store.restoreWaiting(first.id).status).toBe('waiting');
    expect(store.restoreAllStarting()).toBe(1);
    expect(store.get(second.id)?.status).toBe('waiting');
  });

  it('replaces project paths for every status and deletes without touching sessions', () => {
    const waiting = store.create(baseDraft);
    const started = store.create({ ...baseDraft, title: 'Started' });
    store.claimStart(started.id);
    store.markStarted(started.id, 'session-1');

    expect(store.replaceProjectPath('/repo/app', '/repo/moved')).toBe(2);
    expect(store.list().map((task) => task.projectPath)).toEqual(['/repo/moved', '/repo/moved']);

    store.delete(started.id);
    expect(store.get(started.id)).toBeNull();
    expect(store.get(waiting.id)).not.toBeNull();
  });

  it('rejects blank content and malformed launch settings', () => {
    expect(() => store.create({ ...baseDraft, title: ' ' })).toThrow(ProjectTaskValidationError);
    expect(() => store.create({ ...baseDraft, prompt: ' ' })).toThrow(ProjectTaskValidationError);
    expect(() => store.create({ ...baseDraft, worktree: { mode: 'managed' } as any })).toThrow(ProjectTaskValidationError);
  });
});
