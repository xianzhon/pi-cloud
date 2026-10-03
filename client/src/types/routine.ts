export type Schedule =
  | { kind: 'once'; startAt: string }
  | { kind: 'interval'; startAt: string; minutes: number }
  | { kind: 'daily'; time: string };
export interface RoutineInput {
  name: string;
  prompt: string;
  projectPath: string;
  profileId: string;
  provider: string;
  modelId: string;
  enabled: boolean;
  schedule: Schedule;
  timeoutMinutes: number;
  notificationChannelId: string | null;
  revision?: number;
}
export interface Routine extends RoutineInput {
  id: string;
  revision: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted';
export interface Delivery {
  id: string;
  runId: string;
  channelId: string;
  message: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  nextAttemptAt: string;
  error: string | null;
}
export interface Run {
  id: string;
  routineId: string;
  trigger: 'scheduled' | 'manual';
  occurrence: string;
  snapshot: Routine;
  status: RunStatus;
  sessionId: string | null;
  sessionPath: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  error: string | null;
  delivery?: Delivery;
}
