import Fastify, { type FastifyInstance } from 'fastify';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import type { AppServices } from '../app-services.js';
import { integrationRoutes } from './integration.js';

type Event = Parameters<Parameters<AgentSession['subscribe']>[0]>[0];
let app: FastifyInstance;
let service: ReturnType<typeof mockService>;
let listener: ((event: Event) => void) | undefined;
let streaming = false;
let lastText = 'previous answer';

function emit(event: unknown) { listener?.(event as Event); }
function answer(text: string, stopReason = 'stop') {
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason, errorMessage: stopReason === 'error' ? 'Provider unavailable' : undefined } });
  lastText = text;
}
function mockService() {
  const session = {
    sessionId: 'session-1', model: { provider: 'test', id: 'model' },
    get isStreaming() { return streaming; },
    subscribe: vi.fn((callback: (event: Event) => void) => { listener = callback; return () => { listener = undefined; }; }),
    prompt: vi.fn(async (prompt: string) => {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Answer: ' } });
      emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'yuque_update' });
      emit({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'yuque_update', isError: false });
      answer(`Answer: ${prompt}`);
    }),
    abort: vi.fn(async () => {}),
    getLastAssistantText: () => lastText,
  } as unknown as AgentSession;
  return {
    session,
    listAgentProfiles: vi.fn(async () => [{ id: 'default', label: 'Default' }, { id: 'notes', label: 'Notes' }]),
    setClientAgentProfile: vi.fn(async () => ({})),
    createSession: vi.fn(async () => ({ session, skillPolicy: {} })),
    getSession: vi.fn((): AgentSession | undefined => undefined),
    findPersistedSession: vi.fn(async () => ({ id: 'session-1', path: '/profile/sessions/session-1.jsonl', cwd: os.homedir() })),
    resumeSession: vi.fn(async () => session),
    scheduleCleanup: vi.fn(),
    runForegroundWithClientProfileProxy: vi.fn(async (_clientId: string, fn: () => Promise<void>) => fn()),
  };
}

beforeEach(async () => {
  streaming = false;
  lastText = 'previous answer';
  listener = undefined;
  service = mockService();
  app = Fastify();
  app.decorate('services', { sessions: service } as unknown as AppServices);
  await app.register(integrationRoutes, { prefix: '/api/integration' });
});
afterEach(async () => { await app.close(); });

describe('integration sessions', () => {
  it('creates a persistent profile session, asks, and returns JSON', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/integration/sessions', payload: { cwd: os.homedir(), agentProfileId: 'notes', prompt: 'Explain my note' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sessionId: 'session-1', agentProfileId: 'notes', answer: 'Answer: Explain my note', isStreaming: false });
    expect(service.createSession).toHaveBeenCalledWith(expect.stringMatching(/^integration:/), expect.objectContaining({ agentProfileId: 'notes', cwd: os.homedir() }));
    expect(service.setClientAgentProfile).toHaveBeenCalledWith(expect.stringMatching(/^integration:/), 'notes');
    expect(service.session.prompt).toHaveBeenCalledWith('Explain my note');
    expect(service.scheduleCleanup).toHaveBeenCalled();
    expect(listener).toBeUndefined();
  });

  it('restores a persisted session by ID in the selected profile for follow-ups', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: 'Update the note with yuque-mcp', agentProfileId: 'notes' } });
    expect(response.statusCode).toBe(200);
    expect(service.setClientAgentProfile).toHaveBeenCalledWith('integration:notes:session-1', 'notes');
    expect(service.resumeSession).toHaveBeenCalledWith('integration:notes:session-1', '/profile/sessions/session-1.jsonl');
    expect(response.json().answer).toBe('Answer: Update the note with yuque-mcp');
  });

  it('streams session metadata, text and tool progress, and an authoritative final answer', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/integration/sessions', payload: { prompt: 'Question', cwd: os.homedir(), stream: true } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['x-accel-buffering']).toBe('no');
    for (const event of ['session', 'text_delta', 'tool_start', 'tool_end', 'done']) expect(response.body).toContain(`event: ${event}\n`);
    expect(response.body).toContain('"answer":"Answer: Question"');
    expect(listener).toBeUndefined();
    expect(service.session.abort).not.toHaveBeenCalled();
  });

  it('reports model failures in JSON and SSE without returning stale answers', async () => {
    vi.mocked(service.session.prompt).mockImplementation(async () => { answer('', 'error'); });
    const response = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: 'Question' } });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ sessionId: 'session-1', error: 'Provider unavailable' });
    const streamed = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: 'Question', stream: true } });
    expect(streamed.body).toContain('event: error\n');
    expect(streamed.body).not.toContain('event: done');
    vi.mocked(service.session.prompt).mockImplementation(async () => {});
    const noAnswer = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: '/command' } });
    expect(noAnswer.json().answer).toBe('');
  });

  it('aborts the active run when a streaming HTTP client disconnects', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(service.session.prompt).mockImplementation(async () => { await pending; });
    vi.mocked(service.session.abort).mockImplementation(async () => { finish(); });
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${url}/api/integration/sessions/session-1/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'question', stream: true }), signal: controller.signal,
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: session');
    controller.abort();
    await vi.waitFor(() => { expect(service.session.abort).toHaveBeenCalledTimes(1); expect(listener).toBeUndefined(); });
    expect(service.scheduleCleanup).toHaveBeenCalled();
  });

  it('reuses an already-loaded session without creating or restoring a second conversation', async () => {
    service.getSession.mockReturnValue(service.session);
    for (const prompt of ['first question', 'follow-up note']) {
      const response = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt } });
      expect(response.json().answer).toBe(`Answer: ${prompt}`);
    }
    expect(service.resumeSession).not.toHaveBeenCalled();
    expect(service.createSession).not.toHaveBeenCalled();
    expect(service.session.prompt).toHaveBeenCalledTimes(2);
  });

  it('rejects simultaneous follow-ups instead of queueing them', async () => {
    let finish!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const begun = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(service.session.prompt).mockImplementation(async () => { started(); await waiting; answer('done'); });
    const first = app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: 'first' } });
    await begun;
    const second = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: 'second' } });
    expect(second.statusCode).toBe(409);
    finish();
    expect((await first).statusCode).toBe(200);
    expect(service.session.prompt).toHaveBeenCalledTimes(1);
  });

  it('rejects sessions already streaming in the WebUI', async () => {
    streaming = true;
    const response = await app.inject({ method: 'POST', url: '/api/integration/sessions/session-1/messages', payload: { prompt: 'question' } });
    expect(response.statusCode).toBe(409);
    expect(service.session.prompt).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown sessions and checks paths and profile selection', async () => {
    service.findPersistedSession.mockResolvedValueOnce(undefined as never);
    expect((await app.inject({ method: 'POST', url: '/api/integration/sessions/missing/messages', payload: { prompt: 'question' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/integration/sessions', payload: { cwd: '/', prompt: 'question' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/integration/sessions', payload: { agentProfileId: 'unknown', prompt: 'question' } })).statusCode).toBe(400);
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it('validates prompts and model options before running', async () => {
    for (const payload of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: 'q', modelId: 'alone' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/integration/sessions', payload });
      expect(response.statusCode).toBe(400);
    }
    expect(service.session.prompt).not.toHaveBeenCalled();
  });

  it('retrieves the last answer after reconnecting', async () => {
    const response = await app.inject('/api/integration/sessions/session-1?agentProfileId=notes');
    expect(response.json()).toMatchObject({ sessionId: 'session-1', agentProfileId: 'notes', answer: 'previous answer' });
  });
});
