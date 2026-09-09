import type { AgentProfile } from '../types.js';
import { ModelWindowKickoffStore, type ModelWindowKickoff } from './model-window-kickoff-store.js';
import { NotificationChannelService } from './notification-channel.js';
import type { PiSessionService } from './session-manager.js';

const POLL_INTERVAL_MS = 1 * 60_000;
const FAILURE_RETRY_MS = 60 * 60_000;
type KickoffSessionService = Pick<PiSessionService,
  'setClientAgentProfile' | 'listSessions' | 'resumeSession' | 'createSession'
  | 'renameSession' | 'setSessionModel' | 'runForegroundWithClientProfileProxy'>;

interface SchedulerDependencies {
  store: ModelWindowKickoffStore;
  notifications: NotificationChannelService;
  sessions: KickoffSessionService;
  resolveProfile(profileId: string): Promise<AgentProfile | undefined>;
  now?: () => Date;
  probe?: (kickoff: ModelWindowKickoff, profile: AgentProfile) => Promise<string | void>;
  pollIntervalMs?: number;
  log?: { error(value: unknown, message?: string): void };
}

export class ModelWindowKickoffScheduler {
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<string>();
  private readonly now: () => Date;

  constructor(private readonly dependencies: SchedulerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.dependencies.pollIntervalMs ?? POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running.size) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async tick(): Promise<void> {
    const due = this.dependencies.store.listDue(this.now().toISOString());
    await Promise.allSettled(due.map((kickoff) => this.run(kickoff)));
  }

  private async run(kickoff: ModelWindowKickoff): Promise<void> {
    if (this.running.has(kickoff.id)) return;
    this.running.add(kickoff.id);
    const attemptedAt = this.now();
    this.dependencies.store.recordAttempt(kickoff.id, attemptedAt.toISOString());
    try {
      const profile = await this.dependencies.resolveProfile(kickoff.profileId);
      if (!profile) throw new Error('Agent profile not found');
      const response = this.dependencies.probe
        ? await this.dependencies.probe(kickoff, profile)
        : await probeModel(kickoff, this.dependencies.sessions);
      const successfulAt = this.now();
      const next = new Date(successfulAt.getTime()
        + kickoff.windowDurationMinutes * 60_000
        + kickoff.safetyBufferSeconds * 1000);
      this.dependencies.store.recordSuccess(kickoff.id, successfulAt.toISOString(), next.toISOString());
      if (kickoff.notificationChannelId) {
        try {
          await this.dependencies.notifications.send(
            kickoff.notificationChannelId,
            formatSuccessNotification(kickoff, profile, response, attemptedAt, next),
          );
        } catch (error) {
          this.dependencies.log?.error(error, 'Model window kickoff notification failed');
        }
      }
    } catch (error) {
      const failedAt = this.now();
      const failure = error instanceof Error ? error.message : String(error);
      const retryAt = new Date(failedAt.getTime() + FAILURE_RETRY_MS);
      this.dependencies.store.recordFailure(kickoff.id, failedAt.toISOString(), failure, retryAt.toISOString());
      if (kickoff.notificationChannelId) {
        try {
          await this.dependencies.notifications.send(
            kickoff.notificationChannelId,
            formatFailureNotification(kickoff, failure, attemptedAt, retryAt),
          );
        } catch (notificationError) {
          this.dependencies.log?.error(notificationError, 'Model window kickoff failure notification failed');
        }
      }
    } finally {
      this.running.delete(kickoff.id);
    }
  }
}

function formatSuccessNotification(
  kickoff: ModelWindowKickoff,
  profile: AgentProfile,
  response: string | void,
  startedAt: Date,
  next: Date,
): string {
  return [
    '✅Model window started',
    markdownField('Profile', profile.label || profile.id),
    markdownField('Model', `${kickoff.provider}/${kickoff.modelId}`),
    ...(response ? [markdownField('Response', response)] : []),
    markdownField('Started time', formatLocalDateTime(startedAt), 'warning'),
    markdownField('Next kickoff', formatLocalDateTime(next)),
  ].join('\n');
}

function formatFailureNotification(
  kickoff: ModelWindowKickoff,
  failure: string,
  startedAt: Date,
  retryAt: Date,
): string {
  return [
    '❌Model window kickoff failed',
    markdownField('Profile', kickoff.profileId),
    markdownField('Model', `${kickoff.provider}/${kickoff.modelId}`),
    markdownField('Error', failure, 'warning'),
    markdownField('Started time', formatLocalDateTime(startedAt), 'warning'),
    markdownField('Retry', formatLocalDateTime(retryAt)),
  ].join('\n');
}

function markdownField(label: string, value: string, color = 'comment'): string {
  return `>${label}: <font color="${color}">${value}</font>`;
}

function formatLocalDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export async function probeModel(kickoff: ModelWindowKickoff, sessions: KickoffSessionService): Promise<string> {
  const clientId = `model-window-kickoff:${kickoff.id}`;
  const sessionName = `Model window kickoff: ${kickoff.provider}/${kickoff.modelId} (${kickoff.id.slice(0, 8)})`;
  await sessions.setClientAgentProfile(clientId, kickoff.profileId);

  const persisted = (await sessions.listSessions(clientId, kickoff.projectPath))
    .find((item) => item.name === sessionName);
  let activeSession: Awaited<ReturnType<KickoffSessionService['resumeSession']>>;
  if (persisted) {
    activeSession = await sessions.resumeSession(clientId, persisted.path);
  } else {
    activeSession = (await sessions.createSession(clientId, {
      cwd: kickoff.projectPath,
      agentProfileId: kickoff.profileId,
      modelProvider: kickoff.provider,
      modelId: kickoff.modelId,
      memoryEnabled: false,
    })).session;
    await sessions.renameSession(clientId, activeSession.sessionId, sessionName);
  }
  await sessions.setSessionModel(clientId, activeSession.sessionId, kickoff.provider, kickoff.modelId);
  await sessions.runForegroundWithClientProfileProxy(clientId, () => activeSession.prompt(kickoff.prompt));

  const response = [...activeSession.messages].reverse().find((message) => (
    message.role === 'assistant' && 'stopReason' in message
  ));
  if (!response || !('stopReason' in response)) throw new Error('Model kickoff finished without an assistant response');
  if (response.stopReason === 'error' || response.stopReason === 'aborted') {
    throw new Error(response.errorMessage || `Model kickoff ${response.stopReason}`);
  }
  return extractAssistantText(response.content);
}

function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: 'text'; text: string } => (
      typeof part === 'object' && part !== null && 'type' in part && part.type === 'text'
      && 'text' in part && typeof part.text === 'string'
    ))
    .map((part) => part.text)
    .join('')
    .trim();
}
