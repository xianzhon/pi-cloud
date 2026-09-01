import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechRoutes } from './speech';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('speechRoutes', () => {
  it('reports unavailable when no STT API key is configured', async () => {
    delete process.env.PI_CLOUD_STT_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const app = Fastify();
    await app.register(speechRoutes, { prefix: '/api/speech' });

    const status = await app.inject({ method: 'GET', url: '/api/speech/status' });
    const transcription = await app.inject({
      method: 'POST',
      url: '/api/speech/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from('audio'),
    });
    await app.close();

    expect(status.json()).toEqual({ available: false });
    expect(transcription.statusCode).toBe(503);
  });

  it('forwards audio and returns the provider transcript', async () => {
    process.env.PI_CLOUD_STT_API_KEY = 'test-key';
    process.env.PI_CLOUD_STT_BASE_URL = 'https://stt.example.test/v1/';
    process.env.PI_CLOUD_STT_MODEL = 'whisper-1';
    process.env.PI_CLOUD_STT_LANGUAGE = 'zh';
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => (
      new Response(JSON.stringify({ text: '你好，世界' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ));
    const app = Fastify();
    await app.register(speechRoutes, { prefix: '/api/speech', fetch: fetchMock as typeof fetch });

    const response = await app.inject({
      method: 'POST',
      url: '/api/speech/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from('audio'),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: '你好，世界' });
    expect(fetchMock).toHaveBeenCalledWith('https://stt.example.test/v1/audio/transcriptions', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer test-key' },
    }));
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('zh');
  });

  it('rejects empty audio', async () => {
    process.env.PI_CLOUD_STT_API_KEY = 'test-key';
    const app = Fastify();
    await app.register(speechRoutes, { prefix: '/api/speech' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/speech/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.alloc(0),
    });
    await app.close();

    expect(response.statusCode).toBe(400);
  });
});
