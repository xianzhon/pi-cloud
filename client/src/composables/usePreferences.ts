import { ref } from 'vue';

const SHOW_HINT_INFO_KEY = 'pi-cloud.showHintInfo';
const SHOW_CODE_BLOCK_LANGUAGE_HEADERS_KEY = 'pi-cloud.showCodeBlockLanguageHeaders';
const STREAMING_MESSAGE_BEHAVIOR_KEY = 'pi-cloud.streamingMessageBehavior';
const EDITOR_AUTO_REFRESH_KEY = 'pi-cloud.editorAutoRefresh';
const CONFIRM_SESSION_DELETE_KEY = 'pi-cloud.confirmSessionDelete';
const NEW_SESSION_SHORTCUT_KEY = 'pi-cloud.newSessionShortcut';
const FULLSCREEN_SHORTCUT_KEY = 'pi-cloud.fullscreenShortcut';
const SHOW_GO_TO_TOP_BUTTON_KEY = 'pi-cloud.showGoToTopButton';
const SHOW_CHAT_VIEW_OPTIONS_BUTTON_KEY = 'pi-cloud.showChatViewOptionsButton';
const AUTO_EXTRACT_MEMORY_KEY = 'pi-cloud.autoExtractMemory';
const THEME_KEY = 'pi-cloud.theme';
const LANGUAGE_KEY = 'pi-cloud.language';
const SOUND_NOTIFICATION_KEY = 'pi-cloud.soundNotification';
const AUTO_SPEAK_ASSISTANT_KEY = 'pi-cloud.autoSpeakAssistant';
const GIT_CLONE_PARENT_PATH_KEY = 'pi-cloud.gitCloneParentPath';

export type StreamingMessageBehavior = 'steer' | 'followUp';
export type NewSessionShortcut = 'ctrlAltN' | 'ctrlMetaN' | 'disabled';
export type FullscreenShortcut = 'f11' | 'ctrlShiftF';
export type ThemePreference = 'dark' | 'light' | 'system';
export type LanguagePreference = 'en' | 'zh-CN';
export type SoundNotificationPreference = 'off' | 'beep' | 'chime' | 'ding';

type PreferencePayload = {
  showHintInfo?: unknown;
  showCodeBlockLanguageHeaders?: unknown;
  streamingMessageBehavior?: unknown;
  editorAutoRefresh?: unknown;
  confirmSessionDelete?: unknown;
  newSessionShortcut?: unknown;
  fullscreenShortcut?: unknown;
  showGoToTopButton?: unknown;
  showChatViewOptionsButton?: unknown;
  autoExtractMemory?: unknown;
  theme?: unknown;
  language?: unknown;
  soundNotification?: unknown;
  autoSpeakAssistant?: unknown;
  gitCloneParentPath?: unknown;
};

function readCachedBoolean(key: string, defaultValue: boolean = true): boolean {
  if (typeof localStorage === 'undefined') return defaultValue;
  const cached = localStorage.getItem(key);
  if (cached === null) return defaultValue;
  return cached !== 'false';
}

function cacheBoolean(key: string, value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, String(value));
}

function isStreamingMessageBehavior(value: unknown): value is StreamingMessageBehavior {
  return value === 'steer' || value === 'followUp';
}

function readCachedStreamingMessageBehavior(): StreamingMessageBehavior {
  if (typeof localStorage === 'undefined') return 'steer';
  const cached = localStorage.getItem(STREAMING_MESSAGE_BEHAVIOR_KEY);
  return isStreamingMessageBehavior(cached) ? cached : 'steer';
}

function cacheStreamingMessageBehavior(value: StreamingMessageBehavior): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STREAMING_MESSAGE_BEHAVIOR_KEY, value);
}

function isNewSessionShortcut(value: unknown): value is NewSessionShortcut {
  return value === 'ctrlAltN' || value === 'ctrlMetaN' || value === 'disabled';
}

function readCachedNewSessionShortcut(): NewSessionShortcut {
  if (typeof localStorage === 'undefined') return 'ctrlMetaN';
  const cached = localStorage.getItem(NEW_SESSION_SHORTCUT_KEY);
  return isNewSessionShortcut(cached) ? cached : 'ctrlMetaN';
}

function cacheNewSessionShortcut(value: NewSessionShortcut): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(NEW_SESSION_SHORTCUT_KEY, value);
}

function isFullscreenShortcut(value: unknown): value is FullscreenShortcut {
  return value === 'f11' || value === 'ctrlShiftF';
}

