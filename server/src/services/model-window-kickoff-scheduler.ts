import { complete } from '@earendil-works/pi-ai/compat';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import type { AgentProfile } from '../types.js';
import { runWithAgentDirAndProxyEnv, type ProxyEnv } from './profile-proxy.js';
import { ModelWindowKickoffStore, type ModelWindowKickoff } from './model-window-kickoff-store.js';
import { NotificationChannelService } from './notification-channel.js';

const POLL_INTERVAL_MS = 10 * 60_000;
const FAILURE_RETRY_MS = 60 * 60_000;
const PROBE_TIMEOUT_MS = 60_000;

interface SchedulerDependencies {
  store: ModelWindowKickoffStore;
  notifications: NotificationChannelService;
  resolveProfile(profileId: string): Promise<AgentProfile | undefined>;
  resolveProxy(profileId: string): Promise<ProxyEnv>;
  now?: () => Date;
  probe?: (kickoff: ModelWindowKickoff, profile: AgentProfile, proxy: ProxyEnv) => Promise<void>;
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
      const proxy = await this.dependencies.resolveProxy(kickoff.profileId);
      await (this.dependencies.probe ?? probeModel)(kickoff, profile, proxy);
      const successfulAt = this.now();
      const next = new Date(successfulAt.getTime()
        + kickoff.windowDurationMinutes * 60_000
        + kickoff.safetyBufferSeconds * 1000);
      this.dependencies.store.recordSuccess(kickoff.id, successfulAt.toISOString(), next.toISOString());
      if (kickoff.notificationChannelId) {
        try {
          await this.dependencies.notifications.send(kickoff.notificationChannelId, [
            'Model window started',
            `Profile: ${profile.label || profile.id}`,
            `Model: ${kickoff.provider}/${kickoff.modelId}`,
            `Next kickoff: ${next.toLocaleString()}`,
          ].join('\n'));
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
          await this.dependencies.notifications.send(kickoff.notificationChannelId, [
            'Model window kickoff failed',
            `Profile: ${kickoff.profileId}`,
            `Model: ${kickoff.provider}/${kickoff.modelId}`,
            `Error: ${failure}`,
            `Retry: ${retryAt.toLocaleString()}`,
          ].join('\n'));
        } catch (notificationError) {
          this.dependencies.log?.error(notificationError, 'Model window kickoff failure notification failed');
        }
      }
    } finally {
      this.running.delete(kickoff.id);
    }
  }
}

export async function probeModel(kickoff: ModelWindowKickoff, profile: AgentProfile, proxy: ProxyEnv): Promise<void> {
  await runWithAgentDirAndProxyEnv(profile.path, proxy, async () => {
    const runtime = await ModelRuntime.create({
      authPath: join(profile.path, 'auth.json'),
      modelsPath: join(profile.path, 'models.json'),
      allowModelNetwork: false,
    });
    const registry = new ModelRegistry(runtime);
    const model = registry.find(kickoff.provider, kickoff.modelId);
    if (!model) throw new Error(`Unknown model: ${kickoff.provider}/${kickoff.modelId}`);
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error || 'Model authentication failed');
    const response = await complete(model, {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: kickoff.prompt }],
        timestamp: Date.now(),
      }],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: 4,
      maxRetries: 0,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new Error(response.errorMessage || `Model probe ${response.stopReason}`);
    }
  });
}
