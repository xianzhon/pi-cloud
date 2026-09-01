const DEFAULT_MODEL = 'mlx-community/Kokoro-82M-bf16';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_FORMAT = 'wav';
const MAX_SYNTHESIS_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export const MAX_TTS_TEXT_LENGTH = 100_000;

export interface TextToSpeechOptions {
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

export interface SynthesizedSpeech {
  audio: Buffer;
  contentType: string;
}

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  pcm: 'audio/L16',
  wav: 'audio/wav',
};

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function providerError(response: Response): Promise<string> {
  const result = await response.json().catch(() => ({})) as { error?: { message?: unknown }; detail?: unknown };
  if (typeof result.error?.message === 'string') return result.error.message;
  if (typeof result.detail === 'string') return result.detail;
  return 'Speech synthesis failed.';
}

export function isTextToSpeechConfigured(): boolean {
  return Boolean(process.env.PI_CLOUD_TTS_BASE_URL?.trim());
}

export async function synthesizeSpeech(text: string, options: TextToSpeechOptions = {}): Promise<SynthesizedSpeech> {
  const baseUrl = process.env.PI_CLOUD_TTS_BASE_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Text-to-speech is not configured.');

  const model = process.env.PI_CLOUD_TTS_MODEL?.trim() || DEFAULT_MODEL;
  const voice = process.env.PI_CLOUD_TTS_VOICE?.trim() || DEFAULT_VOICE;
  const language = process.env.PI_CLOUD_TTS_LANGUAGE?.trim();
  const format = process.env.PI_CLOUD_TTS_FORMAT?.trim().toLowerCase() || DEFAULT_FORMAT;
  const apiKey = process.env.PI_CLOUD_TTS_API_KEY?.trim();
  const fetchImpl = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const body = {
    model,
    input: text,
    voice,
    response_format: format,
    ...(language ? { language } : {}),
  };

  for (let attempt = 1; attempt <= MAX_SYNTHESIS_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt === MAX_SYNTHESIS_ATTEMPTS) {
        throw new Error('Unable to reach the text-to-speech provider.', { cause: error });
      }
      await wait(retryDelayMs * attempt);
      continue;
    }

    if (!response.ok) {
      const message = await providerError(response);
      if (isRetryableStatus(response.status) && attempt < MAX_SYNTHESIS_ATTEMPTS) {
        await wait(retryDelayMs * attempt);
        continue;
      }
      throw new Error(message);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new Error('The text-to-speech provider returned an empty response.');
    return {
      audio,
      contentType: response.headers.get('content-type')?.split(';')[0] || FORMAT_CONTENT_TYPES[format] || 'application/octet-stream',
    };
  }

  throw new Error('Unable to reach the text-to-speech provider.');
}
