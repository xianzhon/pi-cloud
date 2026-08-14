// server/src/ws/chat.ts
import type { FastifyInstance } from 'fastify';
import { isAllowedRequestOrigin } from '../auth/origin.js';
import { getRequestContext, getSessionFromRequest } from '../auth/request.js';
import { validateImages, type ImageValidationResult } from '../services/image-input.js';
import { sessionService } from '../services/session-manager.js';
import { saveUploadedImages } from '../services/uploaded-image-store.js';
import { sendJson } from './safe-send.js';

const ABORT_GRACE_MS = 5_000;

interface WSMessage {
  type: 'prompt' | 'steer' | 'followUp' | 'abort';
  payload?: {
    text?: string;
    sessionId?: string;
    requestId?: string;
    images?: unknown;
  };
}

function websocketErrorMessage(error: unknown): string {
  if (error instanceof SyntaxError) return 'Invalid message format';
  if (error instanceof Error) return error.message;
  return 'Unknown websocket error';
}

function parseCompactCommand(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '/compact') return '';
  if (trimmed.startsWith('/compact ')) return trimmed.slice('/compact '.length).trim();
  return null;
}

interface PreparedImagePrompt {
  text: string;
  paths: string[];
}

async function promptWithUploadedImagePaths(
  text: string,
  session: { sessionManager: { getCwd(): string } },
  imageResult: Extract<ImageValidationResult, { ok: true }>,
): Promise<PreparedImagePrompt> {
  if (!imageResult.images.length) return { text, paths: [] };

  const paths = await saveUploadedImages(session.sessionManager.getCwd(), imageResult.images, imageResult.names);
  const fileNote = [
    '[Uploaded image files]',
    ...paths.map((filePath) => `- ${filePath}`),
    'These are local files in the project. Use these paths if the user asks you to inspect, edit, or annotate an uploaded image.',
  ].join('\n');
  return { text: text.trim() ? `${text}\n\n${fileNote}` : fileNote, paths };
}

async function abortSessionBestEffort(session: { sessionId: string; abortCompaction(): void; abort(): Promise<void> }): Promise<boolean> {
  session.abortCompaction();
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      session.abort().then(() => 'aborted' as const, () => 'failed' as const),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ABORT_GRACE_MS); }),
    ]);
    return result === 'aborted';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatCompactResult(result: any, status: ReturnType<typeof sessionService.getRuntimeStatus>): string {
  const lines = [
    '## Session compacted',
    '',
    `- Tokens summarized: ${Number(result?.tokensBefore || 0).toLocaleString()}`,
    `- First kept entry: ${result?.firstKeptEntryId || 'unknown'}`,
  ];

  const contextUsage = status.contextUsage;
  if (contextUsage?.contextWindow) {
    const tokens = contextUsage.tokens == null ? 'recalculating' : contextUsage.tokens.toLocaleString();
    const percent = contextUsage.percent == null ? undefined : `${contextUsage.percent.toFixed(1)}%`;
    lines.push(`- Context after compact: ${tokens}/${contextUsage.contextWindow.toLocaleString()}${percent ? ` (${percent})` : ''}`);
  }

  const details = result?.details;
  if (details && typeof details === 'object') {
    const readFiles = Array.isArray(details.readFiles) ? details.readFiles.length : undefined;
    const modifiedFiles = Array.isArray(details.modifiedFiles) ? details.modifiedFiles.length : undefined;
    if (readFiles != null || modifiedFiles != null) {
      lines.push(`- Files tracked: ${readFiles ?? 0} read, ${modifiedFiles ?? 0} modified`);
    }
  }

  if (typeof result?.summary === 'string' && result.summary.trim()) {
    lines.push('', '<details><summary>Summary</summary>', '', result.summary.trim(), '', '</details>');
  }

  return lines.join('\n');
}

