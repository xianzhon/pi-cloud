import { computed, ref } from 'vue';
import type { SlashCommandItem, SlashToken } from '../types/slashCommands';

const clientOnlyCommands: SlashCommandItem[] = [
  {
    id: 'copy',
    label: '/copy',
    insertText: '/copy ',
    description: 'Copy the last response messages to the system clipboard.',
    category: 'built-in',
    aliases: ['clipboard', 'copy response', 'last response'],
  },
  {
    id: 'summary',
    label: '/summary',
    insertText: '/summary ',
    description: 'Summarize the current session and copy the summary to the system clipboard.',
    category: 'built-in',
    aliases: ['summarize', 'notes', 'session summary', 'context summary'],
  },
  {
    id: 'changelog',
    label: '/changelog',
    insertText: '/changelog ',
    description: 'Show the changelog for recent Pi Cloud versions.',
    category: 'built-in',
    aliases: ['changes', 'release notes', 'version'],
  },
];

const fallbackCommands: SlashCommandItem[] = [
  ...clientOnlyCommands,
  {
    id: 'skill',
    label: '/skill',
    insertText: '/skill ',
    description: 'Invoke or ask about an available Pi skill.',
    category: 'built-in',
    aliases: ['skills', 'superpower'],
  },
  {
    id: 'diff',
    label: '/diff',
    insertText: '/diff ',
    description: 'Show current git working tree changes for this session.',
    category: 'built-in',
    aliases: ['changes', 'git diff'],
  },
  {
    id: 'status',
    label: '/status',
    insertText: '/status ',
    description: 'Show git status for this session.',
    category: 'built-in',
    aliases: ['git status', 'working tree'],
  },
  {
    id: 'commit',
    label: '/commit',
    insertText: '/commit ',
    description: 'Preview changed files and commit them after confirmation.',
    category: 'built-in',
    aliases: ['git commit', 'save changes'],
  },
  {
    id: 'amend',
    label: '/amend',
    insertText: '/amend ',
    description: 'Preview changed files and amend the previous commit after confirmation.',
    category: 'built-in',
    aliases: ['git amend', 'amend commit'],
  },
  {
    id: 'push',
    label: '/push',
    insertText: '/push ',
    description: 'Run git push for this session.',
    category: 'built-in',
    aliases: ['git push'],
  },
  {
    id: 'pull',
    label: '/pull',
    insertText: '/pull ',
    description: 'Run git pull for this session.',
    category: 'built-in',
    aliases: ['git pull'],
  },
  {
    id: 'branch',
    label: '/branch',
    insertText: '/branch ',
    description: 'Open git branch actions, or create a branch with a name and optional base branch.',
    category: 'built-in',
    aliases: ['git branch', 'checkout branch', 'new branch'],
  },
  {
    id: 'model',
    label: '/model',
    insertText: '/model ',
    description: 'Select the active model for this session.',
    category: 'built-in',
    aliases: ['models', 'change model', 'select model'],
  },
];

function isSlashCommandItem(value: unknown): value is SlashCommandItem {
  const item = value as Partial<SlashCommandItem>;
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      item.label.trim().length > 0 &&
      !item.label.includes(' ') &&
      typeof item.insertText === 'string' &&
      typeof item.description === 'string' &&
      (item.category === 'skill' || item.category === 'extension' || item.category === 'built-in'),
  );
}

export function findSlashToken(text: string, cursor: number): SlashToken | null {
  const beforeCursor = text.slice(0, cursor);
  const tokenStart = beforeCursor.search(/(^|\s)\/[^\s]*$/);
  if (tokenStart === -1) return null;

  const slashIndex = beforeCursor.indexOf('/', tokenStart);
  if (slashIndex < 0) return null;

  const query = beforeCursor.slice(slashIndex + 1);
  if (beforeCursor.slice(Math.max(0, slashIndex - 7), slashIndex).includes('http:')) return null;
  if (beforeCursor.slice(Math.max(0, slashIndex - 8), slashIndex).includes('https:')) return null;

  return { start: slashIndex, end: cursor, query };
}

export function replaceSlashToken(text: string, token: SlashToken, insertText: string) {
  const nextText = `${text.slice(0, token.start)}${insertText}${text.slice(token.end)}`;
  return { text: nextText, cursor: token.start + insertText.length };
}

