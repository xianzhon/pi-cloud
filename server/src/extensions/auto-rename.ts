import type { Api, Model, TextContent } from '@earendil-works/pi-ai';
import { complete } from '@earendil-works/pi-ai/compat';
import type {
  ExtensionAPI,
  ExtensionContext,
  InlineExtension,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';
import type { Message } from '@earendil-works/pi-ai';

const ENGLISH_WORD_CAP = 10;
const CHINESE_CHAR_CAP = 16;
const RENAME_TIMEOUT_MS = 30_000;

type RenameLanguage = 'english' | 'chinese';
type NamingSource = 'first' | 'full';

interface ModelRef {
  provider: string;
  id: string;
}

interface RenameConfig {
  model: ModelRef;
  language: RenameLanguage;
}

function getSystemPrompt(language: RenameLanguage): string {
  if (language === 'chinese') {
    return 'You create short, descriptive session names for chat sessions with AI. Use a natural verb-led Chinese phrase, 4-16 Chinese characters. Respond with only the name, no quotes or punctuation.';
  }
  return 'You create short, descriptive session names for chat sessions with AI. Use a verb-led English phrase in sentence case: capitalize only the first word. Use 4-10 words when possible. Respond with only the name, no quotes or punctuation.';
}

function getNamingInstruction(language: RenameLanguage, source: NamingSource): string {
  const basis = source === 'first' ? 'the first user message' : 'the full conversation history';
  if (language === 'chinese') {
    return `Name this session based on ${basis}. Use a natural verb-led Chinese phrase, 4-16 Chinese characters.`;
  }
  return `Name this session based on ${basis}. Use a verb-led English phrase in sentence case, 4-10 words when possible.`;
}

function isLlmMessage(entry: SessionEntry): entry is SessionMessageEntry & { message: Message } {
  if (entry.type !== 'message') return false;
  const role = (entry as SessionMessageEntry).message.role;
  return role === 'user' || role === 'assistant' || role === 'toolResult';
}

function extractText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push((block as TextContent).text);
  }
  return parts.join('\n');
}

function getFirstUserMessageText(entries: SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || !isLlmMessage(entry)) continue;
    if (entry.message.role !== 'user') continue;
    const text = extractText(entry.message.content).trim();
    if (text) return text;
  }
  return null;
}

function sanitizeSessionName(raw: string, language: RenameLanguage): string {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';

  let name = firstLine
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?:;,。！？：；，、]+$/, '');

  if (language === 'english') {
    name = name.split(' ').filter(Boolean).slice(0, ENGLISH_WORD_CAP).join(' ').toLowerCase();
    if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
  } else {
    name = name.replace(/\s+/g, '');
    if (name.length > CHINESE_CHAR_CAP) name = name.slice(0, CHINESE_CHAR_CAP);
  }

  return name;
}

async function resolveAuth(
  ctx: ExtensionContext,
  ref: ModelRef,
): Promise<{ model: Model<Api>; apiKey?: string; headers?: Record<string, string> } | null> {
  const model = ctx.modelRegistry.find(ref.provider, ref.id);
  if (!model) return null;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) return null;
  const headers = auth.headers as Record<string, string> | undefined;
  const authorization = headers?.Authorization ?? headers?.authorization;
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerApiKey = headers?.['X-Api-Key'] ?? headers?.['x-api-key'];
  return { model, apiKey: auth.apiKey ?? bearerToken ?? headerApiKey, headers };
}

async function generateName(
  ctx: ExtensionContext,
  config: RenameConfig,
  content: string,
): Promise<string | null> {
  const resolved = await resolveAuth(ctx, config.model);
  if (!resolved) return null;

  const prompt = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: `${getNamingInstruction(config.language, 'first')}\n\n${content}` }] satisfies TextContent[],
    timestamp: Date.now(),
  };
  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(
      resolved.model,
      { systemPrompt: getSystemPrompt(config.language), messages: [prompt] },
      {
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        maxTokens: 128,
        maxRetries: 0,
        signal: AbortSignal.timeout(RENAME_TIMEOUT_MS),
      },
    );
  } catch {
    return null;
  }
  if (response.stopReason === 'error' || response.stopReason === 'aborted') return null;

  const raw = (response.content as TextContent[])
    .filter((block: TextContent) => block.type === 'text')
    .map((block: TextContent) => block.text)
    .join('\n');

  return sanitizeSessionName(raw, config.language) || null;
}

export function createWebuiAutoRenameExtension(config: RenameConfig): InlineExtension {
  return {
    name: 'pi-webui-auto-rename',
    factory: (pi: ExtensionAPI) => {
      let namingAttempted = false;
      let namingInProgress = false;

      const resetNaming = () => {
        namingAttempted = false;
        namingInProgress = false;
      };

      const autoName = async (ctx: ExtensionContext): Promise<void> => {
        if (namingAttempted || namingInProgress || pi.getSessionName()) return;

        const firstMsg = getFirstUserMessageText(ctx.sessionManager.getBranch());
        if (!firstMsg) return;

        namingAttempted = true;
        namingInProgress = true;
        try {
          const name = await generateName(ctx, config, `First user message:\n${firstMsg}`);
          if (name && !pi.getSessionName()) pi.setSessionName(name);
        } finally {
          namingInProgress = false;
        }
      };

      const onSessionEvent = (): void => {
        resetNaming();
      };

      pi.on('session_start', async (event, ctx) => {
        onSessionEvent();
        await autoName(ctx);
      });
      pi.on('session_tree', onSessionEvent);
      pi.on('message_end', async (_event, ctx) => autoName(ctx));
      pi.on('agent_end', async (_event, ctx) => autoName(ctx));
    },
  };
}
