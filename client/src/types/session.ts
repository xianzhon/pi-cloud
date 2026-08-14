export interface InitialSkillPolicy {
  mode: 'all' | 'enabled' | 'disabled';
  skills: string[];
  presetId?: string | null;
}