function withClientOnlyCommands(commands: SlashCommandItem[]) {
  const existingIds = new Set(commands.map((command) => command.id));
  const existingLabels = new Set(commands.map((command) => command.label.toLowerCase()));
  const missingClientCommands = clientOnlyCommands.filter((command) => !existingIds.has(command.id) && !existingLabels.has(command.label.toLowerCase()));
  return [...commands, ...missingClientCommands];
}

function commandSearchText(command: SlashCommandItem) {
  const labelWithoutSkillPrefix = command.label.startsWith('skill:') ? command.label.slice('skill:'.length) : command.label;
  const slashPrefixedLabel = command.label.startsWith('/') ? command.label : `/${command.label}`;
  return [command.label, labelWithoutSkillPrefix, slashPrefixedLabel, command.insertText, command.description, command.category, ...(command.aliases || [])]
    .join(' ')
    .toLowerCase();
}

function commandMatches(command: SlashCommandItem, query: string) {
  const normalized = query.toLowerCase();
  if (!normalized) return true;
  return commandSearchText(command).includes(normalized);
}

function commandRank(command: SlashCommandItem, query: string) {
  const normalized = query.toLowerCase();
  if (!normalized) return 3;

  const label = command.label.toLowerCase();
  const slashLabel = label.startsWith('/') ? label : `/${label}`;
  const insertText = command.insertText.trim().toLowerCase();
  const aliases = (command.aliases || []).map((alias) => alias.toLowerCase());

  if (label === normalized || slashLabel === `/${normalized}` || slashLabel === normalized || insertText === normalized) return 0;
  if (label.startsWith(normalized) || slashLabel.startsWith(`/${normalized}`) || slashLabel.startsWith(normalized)) return 1;
  if (aliases.some((alias) => alias === normalized || alias.startsWith(normalized))) return 2;
  return 3;
}

export function useSlashCommands() {
  const commands = ref<SlashCommandItem[]>(fallbackCommands);
  const activeToken = ref<SlashToken | null>(null);
  const activeIndex = ref(0);
  const isLoading = ref(false);
  let loadRequestId = 0;

  const suggestions = computed(() => {
    if (!activeToken.value) return [];
    const query = activeToken.value?.query || '';
    return commands.value
      .filter((command) => commandMatches(command, query))
      .sort((a, b) => {
        const rankDiff = commandRank(a, query) - commandRank(b, query);
        if (rankDiff !== 0) return rankDiff;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 8);
  });

  const isOpen = computed(() => suggestions.value.length > 0 && activeToken.value !== null);

  async function loadCommands(sessionId?: string, clientId?: string) {
    const requestId = ++loadRequestId;
    isLoading.value = true;
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set('sessionId', sessionId);
      if (clientId) params.set('clientId', clientId);
      const query = params.toString();
      const response = await fetch(`/api/slash-commands${query ? `?${query}` : ''}`);
      if (!response.ok) throw new Error(`Failed to load slash commands: ${response.status}`);
      const data = await response.json();
      if (requestId !== loadRequestId) return;
      const validCommands = Array.isArray(data.commands) ? data.commands.filter(isSlashCommandItem) : [];
      commands.value = validCommands.length ? withClientOnlyCommands(validCommands) : fallbackCommands;
    } catch {
      if (requestId !== loadRequestId) return;
      commands.value = fallbackCommands;
    } finally {
      if (requestId === loadRequestId) {
        isLoading.value = false;
      }
    }
  }

  function updateQuery(text: string, cursor: number) {
    const token = findSlashToken(text, cursor);
    const previousToken = activeToken.value;
    const queryChanged = previousToken?.start !== token?.start
      || previousToken?.end !== token?.end
      || previousToken?.query !== token?.query;

    activeToken.value = token;

    if (queryChanged) {
      activeIndex.value = 0;
    }
  }

  function close() {
    activeToken.value = null;
    activeIndex.value = 0;
  }

  function move(delta: number) {
    if (!suggestions.value.length) return;
    activeIndex.value = (activeIndex.value + delta + suggestions.value.length) % suggestions.value.length;
  }

  function getActiveCommand() {
    return suggestions.value[activeIndex.value];
  }

  return {
    activeIndex,
    activeToken,
    commands,
    isLoading,
    isOpen,
    suggestions,
    close,
    getActiveCommand,
    loadCommands,
    move,
    updateQuery,
  };
}
