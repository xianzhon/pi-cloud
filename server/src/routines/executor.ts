import { stat } from 'node:fs/promises';
import type { PiSessionService } from '../services/session-manager.js';
import { resolveAllowedExistingPath } from '../utils/path-security.js';
import type { RoutineStore } from './store.js';
import type { Run } from './types.js';
export async function validateProject(path: string): Promise<string> {
  const resolved = await resolveAllowedExistingPath(path);
  if (!(await stat(resolved)).isDirectory())
    throw new Error('Project must be a directory');
  return resolved;
}
export function createRoutineExecutor(
  sessions: PiSessionService,
  store: RoutineStore,
  resolveProject = validateProject,
) {
  return async (run: Run, signal: AbortSignal): Promise<string> => {
    const r = run.snapshot;
    const cwd = await resolveProject(r.projectPath);
    const models = await sessions.listAgentProfileModels(r.profileId);
    if (!models.some((m) => m.provider === r.provider && m.id === r.modelId))
      throw new Error('Routine model is unavailable');
    signal.throwIfAborted();
    const clientId = `routine-run:${run.id}`;
    try {
      await sessions.setClientAgentProfile(clientId, r.profileId);
      const { session } = await sessions.createSession(clientId, {
        cwd,
        agentProfileId: r.profileId,
        modelProvider: r.provider,
        modelId: r.modelId,
      });
      store.attachSession(
        run.id,
        session.sessionId,
        session.sessionManager.getSessionFile() || null,
      );
      const abort = () => {
        void session.abort().catch(() => undefined);
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        await sessions.runForegroundWithClientProfileProxy(clientId, () => {
          signal.throwIfAborted();
          return session.prompt(r.prompt);
        });
      } finally {
        signal.removeEventListener('abort', abort);
      }
      const message = [...session.messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      if (!message || message.role !== 'assistant')
        throw new Error('Agent finished without a response');
      if (message.stopReason === 'error' || message.stopReason === 'aborted')
        throw new Error(message.errorMessage || message.stopReason);
      return message.content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('');
    } finally {
      sessions.releaseClient(clientId);
    }
  };
}
