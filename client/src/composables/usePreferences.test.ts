import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPreferencesForTests, usePreferences } from './usePreferences';

describe('usePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferencesForTests();
    vi.restoreAllMocks();
  });

  it('defaults to showing hint info, code language headers, floating chat buttons, steering streaming messages, Ctrl+Meta+N new session shortcut, F11 fullscreen shortcut, auto-refresh disabled, system theme, English language, and beep sound when no cache exists', () => {
    const preferences = usePreferences();

    expect(preferences.showHintInfo.value).toBe(true);
    expect(preferences.showCodeBlockLanguageHeaders.value).toBe(true);
    expect(preferences.streamingMessageBehavior.value).toBe('steer');
    expect(preferences.editorAutoRefresh.value).toBe(false);
    expect(preferences.confirmSessionDelete.value).toBe(true);
    expect(preferences.newSessionShortcut.value).toBe('ctrlMetaN');
    expect(preferences.fullscreenShortcut.value).toBe('f11');
    expect(preferences.showGoToTopButton.value).toBe(true);
    expect(preferences.showChatViewOptionsButton.value).toBe(true);
    expect(preferences.theme.value).toBe('system');
    expect(preferences.language.value).toBe('en');
    expect(preferences.soundNotification.value).toBe('beep');
    expect(preferences.autoSpeakAssistant.value).toBe(false);
  });

  it('initializes display preferences from localStorage cache', () => {
    localStorage.setItem('pi-cloud.showHintInfo', 'false');
    localStorage.setItem('pi-cloud.showCodeBlockLanguageHeaders', 'false');
    localStorage.setItem('pi-cloud.streamingMessageBehavior', 'followUp');
    localStorage.setItem('pi-cloud.editorAutoRefresh', 'false');
    localStorage.setItem('pi-cloud.confirmSessionDelete', 'false');
    localStorage.setItem('pi-cloud.newSessionShortcut', 'ctrlAltN');
    localStorage.setItem('pi-cloud.fullscreenShortcut', 'ctrlShiftF');
    localStorage.setItem('pi-cloud.showGoToTopButton', 'false');
    localStorage.setItem('pi-cloud.showChatViewOptionsButton', 'false');
    localStorage.setItem('pi-cloud.theme', 'light');
    localStorage.setItem('pi-cloud.language', 'zh-CN');
    localStorage.setItem('pi-cloud.soundNotification', 'chime');
    localStorage.setItem('pi-cloud.autoSpeakAssistant', 'true');

    const preferences = usePreferences();

    expect(preferences.showHintInfo.value).toBe(false);
    expect(preferences.showCodeBlockLanguageHeaders.value).toBe(false);
    expect(preferences.streamingMessageBehavior.value).toBe('followUp');
    expect(preferences.editorAutoRefresh.value).toBe(false);
    expect(preferences.confirmSessionDelete.value).toBe(false);
    expect(preferences.newSessionShortcut.value).toBe('ctrlAltN');
    expect(preferences.fullscreenShortcut.value).toBe('ctrlShiftF');
    expect(preferences.showGoToTopButton.value).toBe(false);
    expect(preferences.showChatViewOptionsButton.value).toBe(false);
    expect(preferences.theme.value).toBe('light');
    expect(preferences.language.value).toBe('zh-CN');
    expect(preferences.soundNotification.value).toBe('chime');
    expect(preferences.autoSpeakAssistant.value).toBe(true);
  });

  it('loads backend preferences and refreshes the local cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ showHintInfo: false, showCodeBlockLanguageHeaders: false, streamingMessageBehavior: 'followUp', editorAutoRefresh: false, confirmSessionDelete: false, newSessionShortcut: 'disabled', fullscreenShortcut: 'ctrlShiftF', showGoToTopButton: false, showChatViewOptionsButton: false, theme: 'dark', language: 'zh-CN', soundNotification: 'ding', autoSpeakAssistant: true }),
    })));
    const preferences = usePreferences();

    await preferences.loadPreferences();

    expect(preferences.showHintInfo.value).toBe(false);
    expect(preferences.showCodeBlockLanguageHeaders.value).toBe(false);
    expect(preferences.streamingMessageBehavior.value).toBe('followUp');
    expect(preferences.editorAutoRefresh.value).toBe(false);
    expect(preferences.confirmSessionDelete.value).toBe(false);
    expect(preferences.newSessionShortcut.value).toBe('disabled');
    expect(preferences.fullscreenShortcut.value).toBe('ctrlShiftF');
    expect(preferences.showGoToTopButton.value).toBe(false);
    expect(preferences.showChatViewOptionsButton.value).toBe(false);
    expect(preferences.theme.value).toBe('dark');
    expect(preferences.language.value).toBe('zh-CN');
    expect(preferences.soundNotification.value).toBe('ding');
    expect(preferences.autoSpeakAssistant.value).toBe(true);
    expect(localStorage.getItem('pi-cloud.showHintInfo')).toBe('false');
    expect(localStorage.getItem('pi-cloud.showCodeBlockLanguageHeaders')).toBe('false');
    expect(localStorage.getItem('pi-cloud.streamingMessageBehavior')).toBe('followUp');
    expect(localStorage.getItem('pi-cloud.editorAutoRefresh')).toBe('false');
    expect(localStorage.getItem('pi-cloud.confirmSessionDelete')).toBe('false');
    expect(localStorage.getItem('pi-cloud.newSessionShortcut')).toBe('disabled');
    expect(localStorage.getItem('pi-cloud.fullscreenShortcut')).toBe('ctrlShiftF');
    expect(localStorage.getItem('pi-cloud.showGoToTopButton')).toBe('false');
    expect(localStorage.getItem('pi-cloud.showChatViewOptionsButton')).toBe('false');
    expect(localStorage.getItem('pi-cloud.theme')).toBe('dark');
    expect(localStorage.getItem('pi-cloud.language')).toBe('zh-CN');
    expect(localStorage.getItem('pi-cloud.soundNotification')).toBe('ding');
    expect(localStorage.getItem('pi-cloud.autoSpeakAssistant')).toBe('true');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences');
  });

  it('ignores backend load failures and keeps the cached preference', async () => {
    localStorage.setItem('pi-cloud.showHintInfo', 'false');
    localStorage.setItem('pi-cloud.showCodeBlockLanguageHeaders', 'false');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const preferences = usePreferences();

    await expect(preferences.loadPreferences()).resolves.toBeUndefined();

    expect(preferences.showHintInfo.value).toBe(false);
    expect(preferences.showCodeBlockLanguageHeaders.value).toBe(false);
    expect(localStorage.getItem('pi-cloud.showHintInfo')).toBe('false');
    expect(localStorage.getItem('pi-cloud.showCodeBlockLanguageHeaders')).toBe('false');
  });

  it('saves hint info to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ showHintInfo: false }),
    })));
    const preferences = usePreferences();

    await preferences.setShowHintInfo(false);

    expect(preferences.showHintInfo.value).toBe(false);
    expect(localStorage.getItem('pi-cloud.showHintInfo')).toBe('false');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showHintInfo: false }),
    });
  });

  it('saves code block language header preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ showCodeBlockLanguageHeaders: false }),
    })));
    const preferences = usePreferences();

    await preferences.setShowCodeBlockLanguageHeaders(false);

    expect(preferences.showCodeBlockLanguageHeaders.value).toBe(false);
    expect(localStorage.getItem('pi-cloud.showCodeBlockLanguageHeaders')).toBe('false');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showCodeBlockLanguageHeaders: false }),
    });
  });

  it('saves streaming message behavior to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ streamingMessageBehavior: 'followUp' }),
    })));
    const preferences = usePreferences();

    await preferences.setStreamingMessageBehavior('followUp');

    expect(preferences.streamingMessageBehavior.value).toBe('followUp');
    expect(localStorage.getItem('pi-cloud.streamingMessageBehavior')).toBe('followUp');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamingMessageBehavior: 'followUp' }),
    });
  });

  it('saves editor auto-refresh preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ editorAutoRefresh: false }),
    })));
    const preferences = usePreferences();

    await preferences.setEditorAutoRefresh(false);

    expect(preferences.editorAutoRefresh.value).toBe(false);
    expect(localStorage.getItem('pi-cloud.editorAutoRefresh')).toBe('false');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorAutoRefresh: false }),
    });
  });

  it('saves session delete confirmation to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ confirmSessionDelete: false }),
    })));
    const preferences = usePreferences();

    await preferences.setConfirmSessionDelete(false);

    expect(preferences.confirmSessionDelete.value).toBe(false);
    expect(localStorage.getItem('pi-cloud.confirmSessionDelete')).toBe('false');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmSessionDelete: false }),
    });
  });

  it('saves new session shortcut preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ newSessionShortcut: 'ctrlAltN' }),
    })));
    const preferences = usePreferences();

    await preferences.setNewSessionShortcut('ctrlAltN');

    expect(preferences.newSessionShortcut.value).toBe('ctrlAltN');
    expect(localStorage.getItem('pi-cloud.newSessionShortcut')).toBe('ctrlAltN');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newSessionShortcut: 'ctrlAltN' }),
    });
  });

  it('saves fullscreen shortcut preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ fullscreenShortcut: 'ctrlShiftF' }),
    })));
    const preferences = usePreferences();

    await preferences.setFullscreenShortcut('ctrlShiftF');

    expect(preferences.fullscreenShortcut.value).toBe('ctrlShiftF');
    expect(localStorage.getItem('pi-cloud.fullscreenShortcut')).toBe('ctrlShiftF');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullscreenShortcut: 'ctrlShiftF' }),
    });
  });

  it('saves floating chat button preferences to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ showGoToTopButton: false, showChatViewOptionsButton: false }),
    })));
    const preferences = usePreferences();

    await preferences.setShowGoToTopButton(false);
    await preferences.setShowChatViewOptionsButton(false);

    expect(preferences.showGoToTopButton.value).toBe(false);
    expect(preferences.showChatViewOptionsButton.value).toBe(false);
    expect(localStorage.getItem('pi-cloud.showGoToTopButton')).toBe('false');
    expect(localStorage.getItem('pi-cloud.showChatViewOptionsButton')).toBe('false');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showGoToTopButton: false }),
    });
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showChatViewOptionsButton: false }),
    });
  });

  it('saves theme preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ theme: 'light' }),
    })));
    const preferences = usePreferences();

    await preferences.setTheme('light');

    expect(preferences.theme.value).toBe('light');
    expect(localStorage.getItem('pi-cloud.theme')).toBe('light');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'light' }),
    });
  });

  it('saves language preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ language: 'zh-CN' }),
    })));
    const preferences = usePreferences();

    await preferences.setLanguage('zh-CN');

    expect(preferences.language.value).toBe('zh-CN');
    expect(localStorage.getItem('pi-cloud.language')).toBe('zh-CN');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'zh-CN' }),
    });
  });

  it('saves automatic speech preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ autoSpeakAssistant: true }),
    })));
    const preferences = usePreferences();

    await preferences.setAutoSpeakAssistant(true);

    expect(preferences.autoSpeakAssistant.value).toBe(true);
    expect(localStorage.getItem('pi-cloud.autoSpeakAssistant')).toBe('true');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoSpeakAssistant: true }),
    });
  });

  it('saves sound notification preference to cache immediately and persists to backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ soundNotification: 'chime' }),
    })));
    const preferences = usePreferences();

    await preferences.setSoundNotification('chime');

    expect(preferences.soundNotification.value).toBe('chime');
    expect(localStorage.getItem('pi-cloud.soundNotification')).toBe('chime');
    expect(fetch).toHaveBeenCalledWith('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soundNotification: 'chime' }),
    });
  });

});
