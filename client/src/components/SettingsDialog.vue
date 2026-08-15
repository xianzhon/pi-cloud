<template>
  <Teleport to="body">
    <Transition name="settings-modal">
      <div v-if="visible" class="settings-backdrop">
        <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <aside class="settings-sidebar">
            <h2 id="settings-title">{{ t('settings.title') }}</h2>
            <nav class="settings-menu" :aria-label="t('settings.sectionsLabel')">
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'general' }"
                type="button"
                @click="activeSection = 'general'"
              >
                <PhSliders :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.general') }}</span>
              </button>
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'security' }"
                type="button"
                @click="activeSection = 'security'"
              >
                <PhLock :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.security') }}</span>
              </button>
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'chat' }"
                type="button"
                @click="activeSection = 'chat'"
              >
                <PhChatCircle :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.chat') }}</span>
              </button>
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'keyboard' }"
                type="button"
                @click="activeSection = 'keyboard'"
              >
                <PhKeyboard :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.keyboard') }}</span>
              </button>
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'skills' }"
                type="button"
                @click="activeSection = 'skills'"
              >
                <PhSparkle :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.skills') }}</span>
              </button>
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'git' }"
                type="button"
                @click="activeSection = 'git'"
              >
                <PhGitPullRequest :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.git') }}</span>
              </button>
              <button
                class="settings-menu-item"
                :class="{ active: activeSection === 'gateway' }"
                type="button"
                @click="activeSection = 'gateway'"
              >
                <PhPaperPlaneTilt :size="18" weight="bold" class="settings-menu-icon" />
                <span>{{ t('settings.sections.gateway') }}</span>
              </button>
            </nav>
          </aside>

          <main class="settings-body">
            <header class="settings-body-header">
              <div>
                <h3>{{ sectionHeading }}</h3>
              </div>
              <DialogCloseButton class="settings-close" :label="t('settings.close')" @click="requestClose" />
            </header>

            <div class="settings-content">
              <template v-if="activeSection === 'general'">
                <section class="settings-card theme-settings" aria-labelledby="theme-settings-title">
                  <div class="settings-card-copy">
                    <h4 id="theme-settings-title">{{ t('settings.theme.title') }}</h4>
                    <p>{{ t('settings.theme.description') }}</p>
                  </div>
                  <label class="settings-select-label">
                    <span class="sr-only">{{ t('settings.theme.title') }}</span>
                    <CustomSelect
                      id="settings-theme-select"
                      :model-value="theme"
                      :options="themeOptions"
                      :aria-label="t('settings.theme.title')"
                      @update:model-value="emit('update:theme', $event as ThemePreference)"
                    />
                  </label>
                </section>

                <section class="settings-card language-settings" aria-labelledby="language-settings-title">
                  <div class="settings-card-copy">
                    <h4 id="language-settings-title">{{ t('settings.language.title') }}</h4>
                    <p>{{ t('settings.language.description') }}</p>
                  </div>
                  <label class="settings-select-label">
                    <span class="sr-only">{{ t('settings.language.title') }}</span>
                    <CustomSelect
                      id="settings-language-select"
                      :model-value="language"
                      :options="languageOptions"
                      :aria-label="t('settings.language.title')"
                      @update:model-value="emit('update:language', $event as LanguagePreference)"
                    />
                  </label>
                </section>

                <section class="settings-card display-settings" aria-labelledby="display-settings-title">
                  <div class="settings-card-copy">
                    <h4 id="display-settings-title">{{ t('settings.hintInfo.title') }}</h4>
                    <p>{{ t('settings.hintInfo.description') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="hint-info-toggle"
                      type="checkbox"
                      :checked="showHintInfo"
                      @change="emit('update:showHintInfo', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(showHintInfo ? 'settings.state.shown' : 'settings.state.hidden') }}</span>
                  </label>
                </section>

                <section class="settings-card code-language-headers-settings" aria-labelledby="code-language-headers-title">
                  <div class="settings-card-copy">
                    <h4 id="code-language-headers-title">{{ t('settings.codeHeaders.title') }}</h4>
                    <p>{{ t('settings.codeHeaders.description') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="code-language-headers-toggle"
                      type="checkbox"
                      :checked="showCodeBlockLanguageHeaders"
                      @change="emit('update:showCodeBlockLanguageHeaders', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(showCodeBlockLanguageHeaders ? 'settings.state.shown' : 'settings.state.hidden') }}</span>
                  </label>
                </section>

                <section class="settings-card editor-auto-refresh-settings" aria-labelledby="editor-auto-refresh-title">
                  <div class="settings-card-copy">
                    <h4 id="editor-auto-refresh-title">{{ t('settings.editorRefresh.title') }}</h4>
                    <p>{{ t('settings.editorRefresh.description') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="editor-auto-refresh-toggle"
                      type="checkbox"
                      :checked="editorAutoRefresh"
                      @change="emit('update:editorAutoRefresh', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(editorAutoRefresh ? 'settings.state.enabled' : 'settings.state.disabled') }}</span>
                  </label>
                </section>

                <section class="settings-card delete-confirm-settings" aria-labelledby="delete-confirm-title">
                  <div class="settings-card-copy">
                    <h4 id="delete-confirm-title">{{ t('settings.deleteConfirm.title') }}</h4>
                    <p>{{ t('settings.deleteConfirm.description') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="delete-confirm-toggle"
                      type="checkbox"
                      :checked="confirmSessionDelete"
                      @change="emit('update:confirmSessionDelete', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(confirmSessionDelete ? 'settings.state.yes' : 'settings.state.no') }}</span>
                  </label>
                </section>

                <section class="settings-card launch-cache-settings" aria-labelledby="launch-cache-title">
                  <div class="settings-card-copy">
                    <h4 id="launch-cache-title">{{ t('settings.launchCache.title') }}</h4>
                    <p>{{ t('settings.launchCache.description') }}</p>
                  </div>
                  <button type="button" class="settings-action-btn" @click="emit('clearLaunchCache')">{{ t('settings.launchCache.clear') }}</button>
                </section>

              </template>

              <template v-if="activeSection === 'chat'">
                <section class="settings-card go-to-top-settings" aria-labelledby="go-to-top-title">
                  <div class="settings-card-copy">
                    <h4 id="go-to-top-title">{{ t('settings.chat.goToTopTitle') }}</h4>
                    <p>{{ t('settings.chat.goToTopDescription') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="go-to-top-toggle"
                      type="checkbox"
                      :checked="showGoToTopButton"
                      @change="emit('update:showGoToTopButton', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(showGoToTopButton ? 'settings.state.shown' : 'settings.state.hidden') }}</span>
                  </label>
                </section>

                <section class="settings-card chat-view-options-settings" aria-labelledby="chat-view-options-title">
                  <div class="settings-card-copy">
                    <h4 id="chat-view-options-title">{{ t('settings.chat.viewOptionsTitle') }}</h4>
                    <p>{{ t('settings.chat.viewOptionsDescription') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="chat-view-options-toggle"
                      type="checkbox"
                      :checked="showChatViewOptionsButton"
                      @change="emit('update:showChatViewOptionsButton', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(showChatViewOptionsButton ? 'settings.state.shown' : 'settings.state.hidden') }}</span>
                  </label>
                </section>

                <section class="settings-card memory-auto-extract-settings" aria-labelledby="memory-auto-extract-title">
                  <div class="settings-card-copy">
                    <h4 id="memory-auto-extract-title">{{ t('settings.chat.memoryTitle') }}</h4>
                    <p>{{ t('settings.chat.memoryDescription') }}</p>
                  </div>
                  <label class="settings-switch">
                    <input
                      class="memory-auto-extract-toggle"
                      type="checkbox"
                      :checked="autoExtractMemory"
                      @change="emit('update:autoExtractMemory', ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="settings-switch-track" aria-hidden="true"></span>
                    <span class="settings-switch-text">{{ t(autoExtractMemory ? 'settings.state.enabled' : 'settings.state.disabled') }}</span>
                  </label>
                </section>

                <section class="settings-card streaming-behavior-settings" aria-labelledby="streaming-behavior-title">
                  <div class="settings-card-copy">
                    <h4 id="streaming-behavior-title">{{ t('settings.chat.streamingTitle') }}</h4>
                    <p>{{ t('settings.chat.streamingDescription') }}</p>
                  </div>
                  <label class="settings-select-label">
                    <span class="sr-only">{{ t('settings.chat.streamingTitle') }}</span>
                    <CustomSelect
                      id="settings-streaming-behavior-select"
                      :model-value="streamingMessageBehavior"
                      :options="streamingBehaviorOptions"
                      :aria-label="t('settings.chat.streamingTitle')"
                      @update:model-value="emit('update:streamingMessageBehavior', $event as StreamingMessageBehavior)"
                    />
                  </label>
                </section>

                <section class="settings-card sound-notification-settings" aria-labelledby="sound-notification-title">
                  <div class="settings-card-copy">
                    <h4 id="sound-notification-title">{{ t('settings.chat.soundTitle') }}</h4>
                    <p>{{ t('settings.chat.soundDescription') }}</p>
                  </div>
                  <div class="settings-inline-control sound-notification-control">
                    <label class="settings-select-label">
                      <span class="sr-only">{{ t('settings.chat.soundTitle') }}</span>
                      <CustomSelect
                        id="settings-sound-notification-select"
                        :model-value="soundNotification"
                        :options="soundNotificationOptions"
                        :aria-label="t('settings.chat.soundTitle')"
                        @update:model-value="emit('update:soundNotification', $event as SoundNotificationPreference)"
                      />
                    </label>
                    <button
                      type="button"
                      class="settings-icon-btn"
                      :disabled="soundNotification === 'off'"
                      :title="t('settings.chat.previewSound')"
                      :aria-label="t('settings.chat.previewSound')"
                      @click="playTaskNotification(soundNotification)"
                    >
                      <PhSpeakerHigh :size="18" weight="bold" />
                    </button>
                  </div>
                </section>
              </template>

              <template v-if="activeSection === 'keyboard'">
                <section class="settings-card new-session-shortcut-settings" aria-labelledby="new-session-shortcut-title">
                  <div class="settings-card-copy">
                    <h4 id="new-session-shortcut-title">{{ t('settings.keyboard.newSessionTitle') }}</h4>
                    <p>{{ t('settings.keyboard.newSessionDescription') }}</p>
                  </div>
                  <label class="settings-select-label keyboard-shortcut-select-label">
                    <span class="sr-only">{{ t('settings.keyboard.newSessionTitle') }}</span>
                    <CustomSelect
                      id="settings-new-session-shortcut-select"
                      :model-value="newSessionShortcut"
                      :options="newSessionShortcutOptions"
                      :aria-label="t('settings.keyboard.newSessionTitle')"
                      @update:model-value="emit('update:newSessionShortcut', $event as NewSessionShortcut)"
                    />
                  </label>
                </section>

                <section class="settings-card fullscreen-shortcut-settings" aria-labelledby="fullscreen-shortcut-title">
                  <div class="settings-card-copy">
                    <h4 id="fullscreen-shortcut-title">{{ t('settings.keyboard.fullscreenTitle') }}</h4>
                    <p>{{ t('settings.keyboard.fullscreenDescription') }}</p>
                  </div>
                  <label class="settings-select-label keyboard-shortcut-select-label">
                    <span class="sr-only">{{ t('settings.keyboard.fullscreenTitle') }}</span>
                    <CustomSelect
                      id="settings-fullscreen-shortcut-select"
                      :model-value="fullscreenShortcut"
                      :options="fullscreenShortcutOptions"
                      :aria-label="t('settings.keyboard.fullscreenTitle')"
                      @update:model-value="emit('update:fullscreenShortcut', $event as FullscreenShortcut)"
                    />
                  </label>
                </section>

                <section class="settings-card keyboard-shortcuts-card" aria-labelledby="keyboard-shortcuts-title">
                  <div class="settings-card-copy keyboard-shortcuts-copy">
                    <h4 id="keyboard-shortcuts-title">{{ t('settings.keyboard.title') }}</h4>
                    <p>{{ t('settings.keyboard.description') }}</p>
                    <dl class="keyboard-shortcut-list">
                      <div>
                        <dt><kbd>{{ t('components.settingsDialog.i') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.focusTheMessageInput') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>{{ t('components.settingsDialog.h') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.focusTheLatestChatMessageHistory') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>/</kbd></dt>
                        <dd>{{ t('components.settingsDialog.focusTheMessageInputAndStartA') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>↑</kbd></dt>
                        <dd>{{ t('components.settingsDialog.fromAnEmptyMessageInputMoveFocus') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>Esc</kbd> <span>{{ t('components.settingsDialog.or') }}</span> <kbd>Enter</kbd></dt>
                        <dd>{{ t('components.settingsDialog.fromChatHistoryReturnFocusToThe') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>⌘/Ctrl</kbd> + <kbd>{{ t('components.settingsDialog.k') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.openSessionSearch') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>{{ t('components.settingsDialog.p') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.focusTheProjectSelector') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>⌘/Ctrl</kbd> + <kbd>`</kbd></dt>
                        <dd>{{ t('components.settingsDialog.toggleTheTerminalPanel') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>Ctrl</kbd> + <kbd>{{ t('components.settingsDialog.e') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.toggleTheEditorPanel') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>Ctrl</kbd> + <kbd>{{ t('components.settingsDialog.q') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.toggleTheTaskQueue') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>⌘/Ctrl</kbd> + <kbd>{{ t('components.settingsDialog.b') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.toggleTheDesktopSidebar') }}</dd>
                      </div>
                      <div>
                        <dt><kbd>{{ t('components.settingsDialog.f11') }}</kbd> <span>{{ t('components.settingsDialog.or') }}</span> <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>{{ t('components.settingsDialog.f') }}</kbd></dt>
                        <dd>{{ t('components.settingsDialog.toggleMainWindowFullscreenDependingOnYour') }}</dd>
                      </div>
                    </dl>
                  </div>
                </section>
              </template>

              <template v-if="activeSection === 'git'">
                <section class="settings-card git-settings" aria-labelledby="git-settings-title">
                  <div class="git-settings-header">
                    <div class="settings-card-copy">
                      <h4 id="git-settings-title">{{ t('components.settingsDialog.gitIntegration') }}</h4>
                      <p>{{ t('components.settingsDialog.configureGiteaAndGitHubTokensPRAnd') }}</p>
                      <p class="settings-inline-note git-settings-summary">
                        {{ t('components.settingsDialog.configuredProviders', { providers: [githubTokenConfigured ? 'GitHub' : '', giteaTokenConfigured ? 'Gitea' : ''].filter(Boolean).join(', ') || t('components.settingsDialog.none') }) }}
                      </p>
                    </div>
                    <button type="button" class="settings-action-btn compact-action settings-save-btn git-save-btn" :class="{ saved: gitSavedVisible }" :disabled="!gitDirty || gitSaving" @click="saveGitSettings">
                      {{ gitSaveButtonText }}
                    </button>
                  </div>
                  <p v-if="gitSavedVisible" class="git-save-success" role="status">{{ t('components.settingsDialog.gitIntegrationSettingsSaved') }}</p>
                  <div class="git-settings-grid">
                    <div class="git-provider-card">
                      <div class="git-provider-heading">
                        <strong>Gitea</strong>
                        <span :class="['git-provider-status', { configured: giteaTokenConfigured }]">{{ giteaTokenConfigured ? t('components.settingsDialog.configured') : t('components.settingsDialog.notConfigured') }}</span>
                      </div>
                      <label class="git-settings-field">{{ t('components.settingsDialog.serverURL') }}
                        <input class="settings-input" :value="draftGiteaServerUrl" placeholder="https://git.example.com" @input="draftGiteaServerUrl = ($event.target as HTMLInputElement).value" />
                      </label>
                      <label class="git-settings-field">{{ t('components.settingsDialog.personalAccessToken') }}
                        <input class="settings-input" type="password" :value="draftGiteaToken" :placeholder="giteaTokenConfigured ? t('components.settingsDialog.tokenConfiguredEnterANewTokenToReplace') : t('components.settingsDialog.personalAccessToken')" @input="draftGiteaToken = ($event.target as HTMLInputElement).value" />
                      </label>
                      <div class="settings-inline-actions">
                        <button type="button" class="settings-action-btn compact-action" @click="emit('testGiteaConnection', { serverUrl: draftGiteaServerUrl, token: draftGiteaToken })">{{ t('components.settingsDialog.test') }}</button>
                        <button type="button" class="settings-action-btn compact-action" @click="emit('clearGiteaSettings')">{{ t('components.settingsDialog.clear') }}</button>
                      </div>
                    </div>
                    <div class="git-provider-card">
                      <div class="git-provider-heading">
                        <strong>GitHub</strong>
                        <span :class="['git-provider-status', { configured: githubTokenConfigured }]">{{ githubTokenConfigured ? t('components.settingsDialog.configured') : t('components.settingsDialog.notConfigured') }}</span>
                      </div>
                      <label class="git-settings-field">{{ t('components.settingsDialog.serverURL') }}
                        <input class="settings-input" :value="draftGithubServerUrl" placeholder="https://github.com" @input="draftGithubServerUrl = ($event.target as HTMLInputElement).value" />
                      </label>
                      <label class="git-settings-field">{{ t('components.settingsDialog.personalAccessToken') }}
                        <input class="settings-input" type="password" :value="draftGithubToken" :placeholder="githubTokenConfigured ? t('components.settingsDialog.tokenConfiguredEnterANewTokenToReplace') : t('components.settingsDialog.githubPersonalAccessToken')" @input="draftGithubToken = ($event.target as HTMLInputElement).value" />
                      </label>
                      <div class="settings-inline-actions">
                        <button type="button" class="settings-action-btn compact-action" @click="emit('testGithubConnection', { serverUrl: draftGithubServerUrl, token: draftGithubToken })">{{ t('components.settingsDialog.test') }}</button>
                        <button type="button" class="settings-action-btn compact-action" @click="emit('clearGithubSettings')">{{ t('components.settingsDialog.clear') }}</button>
                      </div>
                    </div>
                  </div>
                  <label class="git-settings-field git-clone-root-field">{{ t('components.settingsDialog.cloneRootFolder') }}
                    <span class="git-clone-root-row">
                      <input class="settings-input" :value="draftGitCloneParentPath" placeholder="~/git/github" @input="draftGitCloneParentPath = ($event.target as HTMLInputElement).value" />
                    </span>
                  </label>
                  <label class="git-settings-field git-clone-root-field">{{ t('components.settingsDialog.githubHTTPProxy') }}
                    <span class="git-clone-root-row">
                      <input class="settings-input" :value="draftGithubProxyUrl" placeholder="http://proxy.example:7890" @input="draftGithubProxyUrl = ($event.target as HTMLInputElement).value" />
                      <button type="button" class="settings-action-btn compact-action git-proxy-check-button" :disabled="githubProxyChecking" @click="emit('testGithubProxy', draftGithubProxyUrl)">
                        <span>{{ githubProxyChecking ? t('components.settingsDialog.checking') : t('components.settingsDialog.testProxy') }}</span>
                        <span v-if="githubProxyCheckResult" :class="githubProxyCheckResult === 'ok' ? 'git-check-ok' : 'git-check-failed'" aria-hidden="true">
                          {{ githubProxyCheckResult === 'ok' ? '✓' : '✕' }}
                        </span>
                      </button>
                    </span>
                    <span class="settings-inline-note">{{ t('components.settingsDialog.usedAsALLPROXYHttpProxyHttps') }}</span>
                  </label>
                </section>

                <section class="settings-card commit-prompt-settings" aria-labelledby="commit-prompt-settings-title">
                  <div class="settings-card-copy">
                    <h4 id="commit-prompt-settings-title">{{ t('components.settingsDialog.commitMessagePrompts') }}</h4>
                    <p>{{ t('components.settingsDialog.commitMessagePromptsDescription') }}</p>
                  </div>
                  <div v-if="commitPromptError" class="settings-error-text" role="alert">{{ commitPromptError }}</div>
                  <div class="commit-prompt-grid">
                    <fieldset class="commit-prompt-scope">
                      <legend>{{ t('components.settingsDialog.globalPrompts') }}</legend>
                      <label class="git-settings-field">{{ t('components.settingsDialog.systemPrompt') }}
                        <textarea v-model="globalSystemPrompt" class="settings-input commit-prompt-textarea" :placeholder="effectiveSystemPrompt" />
                      </label>
                      <label class="git-settings-field">{{ t('components.settingsDialog.userPrompt') }}
                        <textarea v-model="globalUserPrompt" class="settings-input commit-prompt-textarea large" :placeholder="effectiveUserPrompt" />
                      </label>
                      <button type="button" class="settings-action-btn compact-action" :disabled="commitPromptsSaving" @click="saveCommitPrompts('global')">{{ t('components.settingsDialog.saveGlobalPrompts') }}</button>
                    </fieldset>
                    <fieldset class="commit-prompt-scope">
                      <legend>
                        {{ t('components.settingsDialog.projectPrompts') }}
                        <span class="commit-prompt-project-path">({{ projectDisplayPath }})</span>
                      </legend>
                      <label class="git-settings-field">{{ t('components.settingsDialog.systemPrompt') }}
                        <textarea v-model="projectSystemPrompt" class="settings-input commit-prompt-textarea" :placeholder="t('components.settingsDialog.inheritGlobalPrompt')" />
                      </label>
                      <label class="git-settings-field">{{ t('components.settingsDialog.userPrompt') }}
                        <textarea v-model="projectUserPrompt" class="settings-input commit-prompt-textarea large" :placeholder="t('components.settingsDialog.inheritGlobalPrompt')" />
                      </label>
                      <button type="button" class="settings-action-btn compact-action" :disabled="commitPromptsSaving" @click="saveCommitPrompts('project')">{{ t('components.settingsDialog.saveProjectPrompts') }}</button>
                    </fieldset>
                  </div>
                  <p v-if="commitPromptsSaved" class="git-save-success" role="status">{{ t('components.settingsDialog.commitMessagePromptsSaved') }}</p>
                </section>
              </template>

              <template v-if="activeSection === 'gateway'">
                <section class="settings-card gateway-settings" aria-labelledby="gateway-settings-title">
                  <div class="git-settings-header gateway-settings-header">
                    <div class="settings-card-copy">
                      <h4 id="gateway-settings-title">{{ t('components.settingsDialog.gatewayDefaults') }}</h4>
                      <p>{{ t('components.settingsDialog.configureTheDefaultProfileModelSkillsetAnd') }}</p>
                    </div>
                    <button type="button" class="settings-action-btn compact-action settings-save-btn gateway-save-btn" :class="{ saved: gatewaySavedVisible }" :disabled="!gatewayDirty || gatewaySaving" @click="saveGatewaySettings">
                      {{ gatewaySaveButtonText }}
                    </button>
                  </div>
                  <p v-if="gatewaySavedVisible" class="git-save-success" role="status">{{ t('components.settingsDialog.gatewaySettingsSaved') }}</p>
                  <div class="gateway-defaults-grid">
                    <label class="git-settings-field gateway-default-field">{{ t('components.settingsDialog.defaultProfile') }}
                      <CustomSelect
                        id="gateway-default-profile-select"
                        :model-value="draftGatewayDefaultProfile"
                        :options="gatewayProfileOptions"
                        searchable
                        :aria-label="t('components.settingsDialog.gatewayDefaultProfile')"
                        @update:model-value="setDraftGatewayDefaultProfile"
                      />
                    </label>
                    <label class="git-settings-field gateway-default-field">{{ t('components.settingsDialog.defaultModel') }}
                      <CustomSelect
                        id="gateway-default-model-select"
                        v-model="draftGatewayDefaultModel"
                        :options="gatewayModelOptions"
                        :disabled="gatewayModelsLoading"
                        searchable
                        :aria-label="t('components.settingsDialog.gatewayDefaultModel')"
                      />
                    </label>
                    <label class="git-settings-field gateway-default-field">{{ t('components.settingsDialog.defaultSkillset') }}
                      <CustomSelect
                        id="gateway-default-skillset-select"
                        v-model="draftGatewayDefaultSkillset"
                        :options="gatewaySkillsetOptions"
                        searchable
                        :aria-label="t('components.settingsDialog.gatewayDefaultSkillset')"
                      />
                    </label>
                  </div>
                  <div class="gateway-folder-manager" :aria-label="t('components.settingsDialog.gatewayWorkingDirectories')">
                    <div class="gateway-folder-toolbar">
                      <div>
                        <h5>{{ t('components.settingsDialog.allowedFolders') }}</h5>
                        <p>{{ t('components.settingsDialog.shownInCwdsAndPwdsUsersSwitch') }}</p>
                      </div>
                      <div class="gateway-folder-actions">
                        <button type="button" class="settings-action-btn compact-action gateway-add-folder-btn" @click="showGatewayFolderPicker = true">{{ t('components.settingsDialog.addFolder') }}</button>
                      </div>
                    </div>
                    <div v-if="draftGatewayCwds.length === 0" class="gateway-empty-state">
                      <strong>{{ t('components.settingsDialog.noGatewayFoldersConfigured') }}</strong>
                      <span>{{ t('components.settingsDialog.gatewaysWillReportAnErrorUntilAt') }}</span>
                    </div>
                    <div v-else class="gateway-cwd-list">
                      <div v-for="(cwd, index) in draftGatewayCwds" :key="cwd" class="gateway-cwd-row">
                        <span class="gateway-cwd-index" aria-hidden="true">{{ index + 1 }}</span>
                        <PhFolder :size="18" weight="bold" class="gateway-cwd-icon" aria-hidden="true" />
                        <span class="gateway-cwd-path" :title="cwd">{{ cwd }}</span>
                        <button type="button" class="gateway-remove-cwd-btn" :aria-label="t('components.settingsDialog.removeGatewayFolder', { cwd })" @click="removeGatewayCwd(cwd)">{{ t('components.settingsDialog.remove') }}</button>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="settings-card gateway-settings weixin-pairing-settings" aria-labelledby="weixin-pairing-title">
                  <div class="weixin-pairing-header">
                    <div class="settings-card-copy">
                      <h4 id="weixin-pairing-title">{{ t('components.settingsDialog.wechatPairing') }}</h4>
                      <p>{{ t('components.settingsDialog.pairATencentILinkWeChatBotAccount') }}</p>
                    </div>
                    <button type="button" class="settings-action-btn weixin-pairing-action" :disabled="weixinPairingLoading" @click="startWeixinPairing">
                      {{ weixinPairingButtonText }}
                    </button>
                  </div>
                  <div class="weixin-status-panel" :aria-label="t('components.settingsDialog.wechatPairingStatus')">
                    <div class="weixin-status-primary">
                      <span class="weixin-status-badge" :class="{ paired: weixinPaired }">{{ weixinPaired ? t('components.settingsDialog.paired') : t('components.settingsDialog.notPaired') }}</span>
                      <span>{{ weixinStatusText }}</span>
                    </div>
                    <dl class="weixin-status-details">
                      <div>
                        <dt>{{ t('components.settingsDialog.gateway') }}</dt>
                        <dd>{{ weixinGatewayRuntimeText }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('components.settingsDialog.envFlag') }}</dt>
                        <dd>{{ weixinGatewayEnvText }}</dd>
                      </div>
                    </dl>
                  </div>
                  <p class="settings-inline-note weixin-pairing-note">
                    {{ t(weixinGatewayStatus.enabled
                      ? 'components.settingsDialog.theGatewayStartsAutomaticallyAfterSuccessfulPairing'
                      : 'components.settingsDialog.pairingSavesCredentialsEnablePIWEBUI') }}
                  </p>
                  <p v-if="weixinPairingError" class="settings-error-text" role="alert">{{ weixinPairingError }}</p>
                  <div v-if="weixinPairing.qrDataUrl" class="weixin-qr-panel">
                    <img :src="weixinPairing.qrDataUrl" :alt="t('components.settingsDialog.weChatPairingQrCode')" class="weixin-qr-image" />
                    <p class="settings-inline-note">{{ t('components.settingsDialog.scanWithWeChatThenConfirmOnYour') }}</p>
                  </div>
                </section>
                <FolderPickerModal
                  :visible="showGatewayFolderPicker"
                  :initial-path="gatewayFolderPickerInitialPath"
                  :client-id="clientId"
                  :title="t('components.settingsDialog.addGatewayFolder')"
                  :show-clone="false"
                  @close="showGatewayFolderPicker = false"
                  @select="addGatewayCwd"
                />
              </template>

              <SecurityPanel v-if="activeSection === 'security'" :totp-enabled="totpEnabled" embedded @updated="emit('updated')" />
              <SkillPresetsPanel
                v-if="activeSection === 'skills'"
                :presets="skillPresets"
                :available-skills="availableSkills"
                @create-preset="emit('createSkillPreset', $event)"
                @update-preset="emit('updateSkillPreset', $event)"
                @delete-preset="emit('deleteSkillPreset', $event)"
              />
            </div>
          </main>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FullscreenShortcut, LanguagePreference, NewSessionShortcut, SoundNotificationPreference, StreamingMessageBehavior, ThemePreference } from '../composables/usePreferences';
import type { AvailableSkill } from '../composables/useAvailableSkills';
import type { SkillPreset, SkillPresetInput } from '../composables/useSkillPresets';
import { PhFolder, PhGitPullRequest, PhLock, PhSliders, PhChatCircle, PhKeyboard, PhPaperPlaneTilt, PhSparkle, PhSpeakerHigh } from '@phosphor-icons/vue';
import { playTaskNotification } from '../services/soundNotifications';
import { formatHomePath } from '../utils/paths';
import DialogCloseButton from './DialogCloseButton.vue';
import { i18n } from '../i18n';
import SecurityPanel from './SecurityPanel.vue';
import SkillPresetsPanel from './SkillPresetsPanel.vue';
import FolderPickerModal from './FolderPickerModal.vue';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';

const t = i18n.global.t;

const props = withDefaults(defineProps<{
  visible: boolean;
  clientId?: string;
  projectPath?: string;
  totpEnabled: boolean;
  showHintInfo: boolean;
  showCodeBlockLanguageHeaders: boolean;
  streamingMessageBehavior: StreamingMessageBehavior;
  editorAutoRefresh: boolean;
  confirmSessionDelete?: boolean;
  newSessionShortcut?: NewSessionShortcut;
  fullscreenShortcut?: FullscreenShortcut;
  showGoToTopButton?: boolean;
  showChatViewOptionsButton?: boolean;
  autoExtractMemory?: boolean;
  theme?: ThemePreference;
  language?: LanguagePreference;
  soundNotification?: SoundNotificationPreference;
  availableSkills?: AvailableSkill[];
  skillPresets?: SkillPreset[];
  giteaServerUrl?: string;
  giteaTokenConfigured?: boolean;
  githubServerUrl?: string;
  githubTokenConfigured?: boolean;
  githubProxyUrl?: string;
  gitCloneParentPath?: string;
  gatewayCwds?: string[];
  gatewayDefaultProfile?: string;
  gatewayDefaultSkillset?: string;
  gatewayDefaultModelProvider?: string;
  gatewayDefaultModelId?: string;
  gatewaySaving?: boolean;
  gatewaySaveSuccessTick?: number;
  gitSaving?: boolean;
  gitSaveSuccessTick?: number;
  githubProxyChecking?: boolean;
  githubProxyCheckResult?: 'ok' | 'failed' | null;
}>(), {
  confirmSessionDelete: true,
  newSessionShortcut: 'ctrlMetaN',
  fullscreenShortcut: 'f11',
  showGoToTopButton: true,
  showChatViewOptionsButton: true,
  autoExtractMemory: false,
  theme: 'system',
  language: 'en',
  soundNotification: 'beep',
  availableSkills: () => [],
  skillPresets: () => [],
  giteaServerUrl: '',
  giteaTokenConfigured: false,
  githubServerUrl: 'https://github.com',
  githubTokenConfigured: false,
  githubProxyUrl: '',
  gitCloneParentPath: '~/git/github',
  gatewayCwds: () => [],
  gatewayDefaultProfile: '',
  gatewayDefaultSkillset: '',
  gatewayDefaultModelProvider: '',
  gatewayDefaultModelId: '',
  gatewaySaving: false,
  gatewaySaveSuccessTick: 0,
  gitSaving: false,
  gitSaveSuccessTick: 0,
  githubProxyChecking: false,
  githubProxyCheckResult: null,
  clientId: '',
  projectPath: '~',
});

const projectDisplayPath = computed(() => formatHomePath(props.projectPath));

const themeOptions = computed<CustomSelectOption[]>(() => [
  { value: 'system', label: t('settings.theme.system') },
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'light', label: t('settings.theme.light') },
]);
const languageOptions = computed<CustomSelectOption[]>(() => [
  { value: 'en', label: t('settings.language.english') },
  { value: 'zh-CN', label: t('settings.language.chinese') },
]);
const streamingBehaviorOptions = computed<CustomSelectOption[]>(() => [
  { value: 'steer', label: t('settings.chat.steer') },
  { value: 'followUp', label: t('settings.chat.followUp') },
]);
const soundNotificationOptions = computed<CustomSelectOption[]>(() => [
  { value: 'beep', label: t('settings.chat.beep') },
  { value: 'chime', label: t('settings.chat.chime') },
  { value: 'ding', label: t('settings.chat.ding') },
  { value: 'off', label: t('settings.chat.off') },
]);
const newSessionShortcutOptions = computed<CustomSelectOption[]>(() => [
  { value: 'ctrlMetaN', label: 'Ctrl+⌘+N / Ctrl+Win+N' },
  { value: 'ctrlAltN', label: 'Ctrl+Alt+N' },
  { value: 'disabled', label: t('settings.keyboard.disabled') },
]);
const fullscreenShortcutOptions: CustomSelectOption[] = [
  { value: 'f11', label: 'F11' },
  { value: 'ctrlShiftF', label: 'Ctrl+Shift+F' },
];

const activeSection = ref<'general' | 'security' | 'chat' | 'keyboard' | 'skills' | 'git' | 'gateway'>('general');
const draftGiteaServerUrl = ref(props.giteaServerUrl);
const draftGiteaToken = ref('');
const draftGithubServerUrl = ref(props.githubServerUrl);
const draftGithubToken = ref('');
const draftGitCloneParentPath = ref(props.gitCloneParentPath);
const draftGithubProxyUrl = ref(props.githubProxyUrl);
const draftGatewayCwds = ref(normalizeGatewayCwds(props.gatewayCwds));
const draftGatewayDefaultProfile = ref(props.gatewayDefaultProfile);
const draftGatewayDefaultSkillset = ref(props.gatewayDefaultSkillset);
const draftGatewayDefaultModel = ref(formatGatewayModelValue(props.gatewayDefaultModelProvider, props.gatewayDefaultModelId));
const gatewayProfiles = ref<GatewayProfile[]>([]);
const gatewayModels = ref<GatewayModel[]>([]);
const gatewayModelsLoading = ref(false);
const showGatewayFolderPicker = ref(false);
const gitSavedVisible = ref(false);
const gatewaySavedVisible = ref(false);
const globalSystemPrompt = ref('');
const globalUserPrompt = ref('');
const projectSystemPrompt = ref('');
const projectUserPrompt = ref('');
const effectiveSystemPrompt = ref('');
const effectiveUserPrompt = ref('');
const commitPromptsSaving = ref(false);
const commitPromptsSaved = ref(false);
const commitPromptError = ref('');

interface GitSettingsSavePayload {
  gitea?: { serverUrl: string; token: string };
  github?: { serverUrl: string; token: string };
  gitCloneParentPath?: string;
  githubProxyUrl?: string;
}

interface GatewaySettingsSavePayload {
  cwds: string[];
  defaultProfile: string;
  defaultSkillset: string;
  defaultModelProvider: string;
  defaultModelId: string;
}

interface GatewayProfile {
  id: string;
  label?: string;
}

interface GatewayModel {
  provider: string;
  id: string;
  name?: string;
  current?: boolean;
}

interface WeixinPairingState {
  status: 'idle' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
  qrDataUrl?: string;
  accountId?: string;
  error?: string;
}

interface WeixinGatewayStatus {
  enabled: boolean;
  running: boolean;
  configured?: boolean;
  paired?: boolean;
  accountId?: string;
  baseUrl?: string;
}

const weixinPairing = ref<WeixinPairingState>({ status: 'idle' });
const weixinGatewayStatus = ref<WeixinGatewayStatus>({ enabled: false, running: false });
const weixinPairingLoading = ref(false);
const weixinPairingError = ref('');
let weixinPairingPoll: number | undefined;

const giteaDirty = computed(() => draftGiteaServerUrl.value !== props.giteaServerUrl || Boolean(draftGiteaToken.value));
const githubDirty = computed(() => draftGithubServerUrl.value !== props.githubServerUrl || Boolean(draftGithubToken.value));
const cloneRootDirty = computed(() => draftGitCloneParentPath.value !== props.gitCloneParentPath);
const githubProxyDirty = computed(() => draftGithubProxyUrl.value !== props.githubProxyUrl);
const gitDirty = computed(() => giteaDirty.value || githubDirty.value || cloneRootDirty.value || githubProxyDirty.value);
const gitSaveButtonText = computed(() => {
  if (props.gitSaving) return t('components.settingsDialog.saving');
  if (gitSavedVisible.value) return t('components.settingsDialog.saved');
  return gitDirty.value ? t('components.settingsDialog.saveChanges') : t('components.settingsDialog.saved2');
});
const gatewayFolderPickerInitialPath = computed(() => draftGatewayCwds.value[0] || '~');
const gatewayProfileOptions = computed<CustomSelectOption[]>(() => withCurrentOption([
  { value: '', label: 'default' },
  ...gatewayProfiles.value.map((profile) => ({ value: profile.id, label: profile.label || profile.id })),
], draftGatewayDefaultProfile.value));
const gatewayModelOptions = computed<CustomSelectOption[]>(() => withCurrentOption([
  { value: '', label: t('components.settingsDialog.profileDefault') },
  ...gatewayModels.value.map((model) => ({ value: formatGatewayModelValue(model.provider, model.id), label: `${model.name || model.id} [${model.provider}]` })),
], draftGatewayDefaultModel.value));
const gatewaySkillsetOptions = computed<CustomSelectOption[]>(() => withCurrentOption([
  { value: '', label: t('components.settingsDialog.allUseAllSkills') },
  ...props.skillPresets.map((preset) => ({ value: preset.id, label: `${preset.name} (${preset.mode})` })),
], draftGatewayDefaultSkillset.value));
const gatewayDirty = computed(() => (
  formatGatewayCwds(draftGatewayCwds.value) !== formatGatewayCwds(props.gatewayCwds)
  || draftGatewayDefaultProfile.value !== props.gatewayDefaultProfile
  || draftGatewayDefaultSkillset.value !== props.gatewayDefaultSkillset
  || draftGatewayDefaultModel.value !== formatGatewayModelValue(props.gatewayDefaultModelProvider, props.gatewayDefaultModelId)
));
const gatewaySaveButtonText = computed(() => {
  if (props.gatewaySaving) return t('components.settingsDialog.saving');
  if (gatewaySavedVisible.value) return t('components.settingsDialog.saved');
  return gatewayDirty.value ? t('components.settingsDialog.saveChanges') : t('components.settingsDialog.saved2');
});
const weixinPaired = computed(() => weixinPairing.value.status === 'confirmed' || Boolean(weixinGatewayStatus.value.paired));
const weixinPairingButtonText = computed(() => {
  if (weixinPairingLoading.value) return t('components.settingsDialog.starting');
  return weixinPaired.value ? t('components.settingsDialog.pairAgain') : t('components.settingsDialog.startQrPairing');
});
const weixinGatewayRuntimeText = computed(() => (weixinGatewayStatus.value.running ? t('components.settingsDialog.running') : t('components.settingsDialog.notRunning')));
const weixinGatewayEnvText = computed(() => (weixinGatewayStatus.value.enabled ? t('components.settingsDialog.enabled') : t('components.settingsDialog.disabled')));
const weixinStatusText = computed(() => {
  if (weixinPairing.value.status === 'confirmed') return t('components.settingsDialog.pairedAs', { account: weixinPairing.value.accountId || t('components.settingsDialog.savedAccount') });
  if (weixinPairing.value.status === 'scanned') return t('components.settingsDialog.scannedWaitingForPhoneConfirmation');
  if (weixinPairing.value.status === 'waiting') return t('components.settingsDialog.waitingForScan');
  if (weixinPairing.value.status === 'expired') return t('components.settingsDialog.qrExpiredStartPairingAgain');
  if (weixinPairing.value.status === 'error') return t('components.settingsDialog.pairingFailed');
  if (weixinGatewayStatus.value.paired) return t('components.settingsDialog.pairedAs', { account: weixinGatewayStatus.value.accountId || t('components.settingsDialog.savedAccount') });
  return t('components.settingsDialog.noPairedWechatAccountSavedYet');
});

function resetGitDrafts() {
  draftGiteaServerUrl.value = props.giteaServerUrl;
  draftGiteaToken.value = '';
  draftGithubServerUrl.value = props.githubServerUrl;
  draftGithubToken.value = '';
  draftGitCloneParentPath.value = props.gitCloneParentPath;
  draftGithubProxyUrl.value = props.githubProxyUrl;
}

function resetGatewayDrafts() {
  draftGatewayCwds.value = normalizeGatewayCwds(props.gatewayCwds);
  draftGatewayDefaultProfile.value = props.gatewayDefaultProfile;
  draftGatewayDefaultSkillset.value = props.gatewayDefaultSkillset;
  draftGatewayDefaultModel.value = formatGatewayModelValue(props.gatewayDefaultModelProvider, props.gatewayDefaultModelId);
  showGatewayFolderPicker.value = false;
}

function requestClose() {
  if (gitDirty.value && !window.confirm(t('components.settingsDialog.youHaveUnsavedGitIntegrationChangesClose'))) return;
  if (gatewayDirty.value && !window.confirm(t('components.settingsDialog.youHaveUnsavedGatewayChangesCloseWithout'))) return;
  emit('close');
}

function saveGitSettings() {
  if (!gitDirty.value || props.gitSaving) return;
  const payload: GitSettingsSavePayload = {};
  if (giteaDirty.value) payload.gitea = { serverUrl: draftGiteaServerUrl.value, token: draftGiteaToken.value };
  if (githubDirty.value) payload.github = { serverUrl: draftGithubServerUrl.value, token: draftGithubToken.value };
  if (cloneRootDirty.value) payload.gitCloneParentPath = draftGitCloneParentPath.value;
  if (githubProxyDirty.value) payload.githubProxyUrl = draftGithubProxyUrl.value;
  emit('saveGitSettings', payload);
}

interface CommitPromptResponse {
  global: { systemPrompt?: string; userPrompt?: string };
  project: { systemPrompt?: string; userPrompt?: string };
  effective: { systemPrompt: string; userPrompt: string };
}

function applyCommitPrompts(data: CommitPromptResponse) {
  globalSystemPrompt.value = data.global.systemPrompt || '';
  globalUserPrompt.value = data.global.userPrompt || '';
  projectSystemPrompt.value = data.project.systemPrompt || '';
  projectUserPrompt.value = data.project.userPrompt || '';
  effectiveSystemPrompt.value = data.effective.systemPrompt;
  effectiveUserPrompt.value = data.effective.userPrompt;
}

async function loadCommitPrompts() {
  commitPromptError.value = '';
  const response = await fetch(`/api/git/commit-message-prompts?cwd=${encodeURIComponent(props.projectPath)}`);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Failed to load commit message prompts');
  applyCommitPrompts(await response.json());
}

async function saveCommitPrompts(scope: 'global' | 'project') {
  commitPromptsSaving.value = true;
  commitPromptError.value = '';
  commitPromptsSaved.value = false;
  try {
    const response = await fetch('/api/git/commit-message-prompts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd: props.projectPath,
        scope,
        systemPrompt: scope === 'global' ? globalSystemPrompt.value : projectSystemPrompt.value,
        userPrompt: scope === 'global' ? globalUserPrompt.value : projectUserPrompt.value,
      }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Failed to save commit message prompts');
    applyCommitPrompts(await response.json());
    commitPromptsSaved.value = true;
    window.setTimeout(() => { commitPromptsSaved.value = false; }, 1800);
  } catch (error) {
    commitPromptError.value = error instanceof Error ? error.message : 'Failed to save commit message prompts';
  } finally {
    commitPromptsSaving.value = false;
  }
}

function saveGatewaySettings() {
  if (!gatewayDirty.value || props.gatewaySaving) return;
  const model = parseGatewayModelValue(draftGatewayDefaultModel.value);
  emit('saveGatewaySettings', {
    cwds: draftGatewayCwds.value,
    defaultProfile: draftGatewayDefaultProfile.value,
    defaultSkillset: draftGatewayDefaultSkillset.value,
    defaultModelProvider: model.provider,
    defaultModelId: model.id,
  });
}

function setDraftGatewayDefaultProfile(value: string): void {
  if (draftGatewayDefaultProfile.value === value) return;
  draftGatewayDefaultProfile.value = value;
  draftGatewayDefaultModel.value = '';
  void loadGatewayModels().catch(() => undefined);
}

function addGatewayCwd(payload: { path: string }) {
  const path = payload.path.trim();
  if (!path) return;
  draftGatewayCwds.value = normalizeGatewayCwds([...draftGatewayCwds.value, path]);
  showGatewayFolderPicker.value = false;
}

function removeGatewayCwd(cwd: string) {
  draftGatewayCwds.value = draftGatewayCwds.value.filter((path) => path !== cwd);
}

async function loadGatewayProfiles() {
  const response = await fetch('/api/sessions/agent-profiles');
  const data = await response.json().catch(() => ({})) as { profiles?: GatewayProfile[] };
  if (response.ok) gatewayProfiles.value = data.profiles || [];
}

async function loadGatewayModels() {
  const profileId = draftGatewayDefaultProfile.value || 'default';
  gatewayModelsLoading.value = true;
  try {
    const response = await fetch(`/api/sessions/agent-profiles/${encodeURIComponent(profileId)}/models`);
    const data = await response.json().catch(() => ({})) as { models?: GatewayModel[] };
    gatewayModels.value = response.ok ? data.models || [] : [];
  } finally {
    gatewayModelsLoading.value = false;
  }
}

async function loadWeixinGatewayStatus() {
  const data = await gatewayRequest<{ status: WeixinGatewayStatus }>('/api/gateways/weixin/status');
  weixinGatewayStatus.value = data.status;
}

async function loadWeixinPairingState() {
  const data = await gatewayRequest<{ pairing: WeixinPairingState }>('/api/gateways/weixin/pairing');
  weixinPairing.value = data.pairing;
}

async function loadWeixinState() {
  await Promise.all([
    loadWeixinGatewayStatus(),
    loadWeixinPairingState(),
  ]);
}

async function startWeixinPairing() {
  weixinPairingLoading.value = true;
  weixinPairingError.value = '';
  try {
    const data = await gatewayRequest<{ pairing: WeixinPairingState }>('/api/gateways/weixin/pairing', 'POST');
    weixinPairing.value = data.pairing;
    await loadWeixinGatewayStatus().catch(() => undefined);
    startWeixinPairingPoll();
  } catch (error) {
    weixinPairingError.value = error instanceof Error ? error.message : t('components.settingsDialog.failedToStartWechatPairing');
  } finally {
    weixinPairingLoading.value = false;
  }
}

function startWeixinPairingPoll() {
  window.clearInterval(weixinPairingPoll);
  weixinPairingPoll = window.setInterval(async () => {
    try {
      await loadWeixinPairingState();
      if (['confirmed', 'expired', 'error', 'idle'].includes(weixinPairing.value.status)) {
        window.clearInterval(weixinPairingPoll);
        await loadWeixinGatewayStatus().catch(() => undefined);
      }
    } catch {
      window.clearInterval(weixinPairingPoll);
    }
  }, 1500);
}

async function gatewayRequest<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || t('components.settingsDialog.gatewayRequestFailed', { status: response.status }));
  return data as T;
}

function withCurrentOption(options: CustomSelectOption[], currentValue: string): CustomSelectOption[] {
  const unique = options.filter((option, index) => options.findIndex((item) => item.value === option.value) === index);
  if (!currentValue || unique.some((option) => option.value === currentValue)) return unique;
  return [...unique, { value: currentValue, label: currentValue }];
}

function normalizeGatewayCwds(cwds?: string[]): string[] {
  return Array.from(new Set((cwds || []).map((path) => path.trim()).filter(Boolean)));
}

function formatGatewayCwds(cwds?: string[]): string {
  return normalizeGatewayCwds(cwds).join('\n');
}

function formatGatewayModelValue(provider?: string, modelId?: string): string {
  return provider && modelId ? `${provider}\u0000${modelId}` : '';
}

function parseGatewayModelValue(value: string): { provider: string; id: string } {
  const [provider = '', id = ''] = value.split('\u0000');
  return { provider, id };
}

watch(() => props.visible, (visible) => {
  if (visible) {
    resetGitDrafts();
    resetGatewayDrafts();
    if (activeSection.value === 'git') {
      void loadCommitPrompts().catch((error) => { commitPromptError.value = error instanceof Error ? error.message : String(error); });
    }
    if (activeSection.value === 'gateway') {
      void loadGatewayProfiles().catch(() => undefined);
      void loadGatewayModels().catch(() => undefined);
    }
  } else {
    window.clearInterval(weixinPairingPoll);
  }
});

watch(activeSection, (section) => {
  if (section === 'git') {
    void loadCommitPrompts().catch((error) => { commitPromptError.value = error instanceof Error ? error.message : String(error); });
  }
  if (section !== 'gateway') return;
  void loadGatewayProfiles().catch(() => undefined);
  void loadGatewayModels().catch(() => undefined);
  void loadWeixinState().catch(() => undefined);
});

watch(() => props.projectPath, () => {
  if (props.visible && activeSection.value === 'git') {
    void loadCommitPrompts().catch((error) => { commitPromptError.value = error instanceof Error ? error.message : String(error); });
  }
});

watch(() => props.giteaServerUrl, (value, oldValue) => {
  if (draftGiteaServerUrl.value === oldValue) draftGiteaServerUrl.value = value;
});

watch(() => props.githubServerUrl, (value, oldValue) => {
  if (draftGithubServerUrl.value === oldValue) draftGithubServerUrl.value = value;
});

watch(() => props.gitCloneParentPath, (value, oldValue) => {
  if (draftGitCloneParentPath.value === oldValue) draftGitCloneParentPath.value = value;
});

watch(() => props.githubProxyUrl, (value, oldValue) => {
  if (draftGithubProxyUrl.value === oldValue) draftGithubProxyUrl.value = value;
});

watch(() => props.gatewayCwds, (value, oldValue) => {
  if (formatGatewayCwds(draftGatewayCwds.value) === formatGatewayCwds(oldValue)) draftGatewayCwds.value = normalizeGatewayCwds(value);
});

watch(() => props.gatewayDefaultProfile, (value, oldValue) => {
  if (draftGatewayDefaultProfile.value === oldValue) draftGatewayDefaultProfile.value = value;
});

watch(() => props.gatewayDefaultSkillset, (value, oldValue) => {
  if (draftGatewayDefaultSkillset.value === oldValue) draftGatewayDefaultSkillset.value = value;
});

watch(() => [props.gatewayDefaultModelProvider, props.gatewayDefaultModelId], ([provider, modelId], [oldProvider, oldModelId]) => {
  if (draftGatewayDefaultModel.value === formatGatewayModelValue(oldProvider, oldModelId)) {
    draftGatewayDefaultModel.value = formatGatewayModelValue(provider, modelId);
  }
});

watch(() => props.gitSaveSuccessTick, () => {
  if (!props.gitSaveSuccessTick) return;
  resetGitDrafts();
  gitSavedVisible.value = true;
  window.setTimeout(() => { gitSavedVisible.value = false; }, 1800);
});

watch(() => props.gatewaySaveSuccessTick, () => {
  if (!props.gatewaySaveSuccessTick) return;
  resetGatewayDrafts();
  gatewaySavedVisible.value = true;
  window.setTimeout(() => { gatewaySavedVisible.value = false; }, 1800);
});
const sectionHeading = computed(() => {
  if (activeSection.value === 'general') return t('settings.sections.general');
  if (activeSection.value === 'security') return t('settings.sections.securityHeading');
  if (activeSection.value === 'keyboard') return t('settings.sections.keyboardHeading');
  if (activeSection.value === 'skills') return t('settings.sections.skillsHeading');
  if (activeSection.value === 'git') return t('settings.sections.gitHeading');
  if (activeSection.value === 'gateway') return t('settings.sections.gateway');
  return t('settings.sections.chatHeading');
});

const emit = defineEmits<{
  close: [];
  updated: [];
  'update:showHintInfo': [value: boolean];
  'update:showCodeBlockLanguageHeaders': [value: boolean];
  'update:streamingMessageBehavior': [value: StreamingMessageBehavior];
  'update:editorAutoRefresh': [value: boolean];
  'update:confirmSessionDelete': [value: boolean];
  'update:newSessionShortcut': [value: NewSessionShortcut];
  'update:fullscreenShortcut': [value: FullscreenShortcut];
  'update:showGoToTopButton': [value: boolean];
  'update:showChatViewOptionsButton': [value: boolean];
  'update:autoExtractMemory': [value: boolean];
  'update:theme': [value: ThemePreference];
  'update:language': [value: LanguagePreference];
  'update:soundNotification': [value: SoundNotificationPreference];
  'update:gitCloneParentPath': [value: string];
  createSkillPreset: [payload: SkillPresetInput];
  updateSkillPreset: [payload: { id: string; changes: SkillPresetInput }];
  deleteSkillPreset: [id: string];
  clearLaunchCache: [];
  saveGitSettings: [payload: GitSettingsSavePayload];
  saveGatewaySettings: [payload: GatewaySettingsSavePayload];
  clearGiteaSettings: [];
  testGiteaConnection: [payload: { serverUrl: string; token: string }];
  clearGithubSettings: [];
  testGithubConnection: [payload: { serverUrl: string; token: string }];
  testGithubProxy: [value: string];
}>();
</script>

<style scoped>
.commit-prompt-settings {
  align-items: stretch;
  flex-direction: column;
}

.commit-prompt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
  gap: 1rem;
  width: 100%;
}

.commit-prompt-scope {
  display: grid;
  align-content: start;
  gap: 0.875rem;
  min-width: 0;
  margin: 0;
  padding: 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.commit-prompt-scope legend {
  max-width: calc(100% - 1rem);
  padding: 0 0.35rem;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.4;
}

.commit-prompt-project-path {
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 400;
  overflow-wrap: anywhere;
}

.commit-prompt-scope .settings-action-btn {
  justify-self: end;
}

.commit-prompt-textarea {
  min-height: 7rem;
  line-height: 1.45;
  resize: vertical;
}

.commit-prompt-textarea.large {
  min-height: 11rem;
}

.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(5px);
}

.settings-dialog {
  width: min(980px, calc(100vw - 2rem));
  height: min(720px, calc(100vh - 2rem));
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.settings-sidebar {
  min-height: 0;
  overflow: auto;
  padding: 1.25rem;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.settings-sidebar h2 {
  margin: 0 0 1.25rem;
  color: var(--text-primary);
  font-size: 1.125rem;
}

.settings-menu {
  display: grid;
  gap: 0.5rem;
}

.settings-menu-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.75rem;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  text-align: left;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.settings-menu-item:hover {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.settings-menu-item.active {
  color: var(--text-primary);
  background: var(--bg-surface);
  border-color: var(--border);
}

.settings-menu-icon {
  flex: 0 0 auto;
  color: inherit;
}

.settings-body {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.settings-body-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.5rem 1.5rem 1rem;
  border-bottom: 1px solid var(--border);
}

.settings-body-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.25rem;
}

.settings-content {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 1.5rem;
}

.settings-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 1rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.settings-card-copy h4 {
  margin: 0 0 0.375rem;
  color: var(--text-primary);
  font-size: 1rem;
}

.settings-card-copy p:last-child {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.45;
}

.settings-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
}

.settings-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.settings-switch-track {
  position: relative;
  width: 2.75rem;
  height: 1.5rem;
  flex: 0 0 auto;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  transition: background var(--duration-normal) var(--ease-out),
              border-color var(--duration-normal) var(--ease-out);
}

.settings-switch-track::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 1rem;
  height: 1rem;
  background: var(--text-secondary);
  border-radius: 50%;
  transition: transform var(--duration-normal) var(--ease-out),
              background var(--duration-normal) var(--ease-out);
}

.settings-switch input:checked + .settings-switch-track {
  background: color-mix(in srgb, var(--accent) 30%, var(--bg-surface));
  border-color: var(--accent);
}

.settings-switch input:checked + .settings-switch-track::after {
  transform: translateX(1.25rem);
  background: var(--accent);
}

.settings-switch input:focus-visible + .settings-switch-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.settings-select-label {
  min-width: min(22rem, 100%);
}

:where(.theme-settings) .settings-select-label {
  min-width: 0;
  width: min(10rem, 100%);
}

.keyboard-shortcut-select-label {
  min-width: 0;
  width: min(14rem, 100%);
}

.settings-inline-control {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: nowrap;
}

.sound-notification-control .settings-select-label {
  min-width: 12rem;
}

.settings-select {
  width: 100%;
  padding: 0.65rem 0.8rem;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.settings-select:hover {
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}

.settings-select:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.settings-select option {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.settings-action-btn {
  flex: 0 0 auto;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  cursor: pointer;
}

.settings-action-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
}

.settings-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.settings-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.settings-icon-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}

.settings-icon-btn:active:not(:disabled) {
  transform: scale(0.94);
}

.settings-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.git-settings {
  align-items: stretch;
  flex-direction: column;
}

.git-settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
}

.git-settings-header .settings-card-copy {
  min-width: 0;
}

.git-settings-summary {
  margin-top: 0.5rem;
}

.settings-save-btn {
  min-width: 8.5rem;
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.settings-save-btn.saved {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 50%, var(--border));
  background: color-mix(in srgb, var(--success) 12%, var(--bg-surface));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 12%, transparent);
}

.git-save-success {
  margin: -0.25rem 0 0;
  padding: 0.65rem 0.8rem;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--success) 35%, var(--border));
  border-radius: var(--radius-md);
  font-size: 0.85rem;
}

.git-settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
  gap: 1rem;
  width: 100%;
}

.git-clone-root-field {
  width: 100%;
}

.git-clone-root-row {
  display: flex;
  gap: 0.5rem;
}

.git-clone-root-row .settings-input {
  flex: 1 1 auto;
}

.git-clone-root-row .settings-action-btn {
  flex: 0 0 auto;
}

.git-provider-card {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.git-provider-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--text-primary);
}

.git-provider-status {
  flex: 0 0 auto;
  padding: 0.2rem 0.5rem;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
}

.git-provider-status.configured {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-surface));
}

.git-settings-field {
  display: grid;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.settings-input {
  width: 100%;
  padding: 0.65rem 0.8rem;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.gateway-settings {
  align-items: stretch;
  flex-direction: column;
}

.gateway-settings-header {
  gap: 1rem;
}

.gateway-defaults-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(16rem, 28rem));
  justify-content: start;
  gap: 0.75rem 1.5rem;
}

.gateway-default-field {
  max-width: 28rem;
}

.gateway-default-note {
  margin: -0.25rem 0 0;
}

.gateway-folder-manager {
  display: grid;
  gap: 0.75rem;
}

.gateway-folder-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.gateway-folder-toolbar h5 {
  margin: 0 0 0.25rem;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.gateway-folder-toolbar p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.4;
}

.gateway-folder-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
}

.gateway-empty-state {
  display: grid;
  gap: 0.35rem;
  padding: 1rem;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}

.gateway-empty-state strong {
  color: var(--text-primary);
}

.gateway-cwd-list {
  display: grid;
  gap: 0.5rem;
}

.gateway-cwd-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.6rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.gateway-cwd-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--accent);
  background: var(--accent-muted);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 700;
}

.gateway-cwd-icon {
  color: var(--text-secondary);
}

.gateway-cwd-path {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 0.82rem;
  line-height: 1.3;
  white-space: normal;
}

.gateway-remove-cwd-btn {
  padding: 0.35rem 0.55rem;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.gateway-remove-cwd-btn:hover {
  color: var(--error);
  border-color: color-mix(in srgb, var(--error) 45%, var(--border));
}

.gateway-add-folder-btn {
  white-space: nowrap;
}

.weixin-pairing-settings {
  gap: 0.9rem;
}

.weixin-pairing-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.weixin-pairing-action {
  flex: 0 0 auto;
}

.weixin-status-panel {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.weixin-status-primary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  color: var(--text-primary);
}

.weixin-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 700;
}

.weixin-status-badge.paired {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-surface));
}

.weixin-status-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.weixin-status-details div {
  display: grid;
  gap: 0.2rem;
}

.weixin-status-details dt {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.weixin-status-details dd {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.weixin-qr-panel {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
}

.weixin-qr-image {
  width: 180px;
  height: 180px;
  padding: 0.5rem;
  background: white;
  border-radius: var(--radius-md);
}

.settings-error-text {
  margin: 0;
  color: var(--error);
  font-size: 0.875rem;
}

.settings-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.git-proxy-check-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.git-check-ok {
  color: var(--success);
  font-weight: 700;
}

.git-check-failed {
  color: var(--error);
  font-weight: 700;
}

.settings-inline-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.keyboard-shortcuts-card {
  align-items: flex-start;
}

.keyboard-shortcuts-copy {
  width: 100%;
}

.keyboard-shortcut-list {
  display: grid;
  gap: 0.625rem;
  margin: 1rem 0 0;
}

.keyboard-shortcut-list div {
  display: grid;
  grid-template-columns: minmax(8rem, max-content) 1fr;
  align-items: center;
  gap: 1rem;
}

.keyboard-shortcut-list dt,
.keyboard-shortcut-list dd {
  margin: 0;
}

.keyboard-shortcut-list dt {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.keyboard-shortcut-list dd {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.keyboard-shortcut-list kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.65rem;
  padding: 0.18rem 0.45rem;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-bottom-color: var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.18);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 0.18s ease;
}

.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}

@media (max-width: 760px) {
  .commit-prompt-grid {
    grid-template-columns: 1fr;
  }

  .settings-backdrop {
    padding: 0.5rem;
  }

  .settings-dialog {
    width: calc(100vw - 1rem);
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    height: min(760px, calc(100vh - 1rem));
  }

  .settings-sidebar {
    padding: 0.75rem;
    overflow: hidden;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .settings-sidebar h2 {
    margin-bottom: 0.625rem;
    font-size: 1rem;
  }

  .settings-menu {
    display: flex;
    gap: 0.375rem;
    overflow-x: auto;
    padding-bottom: 0.125rem;
    scrollbar-width: none;
  }

  .settings-menu::-webkit-scrollbar {
    display: none;
  }

  .settings-menu-item {
    flex: 0 0 auto;
    width: auto;
    padding: 0.55rem 0.7rem;
    white-space: nowrap;
  }

  .settings-body-header {
    padding: 1rem;
  }

  .settings-content {
    padding: 1rem;
  }

  .settings-card {
    align-items: stretch;
    flex-direction: column;
  }

  .settings-select-label {
    min-width: 0;
    width: 100%;
  }

  .gateway-defaults-grid {
    grid-template-columns: 1fr;
  }

  .gateway-folder-toolbar,
  .gateway-folder-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .gateway-cwd-row {
    grid-template-columns: auto auto minmax(0, 1fr);
  }

  .gateway-remove-cwd-btn {
    grid-column: 3;
    justify-self: start;
  }

  .weixin-pairing-header {
    align-items: stretch;
    flex-direction: column;
  }

  .weixin-status-details {
    grid-template-columns: 1fr;
  }
}
</style>
