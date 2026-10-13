import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PiSessionService } from '../services/session-manager.js';
import { resolveAllowedExistingPath } from '../utils/path-security.js';

interface QuestionBody {
  prompt?: string;
  stream?: boolean;
  agentProfileId?: string;
  cwd?: string;
  modelProvider?: string;
  modelId?: string;
}

const questionProperties = {
  prompt: { type: 'string', minLength: 1, maxLength: 200_000, pattern: '\\S' },
  stream: { type: 'boolean' },
  agentProfileId: { type: 'string', minLength: 1, maxLength: 80 },
};
const paramsSchema = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' } } };

function describeSession(session: AgentSession, agentProfileId: string) {
  return {
    sessionId: session.sessionId,
    agentProfileId,
    model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
    isStreaming: session.isStreaming,
  };
}

async function ask(
  sessions: PiSessionService, clientId: string, session: AgentSession, profileId: string,
  body: QuestionBody, reply: FastifyReply,
) {
  // Session discovery/creation may outlive the HTTP connection.
  if (reply.raw.destroyed) return reply;
  const metadata = describeSession(session, profileId);
  const controller = new AbortController();
  const output = body.stream ? new PassThrough() : null;
  let lastAssistant: Extract<AgentSession['messages'][number], { role: 'assistant' }> | undefined;
  const disconnect = () => {
    controller.abort();
    void session.abort().catch(() => {});
  };
  const sendEvent = (event: string, data: unknown) => {
    if (!output || output.destroyed || controller.signal.aborted) return;
    // A stalled consumer must not accumulate an unbounded transcript in memory.
    if (output.writableLength > 1024 * 1024) {
      disconnect();
      output.destroy();
      return;
    }
    output.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  reply.raw.on('close', disconnect);
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'message_end' && event.message.role === 'assistant') lastAssistant = event.message;
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      sendEvent('text_delta', { delta: event.assistantMessageEvent.delta });
    } else if (event.type === 'tool_execution_start') {
      sendEvent('tool_start', { toolCallId: event.toolCallId, toolName: event.toolName });
    } else if (event.type === 'tool_execution_end') {
      sendEvent('tool_end', { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
    }
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (output) {
    reply.type('text/event-stream').header('Cache-Control', 'no-store').header('X-Accel-Buffering', 'no').send(output);
    sendEvent('session', metadata);
    heartbeat = setInterval(() => sendEvent('ping', {}), 15_000);
    heartbeat.unref();
  }
  try {
    await sessions.runForegroundWithClientProfileProxy(clientId, async () => {
      controller.signal.throwIfAborted();
      // Recheck after asynchronous setup; the WebUI may have started a run meanwhile.
      if (session.isStreaming) throw Object.assign(new Error('Session is busy'), { statusCode: 409 });
      await session.prompt(body.prompt!);
    }, controller.signal);
    if (lastAssistant?.stopReason === 'error' || lastAssistant?.stopReason === 'aborted') {
      throw Object.assign(new Error(lastAssistant.errorMessage || 'Model response failed or was aborted'), { statusCode: 502 });
    }
    const answer = lastAssistant?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') || '';
    const result = { ...describeSession(session, profileId), answer };
    if (output) sendEvent('done', result);
    else if (!controller.signal.aborted) return reply.send(result);
  } catch (error) {
    if (!controller.signal.aborted) {
      const failure = { sessionId: session.sessionId, error: error instanceof Error ? error.message : 'Question failed' };
      const status = (error as { statusCode?: number }).statusCode || 502;
      if (output) sendEvent('error', { ...failure, statusCode: status });
      else return reply.status(status).send(failure);
    }
  } finally {
    unsubscribe();
    reply.raw.off('close', disconnect);
    if (heartbeat) clearInterval(heartbeat);
    output?.end();
  }
  return reply;
}

export async function integrationRoutes(app: FastifyInstance) {
  const sessions = app.services.sessions;
  const busy = new Set<string>();
  app.addHook('onRequest', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.get('/profiles', async () => ({
    profiles: (await sessions.listAgentProfiles()).map(profile => ({
      id: profile.id, label: profile.label, defaultProvider: profile.defaultProvider, defaultModel: profile.defaultModel,
    })),
  }));

  app.post('/sessions', {
    bodyLimit: 1024 * 1024,
    schema: { body: {
      type: 'object', additionalProperties: false, required: ['prompt'],
      properties: { ...questionProperties, cwd: { type: 'string', minLength: 1 }, modelProvider: { type: 'string', minLength: 1 }, modelId: { type: 'string', minLength: 1 } },
    } },
  }, async (req, reply) => {
    const body = req.body as QuestionBody;
    if (Boolean(body.modelProvider) !== Boolean(body.modelId)) return reply.status(400).send({ error: 'Provide both modelProvider and modelId' });
    const profileId = body.agentProfileId || 'default';
    if (!(await sessions.listAgentProfiles()).some(profile => profile.id === profileId)) return reply.status(400).send({ error: 'Unknown agent profile' });
    const cwd = await resolveAllowedExistingPath(body.cwd || process.cwd());
    if (!(await stat(cwd)).isDirectory()) return reply.status(400).send({ error: 'cwd must be a directory' });
    const clientId = `integration:${randomUUID()}`;
    try {
      await sessions.setClientAgentProfile(clientId, profileId);
      const { session } = await sessions.createSession(clientId, { cwd, agentProfileId: profileId, modelProvider: body.modelProvider, modelId: body.modelId });
      busy.add(session.sessionId);
      try { return await ask(sessions, clientId, session, profileId, body, reply); }
      finally { busy.delete(session.sessionId); }
    } finally {
      sessions.scheduleCleanup(clientId);
    }
  });

  async function existingSession(req: FastifyRequest, reply: FastifyReply, body: QuestionBody) {
    const { id } = req.params as { id: string };
    const profileId = body.agentProfileId || 'default';
    const clientId = `integration:${profileId}:${id}`;
    if (!(await sessions.listAgentProfiles()).some(profile => profile.id === profileId)) {
      reply.status(400).send({ error: 'Unknown agent profile' });
      return;
    }
    await sessions.setClientAgentProfile(clientId, profileId);
    // Resolve through the selected profile's session directory, never a caller-supplied file path.
    const persisted = await sessions.findPersistedSession(clientId, id);
    if (!persisted) {
      reply.status(404).send({ error: 'Session not found in selected agent profile' });
      return;
    }
    await resolveAllowedExistingPath(persisted.cwd || process.cwd());
    const session = sessions.getSession(clientId, id) || await sessions.resumeSession(clientId, persisted.path);
    return { session, clientId, profileId };
  }

  app.get('/sessions/:id', { schema: { params: paramsSchema, querystring: {
    type: 'object', additionalProperties: false, properties: { agentProfileId: questionProperties.agentProfileId },
  } } }, async (req, reply) => {
    const existing = await existingSession(req, reply, req.query as QuestionBody);
    if (!existing) return;
    try {
      return { ...describeSession(existing.session, existing.profileId), answer: existing.session.getLastAssistantText() || '' };
    } finally { sessions.scheduleCleanup(existing.clientId); }
  });

  app.post('/sessions/:id/messages', {
    bodyLimit: 1024 * 1024,
    schema: { params: paramsSchema, body: { type: 'object', additionalProperties: false, required: ['prompt'], properties: questionProperties } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (busy.has(id)) return reply.status(409).send({ error: 'Session is busy', sessionId: id });
    // Lock before profile discovery and disk reads to prevent two concurrent restores/runs.
    busy.add(id);
    let clientId: string | undefined;
    try {
      const existing = await existingSession(req, reply, req.body as QuestionBody);
      if (!existing) return;
      clientId = existing.clientId;
      if (existing.session.isStreaming) return reply.status(409).send({ error: 'Session is busy', sessionId: id });
      return await ask(sessions, clientId, existing.session, existing.profileId, req.body as QuestionBody, reply);
    } finally {
      busy.delete(id);
      if (clientId) sessions.scheduleCleanup(clientId);
    }
  });
}
