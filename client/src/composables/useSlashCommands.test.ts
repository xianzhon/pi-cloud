import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { findSlashToken, replaceSlashToken, useSlashCommands } from './useSlashCommands';

const remoteCommands = [
  {
    id: 'skill-frontend-design',
    label: 'skill:frontend-design',
    insertText: '/skill:frontend-design ',
    description: 'Use frontend design skill',
    category: 'skill',
    aliases: ['frontend-design', 'frontend', 'design', 'ui'],
  },
  {
    id: 'prompt-help',
    label: 'help',
    insertText: '/help ',
    description: 'Show help',
    category: 'built-in',
    aliases: ['help', 'commands'],
  },
];

describe('slash command helpers', () => {
  it('detects the active slash token at the cursor', () => {
    expect(findSlashToken('/ski', 4)).toEqual({ start: 0, end: 4, query: 'ski' });
    expect(findSlashToken('please /ext', 11)).toEqual({ start: 7, end: 11, query: 'ext' });
    expect(findSlashToken('hello world', 5)).toBeNull();
    expect(findSlashToken('http://example.test', 7)).toBeNull();
  });

  it('replaces only the active slash token', () => {
    expect(replaceSlashToken('please /front now', { start: 7, end: 13, query: 'front' }, '/skill:frontend-design ')).toEqual({
      text: 'please /skill:frontend-design  now',
      cursor: 30,
    });
  });
});

describe('useSlashCommands', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads slash commands and filters by shorthand label, description, and aliases', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commands: remoteCommands }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const slash = useSlashCommands();
    await slash.loadCommands('session-1', 'client-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/slash-commands?sessionId=session-1&clientId=client-1');

    slash.updateQuery('/frontend', 9);
    await nextTick();

    expect(slash.suggestions.value.map((command) => command.id)).toEqual(['skill-frontend-design']);
    expect(slash.suggestions.value[0].label).toBe('skill:frontend-design');

    slash.updateQuery('/skill:front', 12);
    await nextTick();

    expect(slash.suggestions.value.map((command) => command.id)).toEqual(['skill-frontend-design']);

    slash.updateQuery('/help', 5);
    await nextTick();

    expect(slash.suggestions.value.map((command) => command.id)).toEqual(['prompt-help']);
    expect(slash.suggestions.value[0].insertText).toBe('/help ');
  });

  it('preserves the active selection when the query text has not changed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commands: remoteCommands }),
    }));

    const slash = useSlashCommands();
    await slash.loadCommands();
    slash.updateQuery('/s', 2);
    await nextTick();

    slash.move(1);
    expect(slash.activeIndex.value).toBe(1);

    slash.updateQuery('/s', 2);
    await nextTick();

    expect(slash.activeIndex.value).toBe(1);
  });

  it('keeps the latest session-aware commands when an earlier global request resolves later', async () => {
    let resolveGlobal: ((value: { ok: boolean; json: () => Promise<{ commands: typeof remoteCommands }> }) => void) | undefined;
    let resolveSession: ((value: { ok: boolean; json: () => Promise<{ commands: typeof remoteCommands }> }) => void) | undefined;

    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/slash-commands?clientId=client-1') {
        return new Promise((resolve) => {
          resolveGlobal = resolve;
        });
      }
      if (url === '/api/slash-commands?sessionId=session-1&clientId=client-1') {
        return new Promise((resolve) => {
          resolveSession = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }));

    const slash = useSlashCommands();
    const globalLoad = slash.loadCommands(undefined, 'client-1');
    const sessionLoad = slash.loadCommands('session-1', 'client-1');

    resolveSession?.({
      ok: true,
      json: async () => ({
        commands: [
          remoteCommands[0],
          {
            id: 'help',
            label: '/help',
            insertText: '/help ',
            description: 'Ask for help',
            category: 'built-in',
            aliases: ['help'],
          },
        ],
      }),
    });
    await sessionLoad;

    resolveGlobal?.({
      ok: true,
      json: async () => ({ commands: remoteCommands }),
    });
    await globalLoad;

    expect(slash.commands.value.map((command) => command.id)).toEqual(['skill-frontend-design', 'help', 'copy', 'summary', 'changelog']);
  });

  it('does not include the removed help command in fallback commands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const slash = useSlashCommands();
    await slash.loadCommands();
    slash.updateQuery('/help', 5);

    expect(slash.suggestions.value.some((command) => command.id === 'help')).toBe(false);
  });

  it('keeps client-only slash commands when remote commands load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ commands: remoteCommands }),
    }));

    const slash = useSlashCommands();
    await slash.loadCommands();
    slash.updateQuery('/copy', 5);

    expect(slash.suggestions.value.map((command) => command.id)).toEqual(['copy', 'summary']);
  });
});