function readCachedFullscreenShortcut(): FullscreenShortcut {
  if (typeof localStorage === 'undefined') return 'f11';
  const cached = localStorage.getItem(FULLSCREEN_SHORTCUT_KEY);
  return isFullscreenShortcut(cached) ? cached : 'f11';
}

function cacheFullscreenShortcut(value: FullscreenShortcut): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(FULLSCREEN_SHORTCUT_KEY, value);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function readCachedTheme(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system';
  const cached = localStorage.getItem(THEME_KEY);
  return isThemePreference(cached) ? cached : 'system';
}

function cacheTheme(value: ThemePreference): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(THEME_KEY, value);
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'en' || value === 'zh-CN';
}

function readCachedLanguage(): LanguagePreference {
  if (typeof localStorage === 'undefined') return 'en';
  const cached = localStorage.getItem(LANGUAGE_KEY);
  return isLanguagePreference(cached) ? cached : 'en';
}

function cacheLanguage(value: LanguagePreference): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LANGUAGE_KEY, value);
}

function isSoundNotificationPreference(value: unknown): value is SoundNotificationPreference {
  return value === 'off' || value === 'beep' || value === 'chime' || value === 'ding';
}

function readCachedSoundNotification(): SoundNotificationPreference {
  if (typeof localStorage === 'undefined') return 'beep';
  const cached = localStorage.getItem(SOUND_NOTIFICATION_KEY);
  return isSoundNotificationPreference(cached) ? cached : 'beep';
}

function cacheSoundNotification(value: SoundNotificationPreference): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SOUND_NOTIFICATION_KEY, value);
}

function readCachedString(key: string, defaultValue: string): string {
  if (typeof localStorage === 'undefined') return defaultValue;
  return localStorage.getItem(key) || defaultValue;
}

function cacheString(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}

const showHintInfo = ref(readCachedBoolean(SHOW_HINT_INFO_KEY));
const showCodeBlockLanguageHeaders = ref(readCachedBoolean(SHOW_CODE_BLOCK_LANGUAGE_HEADERS_KEY));
const streamingMessageBehavior = ref<StreamingMessageBehavior>(readCachedStreamingMessageBehavior());
const editorAutoRefresh = ref(readCachedBoolean(EDITOR_AUTO_REFRESH_KEY, false));
const confirmSessionDelete = ref(readCachedBoolean(CONFIRM_SESSION_DELETE_KEY));
const newSessionShortcut = ref<NewSessionShortcut>(readCachedNewSessionShortcut());
const fullscreenShortcut = ref<FullscreenShortcut>(readCachedFullscreenShortcut());
const showGoToTopButton = ref(readCachedBoolean(SHOW_GO_TO_TOP_BUTTON_KEY));
const showChatViewOptionsButton = ref(readCachedBoolean(SHOW_CHAT_VIEW_OPTIONS_BUTTON_KEY));
const autoExtractMemory = ref(readCachedBoolean(AUTO_EXTRACT_MEMORY_KEY, false));
const theme = ref<ThemePreference>(readCachedTheme());
const language = ref<LanguagePreference>(readCachedLanguage());
const soundNotification = ref<SoundNotificationPreference>(readCachedSoundNotification());
const autoSpeakAssistant = ref(readCachedBoolean(AUTO_SPEAK_ASSISTANT_KEY, false));
const gitCloneParentPath = ref(readCachedString(GIT_CLONE_PARENT_PATH_KEY, '~/git/github'));

