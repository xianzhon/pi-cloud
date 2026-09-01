import type { FastifyInstance } from 'fastify';
import {
  isSpeechToTextConfigured,
  MAX_AUDIO_BYTES,
  transcribeAudio,
  type SpeechToTextOptions,
} from '../services/speech-to-text.js';
import {
  isTextToSpeechConfigured,
  MAX_TTS_TEXT_LENGTH,
  synthesizeSpeech,
  type TextToSpeechOptions,
} from '../services/text-to-speech.js';

type SpeechRouteOptions = SpeechToTextOptions & TextToSpeechOptions;

export async function speechRoutes(app: FastifyInstance, options: SpeechRouteOptions = {}) {
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.get('/status', async () => ({
    available: isSpeechToTextConfigured(),
    ttsAvailable: isTextToSpeechConfigured(),
  }));

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

  app.post('/synthesize', async (req, reply) => {
    if (!isTextToSpeechConfigured()) {
      return reply.status(503).send({ error: 'Text-to-speech is not configured.' });
    }

    const text = (req.body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || !text.trim()) {
      return reply.status(400).send({ error: 'Non-empty text is required.' });
    }
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return reply.status(413).send({ error: `Text must not exceed ${MAX_TTS_TEXT_LENGTH} characters.` });
    }

    try {
      const result = await synthesizeSpeech(text, options);
      return reply.type(result.contentType).send(result.audio);
    } catch (error) {
      req.log.error({ err: error }, 'Text-to-speech request failed');
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Speech synthesis failed.' });
    }
  });
}
