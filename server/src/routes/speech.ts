import type { FastifyInstance } from 'fastify';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

interface SpeechRouteOptions {
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

interface TranscriptionResponse {
  text?: unknown;
  error?: { message?: unknown };
}

function audioExtension(contentType: string): string {
  if (contentType.includes('mp4')) return 'm4a';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('wav')) return 'wav';
  return 'webm';
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function speechRoutes(app: FastifyInstance, options: SpeechRouteOptions = {}) {
  const apiKey = process.env.PI_CLOUD_STT_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const baseUrl = (process.env.PI_CLOUD_STT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.PI_CLOUD_STT_MODEL?.trim() || DEFAULT_MODEL;
  const language = process.env.PI_CLOUD_STT_LANGUAGE?.trim();
  const fetchImpl = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;

  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.get('/status', async () => ({ available: Boolean(apiKey) }));

  app.post('/transcribe', async (req, reply) => {
    if (!apiKey) {
      return reply.status(503).send({ error: 'Speech-to-text is not configured.' });
    }

    const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() || '';
    if (!contentType.startsWith('audio/') || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.status(400).send({ error: 'A non-empty audio request body is required.' });
    }

    const form = new FormData();
    form.append('file', new Blob([req.body], { type: contentType }), `recording.${audioExtension(contentType)}`);
    form.append('model', model);
    if (language) form.append('language', language);

    for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        const result = await response.json().catch(() => ({})) as TranscriptionResponse;
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < MAX_TRANSCRIPTION_ATTEMPTS) {
            await wait(retryDelayMs * attempt);
            continue;
          }
          const message = typeof result.error?.message === 'string' ? result.error.message : 'Transcription failed.';
          return reply.status(502).send({ error: message });
        }
        if (typeof result.text !== 'string') {
          return reply.status(502).send({ error: 'The speech-to-text provider returned an invalid response.' });
        }
        return { text: result.text };
      } catch (error) {
        if (attempt < MAX_TRANSCRIPTION_ATTEMPTS) {
          await wait(retryDelayMs * attempt);
          continue;
        }
        req.log.error({ err: error }, 'Speech-to-text request failed');
        return reply.status(502).send({ error: 'Unable to reach the speech-to-text provider.' });
      }
    }
  });
}
