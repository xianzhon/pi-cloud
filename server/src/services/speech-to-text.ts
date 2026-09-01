const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface SpeechToTextOptions {
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

interface TranscriptionResponse {
  text?: unknown;
  error?: { message?: unknown };
}

function audioExtension(contentType: string): string {
  if (contentType.includes('amr')) return 'amr';
  if (contentType.includes('mp4')) return 'm4a';
  if (contentType.includes('mpeg')) return 'mp3';
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

export function isSpeechToTextConfigured(): boolean {
  return Boolean(process.env.PI_CLOUD_STT_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export async function transcribeAudio(audio: Buffer, contentType: string, options: SpeechToTextOptions = {}): Promise<string> {
  const apiKey = process.env.PI_CLOUD_STT_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('Speech-to-text is not configured.');

  const baseUrl = (process.env.PI_CLOUD_STT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.PI_CLOUD_STT_MODEL?.trim() || DEFAULT_MODEL;
  const language = process.env.PI_CLOUD_STT_LANGUAGE?.trim();
  const fetchImpl = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType }), `recording.${audioExtension(contentType)}`);
  form.append('model', model);
  if (language) form.append('language', language);

  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (error) {
      if (attempt === MAX_TRANSCRIPTION_ATTEMPTS) {
        throw new Error('Unable to reach the speech-to-text provider.', { cause: error });
      }
      await wait(retryDelayMs * attempt);
      continue;
    }

    const result = await response.json().catch(() => ({})) as TranscriptionResponse;
    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < MAX_TRANSCRIPTION_ATTEMPTS) {
        await wait(retryDelayMs * attempt);
        continue;
      }
      throw new Error(typeof result.error?.message === 'string' ? result.error.message : 'Transcription failed.');
    }
    if (typeof result.text !== 'string') throw new Error('The speech-to-text provider returned an invalid response.');
    return result.text;
  }
  throw new Error('Unable to reach the speech-to-text provider.');
}