export async function chatWebSocket(app: FastifyInstance) {
  app.get('/ws/chat', { websocket: true }, (socket, req) => {
    const auth = app.authServices;
    if (!isAllowedRequestOrigin(req)) {
      const context = getRequestContext(req, auth.authConfig.trustProxy);
      auth.audit.record({ type: 'websocket_origin_rejected', status: 'failure', ...context, metadata: { path: '/ws/chat', origin: req.headers.origin } });
      sendJson(socket, { type: 'error', message: 'Origin not allowed' });
      socket.close();
      return;
    }

    const session = getSessionFromRequest(req, auth.authConfig, auth.sessions);
    if (!session) {
      const context = getRequestContext(req, auth.authConfig.trustProxy);
      auth.audit.record({ type: 'websocket_auth_failure', status: 'failure', ...context, metadata: { path: '/ws/chat' } });
      sendJson(socket, { type: 'error', message: 'Authentication required' });
      socket.close();
      return;
    }

    const clientId = (req.query as { clientId?: string }).clientId;
    
    if (!clientId) {
      sendJson(socket, {
        type: 'error',
        message: 'clientId query parameter required',
      });
      socket.close();
      return;
    }

    const safeClientId = clientId;
    console.log(`Client connected: ${safeClientId}`);

    function sendPromptPreflight(
      sessionId: string,
      requestId: string | undefined,
      accepted: boolean,
      error?: { code: string; message: string },
      imagePaths?: string[],
    ): void {
      sendJson(socket, {
        type: 'prompt_preflight',
        sessionId,
        requestId,
        accepted,
        ...error,
        ...(imagePaths?.length ? { imagePaths } : {}),
      });
    }
    const unsubscribeMemoryUpdates = app.memoryRuntime.onUpdated(async (event) => {
      try {
        const profile = await sessionService.getClientAgentProfile(safeClientId);
        if (profile.id !== event.profileId) return;
        sendJson(socket, {
          type: 'memory_updated',
          profileId: event.profileId,
          projectId: event.projectId,
          extractionRunId: event.extractionRunId,
          activeProjectCount: event.activeProjectCount,
          pendingGlobalCount: event.pendingGlobalCount,
          failed: event.failed,
        });
      } catch (error) {
        console.warn('[memory] failed to broadcast update:', error instanceof Error ? error.message : error);
      }
    });
    const unsubscribeMemoryRecall = app.memoryRuntime.onRecall(async (event) => {
      try {
        const profile = await sessionService.getClientAgentProfile(safeClientId);
        if (profile.id !== event.profileId) return;
        sendJson(socket, {
          type: 'memory_recall',
          profileId: event.profileId,
          projectId: event.projectId,
          sessionId: event.sessionId,
          injected: event.injected,
          tokenCount: event.tokenCount,
          memories: event.memories,
          ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}),
          createdAt: event.createdAt,
        });
      } catch (error) {
        console.warn('[memory] failed to broadcast recall:', error instanceof Error ? error.message : error);
      }
    });

    async function ensureTargetSession(targetSessionId?: string) {
      if (!targetSessionId) {
        return sessionService.getSession(safeClientId);
      }

      const currentSession = sessionService.getSession(safeClientId, targetSessionId);
      if (currentSession?.sessionId === targetSessionId) {
        return currentSession;
      }

      const sessions = await sessionService.listSessions(safeClientId);
      const sessionInfo = sessions.find((session) => session.id === targetSessionId);
      if (!sessionInfo) {
        throw new Error('Session not found');
      }

      return sessionService.resumeSession(safeClientId, sessionInfo.path);
    }

    socket.on('message', async (rawData: Buffer) => {
      try {
        const message: WSMessage = JSON.parse(rawData.toString());
        
        switch (message.type) {
          case 'prompt': {
            const session = await ensureTargetSession(message.payload?.sessionId);
            if (!session) {
              sendJson(socket, {
                type: 'error',
                message: 'No active session. Create one first.',
              });
              return;
            }

            const imageResult = validateImages(message.payload?.images, session.model);
            if (!imageResult.ok) {
              sendPromptPreflight(session.sessionId, message.payload?.requestId, false, imageResult);
              return;
            }

            sessionService.cancelCleanup(safeClientId);
            const sessionId = session.sessionId;
            const compactInstructions = parseCompactCommand(message.payload?.text || '');
            req.log?.info({
              clientId: safeClientId,
              sessionId,
              operation: compactInstructions !== null ? 'compact' : 'prompt',
              provider: session.model?.provider,
              modelId: session.model?.id,
            }, '[ai-chat] request');

            // Loop detection: track consecutive identical tool calls
            const toolCallHistory: Array<{ name: string; input: string }> = [];
            const MAX_REPEATED_TOOL_CALLS = 3;
            let loopDetected = false;

            const unsubscribe = session.subscribe((event) => {
              // Detect repeated identical tool calls
              if (!loopDetected && event.type === 'tool_execution_start') {
                const name = event.toolName;
                const input = event.args != null ? JSON.stringify(event.args) : '';
                toolCallHistory.push({ name, input });

                // Trim history to avoid unbounded growth
                if (toolCallHistory.length > MAX_REPEATED_TOOL_CALLS * 3) {
                  toolCallHistory.splice(0, toolCallHistory.length - MAX_REPEATED_TOOL_CALLS);
                }

                // Check last N calls for identical repetition
                if (toolCallHistory.length >= MAX_REPEATED_TOOL_CALLS) {
                  const recent = toolCallHistory.slice(-MAX_REPEATED_TOOL_CALLS);
                  if (recent.every((t) => t.name === recent[0].name && t.input === recent[0].input)) {
                    loopDetected = true;
                    console.warn(`[loop-detected] tool="${name}" sessionId=${sessionId}`);
                    sendJson(socket, {
                      type: 'loop_detected',
                      sessionId,
                      message: `Loop detected: tool "${name}" called ${MAX_REPEATED_TOOL_CALLS} times with identical input. Stopping automatically.`,
                      toolName: name,
                    });
                    abortSessionBestEffort(session).then((aborted) => {
                      if (!aborted) sessionService.forceDisposeBySessionId(sessionId);
                    }).catch((err: unknown) => {
                      console.error('Failed to abort after loop detection:', err);
                    });
                    return;
                  }
                }
              }

              sendJson(socket, {
                type: 'event',
                sessionId,
                event,
              });
            });

            try {
              await sessionService.runForegroundWithClientProfileProxy(safeClientId, async () => {
                if (compactInstructions !== null) {
                  const result = await session.compact(compactInstructions || undefined);
                  sendJson(socket, {
                    type: 'compact_result',
                    sessionId,
                    message: formatCompactResult(result, sessionService.getRuntimeStatus(session)),
                    result,
                  });
                } else {
                  const requestId = message.payload?.requestId;
                  const preparedPrompt = await promptWithUploadedImagePaths(
                    message.payload?.text || '',
                    session,
                    imageResult,
                  );
                  await session.prompt(preparedPrompt.text, {
                    ...(imageResult.images.length ? { images: imageResult.images } : {}),
                    preflightResult: requestId
                      ? (accepted) => sendPromptPreflight(sessionId, requestId, accepted, undefined, preparedPrompt.paths)
                      : undefined,
                  });
                }
              });
            } catch (error) {
              sendJson(socket, {
                type: 'error',
                sessionId,
                message: error instanceof Error ? error.message : 'Unknown error',
              });
            } finally {
              unsubscribe();
              if (!loopDetected) {
                sendJson(socket, { type: 'status', sessionId, status: 'idle' });
              }
            }
            break;
          }

          case 'steer':
          case 'followUp': {
            const session = await ensureTargetSession(message.payload?.sessionId);
            if (!session) break;
            const imageResult = validateImages(message.payload?.images, session.model);
            if (!imageResult.ok) {
              sendPromptPreflight(session.sessionId, message.payload?.requestId, false, imageResult);
              break;
            }
            if (!message.payload?.text && imageResult.images.length === 0) break;

            const requestId = message.payload?.requestId;
            const streamingBehavior = message.type === 'steer' ? 'steer' : 'followUp';
            req.log?.info({
              clientId: safeClientId,
              sessionId: session.sessionId,
              operation: streamingBehavior,
              provider: session.model?.provider,
              modelId: session.model?.id,
            }, '[ai-chat] request');
            await sessionService.runForegroundWithClientProfileProxy(safeClientId, async () => {
              const preparedPrompt = await promptWithUploadedImagePaths(
                message.payload?.text || '',
                session,
                imageResult,
              );
              await session.prompt(preparedPrompt.text, {
                streamingBehavior,
                ...(imageResult.images.length ? { images: imageResult.images } : {}),
                preflightResult: requestId
                  ? (accepted) => sendPromptPreflight(session.sessionId, requestId, accepted, undefined, preparedPrompt.paths)
                  : undefined,
              });
            });
            break;
          }

          case 'abort': {
            const session = await ensureTargetSession(message.payload?.sessionId);
            if (session) {
              const aborted = await abortSessionBestEffort(session);
              if (!aborted) {
                sessionService.forceDisposeBySessionId(session.sessionId);
                sendJson(socket, {
                  type: 'error',
                  sessionId: session.sessionId,
                  message: 'Request did not stop cleanly; the stuck runtime was discarded.',
                });
              }
              sendJson(socket, { type: 'status', sessionId: session.sessionId, status: 'idle' });
            }
            break;
          }
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        sendJson(socket, {
          type: 'error',
          message: websocketErrorMessage(error),
        });
      }
    });

    socket.on('close', () => {
      console.log(`Client disconnected: ${safeClientId}`);
      unsubscribeMemoryUpdates();
      unsubscribeMemoryRecall();
      const activeSession = sessionService.getSession(safeClientId);
      if (activeSession?.isStreaming) {
        abortSessionBestEffort(activeSession).then((aborted) => {
          if (!aborted) sessionService.forceDisposeBySessionId(activeSession.sessionId);
        }).catch((error) => {
          console.warn('Failed to stop streaming session on disconnect:', error);
        });
      }
      sessionService.scheduleCleanup(safeClientId);
    });
  });
}