function applyPreferences(data: PreferencePayload) {
  if (typeof data.showHintInfo === 'boolean') {
    showHintInfo.value = data.showHintInfo;
    cacheBoolean(SHOW_HINT_INFO_KEY, data.showHintInfo);
  }
  if (typeof data.showCodeBlockLanguageHeaders === 'boolean') {
    showCodeBlockLanguageHeaders.value = data.showCodeBlockLanguageHeaders;
    cacheBoolean(SHOW_CODE_BLOCK_LANGUAGE_HEADERS_KEY, data.showCodeBlockLanguageHeaders);
  }
  if (isStreamingMessageBehavior(data.streamingMessageBehavior)) {
    streamingMessageBehavior.value = data.streamingMessageBehavior;
    cacheStreamingMessageBehavior(data.streamingMessageBehavior);
  }
  if (typeof data.editorAutoRefresh === 'boolean') {
    editorAutoRefresh.value = data.editorAutoRefresh;
    cacheBoolean(EDITOR_AUTO_REFRESH_KEY, data.editorAutoRefresh);
  }
  if (typeof data.confirmSessionDelete === 'boolean') {
    confirmSessionDelete.value = data.confirmSessionDelete;
    cacheBoolean(CONFIRM_SESSION_DELETE_KEY, data.confirmSessionDelete);
  }
  if (isNewSessionShortcut(data.newSessionShortcut)) {
    newSessionShortcut.value = data.newSessionShortcut;
    cacheNewSessionShortcut(data.newSessionShortcut);
  }
  if (isFullscreenShortcut(data.fullscreenShortcut)) {
    fullscreenShortcut.value = data.fullscreenShortcut;
    cacheFullscreenShortcut(data.fullscreenShortcut);
  }
  if (typeof data.showGoToTopButton === 'boolean') {
    showGoToTopButton.value = data.showGoToTopButton;
    cacheBoolean(SHOW_GO_TO_TOP_BUTTON_KEY, data.showGoToTopButton);
  }
  if (typeof data.showChatViewOptionsButton === 'boolean') {
    showChatViewOptionsButton.value = data.showChatViewOptionsButton;
    cacheBoolean(SHOW_CHAT_VIEW_OPTIONS_BUTTON_KEY, data.showChatViewOptionsButton);
  }
  if (typeof data.autoExtractMemory === 'boolean') {
    autoExtractMemory.value = data.autoExtractMemory;
    cacheBoolean(AUTO_EXTRACT_MEMORY_KEY, data.autoExtractMemory);
  }
  if (isThemePreference(data.theme)) {
    theme.value = data.theme;
    cacheTheme(data.theme);
  }
  if (isLanguagePreference(data.language)) {
    language.value = data.language;
    cacheLanguage(data.language);
  }
  if (isSoundNotificationPreference(data.soundNotification)) {
    soundNotification.value = data.soundNotification;
    cacheSoundNotification(data.soundNotification);
  }
  if (typeof data.autoSpeakAssistant === 'boolean') {
    autoSpeakAssistant.value = data.autoSpeakAssistant;
    cacheBoolean(AUTO_SPEAK_ASSISTANT_KEY, data.autoSpeakAssistant);
  }
  if (typeof data.gitCloneParentPath === 'string' && data.gitCloneParentPath.trim()) {
    gitCloneParentPath.value = data.gitCloneParentPath;
    cacheString(GIT_CLONE_PARENT_PATH_KEY, data.gitCloneParentPath);
  }
}

async function loadPreferences(): Promise<void> {
  try {
    const response = await fetch('/api/auth/preferences');
    if (!response.ok) return;

    const data = await response.json() as PreferencePayload;
    applyPreferences(data);
  } catch {
    // Local cache remains authoritative for immediate UI when backend sync is unavailable.
  }
}

