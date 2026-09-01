import type { FastifyInstance } from 'fastify';
import {
  isSpeechToTextConfigured,
  MAX_AUDIO_BYTES,
  transcribeAudio,
  type SpeechToTextOptions,
} from '../services/speech-to-text.js';

type SpeechRouteOptions = SpeechToTextOptions;

export async function speechRoutes(app: FastifyInstance, options: SpeechRouteOptions = {}) {
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.get('/status', async () => ({ available: isSpeechToTextConfigured() }));

  app.post('/transcribe', async (req, reply) => {
    if (!isSpeechToTextConfigured()) {
      return reply.status(503).send({ error: 'Speech-to-text is not configured.' });
    }

    const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() || '';
    if (!contentType.startsWith('audio/') || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.status(400).send({ error: 'A non-empty audio request body is required.' });
    }

    try {
      return { text: await transcribeAudio(req.body, contentType, options) };
    } catch (error) {
      req.log.error({ err: error }, 'Speech-to-text request failed');
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Transcription failed.' });
    }
  });
}
