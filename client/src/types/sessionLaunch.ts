export type ModelOption = { provider: string; id: string; name?: string; input?: string[] };

export type WorktreePayload =
  | { mode: 'none' }
  | { mode: 'managed'; branchMode: 'new'; branchName: string; baseBranch: string; copyFile?: string }
  | { mode: 'managed'; branchMode: 'existing'; branchName: string; copyFile?: string };

export type SkillSelection = 'all' | 'preset' | 'custom';
export type SkillMode = 'all' | 'enabled' | 'disabled';

export interface SessionLaunchValue {
  modelProvider: string;
  modelId: string;
  skillSelection: SkillSelection;
  skillMode: SkillMode;
  skills: string[];
  presetId: string;
  worktree: WorktreePayload;
}

export interface SessionCreatePayload {
  modelProvider?: string;
  modelId?: string;
  enabledSkills?: string[];
  disabledSkills?: string[];
  presetId?: string;
  worktree: WorktreePayload;
}

export interface TaskLaunchSnapshot {
  modelProvider: string;
  modelId: string;
  skillMode: SkillMode;
  skills: string[];
  presetId?: string;
  worktree: WorktreePayload;
}

export function defaultSessionLaunchValue(): SessionLaunchValue {
  return {
    modelProvider: '',
    modelId: '',
    skillSelection: 'all',
    skillMode: 'all',
    skills: [],
    presetId: '',
    worktree: { mode: 'none' },
  };
}

export function toSessionCreatePayload(value: SessionLaunchValue): SessionCreatePayload {
  const skills = normalizeSkills(value.skills);
  const model = value.modelProvider && value.modelId
    ? { modelProvider: value.modelProvider, modelId: value.modelId }
    : {};
  if (value.skillSelection === 'preset') {
    return {
      ...model,
      ...(value.skillMode === 'enabled' ? { enabledSkills: skills } : { disabledSkills: skills }),
      presetId: value.presetId,
      worktree: value.worktree,
    };
  }
  if (value.skillSelection === 'custom') {
    return {
      ...model,
      ...(value.skillMode === 'enabled' ? { enabledSkills: skills } : { disabledSkills: skills }),
      worktree: value.worktree,
    };
  }
  return { ...model, worktree: value.worktree };
}

export function toTaskLaunchSnapshot(value: SessionLaunchValue): TaskLaunchSnapshot {
  const skillMode = value.skillSelection === 'all' ? 'all' : value.skillMode;
  return {
    modelProvider: value.modelProvider,
    modelId: value.modelId,
    skillMode,
    skills: skillMode === 'all' ? [] : normalizeSkills(value.skills),
    ...(value.skillSelection === 'preset' ? { presetId: value.presetId } : {}),
    worktree: value.worktree,
  };
}

function normalizeSkills(skills: string[]): string[] {
  return Array.from(new Set(skills.map((skill) => skill.trim()).filter(Boolean)));
}
