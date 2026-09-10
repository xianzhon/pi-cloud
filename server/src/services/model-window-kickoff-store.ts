import { randomUUID } from 'node:crypto';
import type { PiCloudDatabase } from '../db/database.js';

export const DEFAULT_KICKOFF_PROMPT = 'Ping';

export interface ModelWindowKickoff {
  id: string;
  enabled: boolean;
  profileId: string;
  provider: string;
  modelId: string;
  projectPath: string;
  prompt: string;
  windowDurationMinutes: number;
  safetyBufferSeconds: number;
  notificationChannelId: string | null;
  nextRunAt: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelWindowKickoffInput {
  enabled?: boolean;
  profileId: string;
  provider: string;
  modelId: string;
  projectPath?: string;
  prompt?: string;
  windowDurationMinutes?: number;
  safetyBufferSeconds?: number;
  notificationChannelId?: string | null;
  nextRunAt?: string;
}

interface KickoffRow {
  id: string;
  enabled: number;
  profile_id: string;
  provider: string;
  model_id: string;
  project_path: string;
  prompt: string;
  window_duration_minutes: number;
  safety_buffer_seconds: number;
  notification_channel_id: string | null;
  next_run_at: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ValidatedKickoffInput {
  enabled: boolean;
  profileId: string;
  provider: string;
  modelId: string;
  projectPath: string;
  prompt: string;
  windowDurationMinutes: number;
  safetyBufferSeconds: number;
  notificationChannelId: string | null;
  nextRunAt: string;
}

export class ModelWindowKickoffStore {
  constructor(private readonly db: PiCloudDatabase) {}

  list(): ModelWindowKickoff[] {
    return (this.db.prepare('SELECT * FROM model_window_kickoffs ORDER BY created_at').all() as KickoffRow[]).map(toRecord);
  }

  get(id: string): ModelWindowKickoff | undefined {
    const row = this.db.prepare('SELECT * FROM model_window_kickoffs WHERE id = ?').get(id) as KickoffRow | undefined;
    return row && toRecord(row);
  }

  listDue(now: string): ModelWindowKickoff[] {
    return (this.db.prepare(`
      SELECT * FROM model_window_kickoffs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at
    `).all(now) as KickoffRow[]).map(toRecord);
  }

  create(input: ModelWindowKickoffInput, now = new Date().toISOString()): ModelWindowKickoff {
    const value = validateInput(input, now);
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO model_window_kickoffs (
        id, enabled, profile_id, provider, model_id, project_path, prompt, window_duration_minutes,
        safety_buffer_seconds, notification_channel_id, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, value.enabled ? 1 : 0, value.profileId, value.provider, value.modelId, value.projectPath, value.prompt,
      value.windowDurationMinutes, value.safetyBufferSeconds, value.notificationChannelId, value.nextRunAt, now, now);
    return this.get(id)!;
  }

  update(id: string, input: ModelWindowKickoffInput, now = new Date().toISOString()): ModelWindowKickoff {
    if (!this.get(id)) throw new Error('Model window kickoff not found');
    const value = validateInput(input, now);
    this.db.prepare(`
      UPDATE model_window_kickoffs SET enabled = ?, profile_id = ?, provider = ?, model_id = ?, project_path = ?, prompt = ?,
        window_duration_minutes = ?, safety_buffer_seconds = ?, notification_channel_id = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(value.enabled ? 1 : 0, value.profileId, value.provider, value.modelId, value.projectPath, value.prompt,
      value.windowDurationMinutes, value.safetyBufferSeconds, value.notificationChannelId, value.nextRunAt, now, id);
    return this.get(id)!;
  }

  delete(id: string): void {
    if (this.db.prepare('DELETE FROM model_window_kickoffs WHERE id = ?').run(id).changes !== 1) {
      throw new Error('Model window kickoff not found');
    }
  }

  recordAttempt(id: string, at: string): void {
    this.db.prepare('UPDATE model_window_kickoffs SET last_attempt_at = ?, updated_at = ? WHERE id = ?').run(at, at, id);
  }

  recordSuccess(id: string, at: string, nextRunAt: string): void {
    this.db.prepare(`UPDATE model_window_kickoffs SET last_success_at = ?, next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(at, nextRunAt, at, id);
  }

  recordFailure(id: string, at: string, error: string, nextRunAt: string): void {
    this.db.prepare(`UPDATE model_window_kickoffs SET last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?`)
      .run(error.slice(0, 2000), nextRunAt, at, id);
  }
}

function validateInput(input: ModelWindowKickoffInput, now: string): ValidatedKickoffInput {
  const profileId = input.profileId?.trim();
  const provider = input.provider?.trim();
  const modelId = input.modelId?.trim();
  const projectPath = input.projectPath?.trim() || '~';
  const prompt = (input.prompt ?? DEFAULT_KICKOFF_PROMPT).trim();
  const windowDurationMinutes = input.windowDurationMinutes ?? 300;
  const safetyBufferSeconds = input.safetyBufferSeconds ?? 60;
  const nextRunAt = input.nextRunAt ?? now;

  if (!profileId || !provider || !modelId || !prompt) {
    throw new Error('Profile, provider, model, and prompt are required');
  }
  if (!Number.isInteger(windowDurationMinutes) || windowDurationMinutes < 1 || windowDurationMinutes > 43_200) {
    throw new Error('Window duration must be between 1 and 43200 minutes');
  }
  if (!Number.isInteger(safetyBufferSeconds) || safetyBufferSeconds < 0 || safetyBufferSeconds > 86_400) {
    throw new Error('Safety buffer must be between 0 and 86400 seconds');
  }
  if (!Number.isFinite(Date.parse(nextRunAt))) {
    throw new Error('Next run time is invalid');
  }

  return {
    enabled: input.enabled ?? true,
    profileId,
    provider,
    modelId,
    projectPath,
    prompt,
    windowDurationMinutes,
    safetyBufferSeconds,
    notificationChannelId: input.notificationChannelId || null,
    nextRunAt: new Date(nextRunAt).toISOString(),
  };
}

function toRecord(row: KickoffRow): ModelWindowKickoff {
  return {
    id: row.id,
    enabled: Boolean(row.enabled),
    profileId: row.profile_id,
    provider: row.provider,
    modelId: row.model_id,
    projectPath: row.project_path,
    prompt: row.prompt,
    windowDurationMinutes: row.window_duration_minutes,
    safetyBufferSeconds: row.safety_buffer_seconds,
    notificationChannelId: row.notification_channel_id,
    nextRunAt: row.next_run_at,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