async function patchPreferences(payload: PreferencePayload): Promise<void> {
  try {
    const response = await fetch('/api/auth/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return;
    const data = await response.json() as PreferencePayload;
    applyPreferences(data);
  } catch {
    // Keep immediate local preferences even if DB persistence is temporarily unavailable.
  }
}

async function setShowHintInfo(value: boolean): Promise<void> {
  showHintInfo.value = value;
  cacheBoolean(SHOW_HINT_INFO_KEY, value);
  await patchPreferences({ showHintInfo: value });
}

async function setShowCodeBlockLanguageHeaders(value: boolean): Promise<void> {
  showCodeBlockLanguageHeaders.value = value;
  cacheBoolean(SHOW_CODE_BLOCK_LANGUAGE_HEADERS_KEY, value);
  await patchPreferences({ showCodeBlockLanguageHeaders: value });
}

async function setStreamingMessageBehavior(value: StreamingMessageBehavior): Promise<void> {
  streamingMessageBehavior.value = value;
  cacheStreamingMessageBehavior(value);
  await patchPreferences({ streamingMessageBehavior: value });
}

async function setEditorAutoRefresh(value: boolean): Promise<void> {
  editorAutoRefresh.value = value;
  cacheBoolean(EDITOR_AUTO_REFRESH_KEY, value);
  await patchPreferences({ editorAutoRefresh: value });
}

async function setConfirmSessionDelete(value: boolean): Promise<void> {
  confirmSessionDelete.value = value;
  cacheBoolean(CONFIRM_SESSION_DELETE_KEY, value);
  await patchPreferences({ confirmSessionDelete: value });
}

async function setNewSessionShortcut(value: NewSessionShortcut): Promise<void> {
  newSessionShortcut.value = value;
  cacheNewSessionShortcut(value);
  await patchPreferences({ newSessionShortcut: value });
}

async function setFullscreenShortcut(value: FullscreenShortcut): Promise<void> {
  fullscreenShortcut.value = value;
  cacheFullscreenShortcut(value);
  await patchPreferences({ fullscreenShortcut: value });
}

async function setShowGoToTopButton(value: boolean): Promise<void> {
  showGoToTopButton.value = value;
  cacheBoolean(SHOW_GO_TO_TOP_BUTTON_KEY, value);
  await patchPreferences({ showGoToTopButton: value });
}

async function setShowChatViewOptionsButton(value: boolean): Promise<void> {
  showChatViewOptionsButton.value = value;
  cacheBoolean(SHOW_CHAT_VIEW_OPTIONS_BUTTON_KEY, value);
  await patchPreferences({ showChatViewOptionsButton: value });
}

async function setAutoExtractMemory(value: boolean): Promise<void> {
  autoExtractMemory.value = value;
  cacheBoolean(AUTO_EXTRACT_MEMORY_KEY, value);
  await patchPreferences({ autoExtractMemory: value });
}

async function setTheme(value: ThemePreference): Promise<void> {
  theme.value = value;
  cacheTheme(value);
  await patchPreferences({ theme: value });
}

async function setLanguage(value: LanguagePreference): Promise<void> {
  language.value = value;
  cacheLanguage(value);
  await patchPreferences({ language: value });
}

async function setSoundNotification(value: SoundNotificationPreference): Promise<void> {
  soundNotification.value = value;
  cacheSoundNotification(value);
  await patchPreferences({ soundNotification: value });
}

async function setAutoSpeakAssistant(value: boolean): Promise<void> {
  autoSpeakAssistant.value = value;
  cacheBoolean(AUTO_SPEAK_ASSISTANT_KEY, value);
  await patchPreferences({ autoSpeakAssistant: value });
}

async function setGitCloneParentPath(value: string): Promise<void> {
  const next = value.trim() || '~/git/github';
  gitCloneParentPath.value = next;
  cacheString(GIT_CLONE_PARENT_PATH_KEY, next);
  await patchPreferences({ gitCloneParentPath: next });
}

function resetPreferenceRefsFromCache(): void {
  showHintInfo.value = readCachedBoolean(SHOW_HINT_INFO_KEY);
  showCodeBlockLanguageHeaders.value = readCachedBoolean(SHOW_CODE_BLOCK_LANGUAGE_HEADERS_KEY);
  streamingMessageBehavior.value = readCachedStreamingMessageBehavior();
  editorAutoRefresh.value = readCachedBoolean(EDITOR_AUTO_REFRESH_KEY, false);
  confirmSessionDelete.value = readCachedBoolean(CONFIRM_SESSION_DELETE_KEY);
  newSessionShortcut.value = readCachedNewSessionShortcut();
  fullscreenShortcut.value = readCachedFullscreenShortcut();
  showGoToTopButton.value = readCachedBoolean(SHOW_GO_TO_TOP_BUTTON_KEY);
  showChatViewOptionsButton.value = readCachedBoolean(SHOW_CHAT_VIEW_OPTIONS_BUTTON_KEY);
  autoExtractMemory.value = readCachedBoolean(AUTO_EXTRACT_MEMORY_KEY, false);
  theme.value = readCachedTheme();
  language.value = readCachedLanguage();
  soundNotification.value = readCachedSoundNotification();
  autoSpeakAssistant.value = readCachedBoolean(AUTO_SPEAK_ASSISTANT_KEY, false);
  gitCloneParentPath.value = readCachedString(GIT_CLONE_PARENT_PATH_KEY, '~/git/github');
}

export function usePreferences() {
  resetPreferenceRefsFromCache();

  return {
    showHintInfo,
    showCodeBlockLanguageHeaders,
    streamingMessageBehavior,
    editorAutoRefresh,
    confirmSessionDelete,
    newSessionShortcut,
    fullscreenShortcut,
    showGoToTopButton,
    showChatViewOptionsButton,
    autoExtractMemory,
    theme,
    language,
    soundNotification,
    autoSpeakAssistant,
    gitCloneParentPath,
    loadPreferences,
    setShowHintInfo,
    setShowCodeBlockLanguageHeaders,
    setStreamingMessageBehavior,
    setEditorAutoRefresh,
    setConfirmSessionDelete,
    setNewSessionShortcut,
    setFullscreenShortcut,
    setShowGoToTopButton,
    setShowChatViewOptionsButton,
    setAutoExtractMemory,
    setTheme,
    setLanguage,
    setSoundNotification,
    setAutoSpeakAssistant,
    setGitCloneParentPath,
  };
}

export function resetPreferencesForTests(): void {
  resetPreferenceRefsFromCache();
}
