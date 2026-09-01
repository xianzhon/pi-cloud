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

    expect(status.json()).toEqual({ available: false, ttsAvailable: false });
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

  it('retries a transient provider failure', async () => {
    process.env.PI_CLOUD_STT_API_KEY = 'test-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Busy' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Ready' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    const app = Fastify();
    await app.register(speechRoutes, {
      prefix: '/api/speech',
      fetch: fetchMock as typeof fetch,
      retryDelayMs: 0,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/speech/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from('audio'),
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: 'Ready' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent provider failure', async () => {
    process.env.PI_CLOUD_STT_API_KEY = 'test-key';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid audio' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }));
    const app = Fastify();
    await app.register(speechRoutes, {
      prefix: '/api/speech',
      fetch: fetchMock as typeof fetch,
      retryDelayMs: 0,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/speech/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from('audio'),
    });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Invalid audio' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('synthesizes speech through a local provider without an API key', async () => {
    process.env.PI_CLOUD_TTS_BASE_URL = 'http://127.0.0.1:8000/v1/';
    process.env.PI_CLOUD_TTS_MODEL = 'mlx-community/Kokoro-82M-bf16';
    process.env.PI_CLOUD_TTS_VOICE = 'zf_xiaobei';
    process.env.PI_CLOUD_TTS_LANGUAGE = 'zh';
    process.env.PI_CLOUD_TTS_FORMAT = 'wav';
    delete process.env.PI_CLOUD_TTS_API_KEY;
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), {
      status: 200,
      headers: { 'content-type': 'audio/wav' },
    }));
    const app = Fastify();
    await app.register(speechRoutes, { prefix: '/api/speech', fetch: fetchMock as typeof fetch });

    const status = await app.inject({ method: 'GET', url: '/api/speech/status' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/speech/synthesize',
      payload: { text: '你好，世界' },
    });
    await app.close();

    expect(status.json()).toMatchObject({ ttsAvailable: true });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('audio/wav');
    expect(response.rawPayload).toEqual(Buffer.from([82, 73, 70, 70]));
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8000/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mlx-community/Kokoro-82M-bf16',
        input: '你好，世界',
        voice: 'zf_xiaobei',
        response_format: 'wav',
        language: 'zh',
      }),
    });
  });

  it('rejects synthesis when TTS is unavailable or text is empty', async () => {
    delete process.env.PI_CLOUD_TTS_BASE_URL;
    const app = Fastify();
    await app.register(speechRoutes, { prefix: '/api/speech' });

    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/speech/synthesize',
      payload: { text: 'Hello' },
    });
    process.env.PI_CLOUD_TTS_BASE_URL = 'http://127.0.0.1:8000/v1';
    const empty = await app.inject({
      method: 'POST',
      url: '/api/speech/synthesize',
      payload: { text: '  ' },
    });
    await app.close();

    expect(unavailable.statusCode).toBe(503);
    expect(empty.statusCode).toBe(400);
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
