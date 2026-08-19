import { describe, expect, it } from 'vitest';
import { defaultSessionLaunchValue, toSessionCreatePayload, toTaskLaunchSnapshot } from './sessionLaunch';

describe('session launch conversion', () => {
  it('converts a preset selection to the existing session payload', () => {
    const value = {
      ...defaultSessionLaunchValue(),
      modelProvider: 'openai',
      modelId: 'gpt-5.4',
      skillSelection: 'preset' as const,
      skillMode: 'enabled' as const,
      skills: ['a', 'a', ''],
      presetId: 'p1',
    };

    expect(toSessionCreatePayload(value)).toEqual({
      modelProvider: 'openai',
      modelId: 'gpt-5.4',
      enabledSkills: ['a'],
      presetId: 'p1',
      worktree: { mode: 'none' },
    });
  });

  it('stores the resolved skills and preset reference for a task', () => {
    const value = {
      ...defaultSessionLaunchValue(),
      modelProvider: 'openai',
      modelId: 'gpt-5.4',
      skillSelection: 'preset' as const,
      skillMode: 'disabled' as const,
      skills: ['frontend-design'],
      presetId: 'p1',
    };

    expect(toTaskLaunchSnapshot(value)).toEqual({
      modelProvider: 'openai',
      modelId: 'gpt-5.4',
      skillMode: 'disabled',
      skills: ['frontend-design'],
      presetId: 'p1',
      worktree: { mode: 'none' },
    });
  });

  it('keeps all-skills and managed-worktree settings', () => {
    const value = {
      ...defaultSessionLaunchValue(),
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4',
      worktree: { mode: 'managed' as const, branchMode: 'new' as const, branchName: 'feature/tasks', baseBranch: 'main' },
    };

    expect(toSessionCreatePayload(value)).toEqual({
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4',
      worktree: value.worktree,
    });
    expect(toTaskLaunchSnapshot(value).skillMode).toBe('all');
  });
});
