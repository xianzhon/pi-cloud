<!-- client/src/App.vue -->
<template>
  <LoginView v-if="!loading && !isAuthenticated" />
  <div v-else-if="loading" class="app-loading">{{ t('app.loading') }}</div>
  <div v-else class="app">
    <!-- Mobile sidebar backdrop -->
    <div
      v-if="showMobileSidebar"
      class="mobile-sidebar-backdrop"
      @click="showMobileSidebar = false"
    />
    <div
      v-if="showMobileActions"
      class="mobile-actions-backdrop"
      @click="showMobileActions = false"
    />

    <nav class="app-utility-rail" :aria-label="t('app.toggleSidebar')">
      <span
        class="sidebar-logo"
        :class="{ connected: isConnected }"
        :title="isConnected ? t('app.connected') : t('app.disconnected')"
        :aria-label="isConnected ? t('app.connected') : t('app.disconnected')"
        role="status"
      >
        <img src="/icon.svg" alt="" />
        <span class="connection-badge" aria-hidden="true"></span>
      </span>

      <div class="utility-rail-group utility-rail-primary">
        <button v-if="!isReviewMode" class="utility-rail-btn tooltip" type="button" data-rail-action="new-session" :data-tooltip="newSessionTooltip" :aria-label="t('app.newSession')" @click="openTitleBarNew">
          <PhPlus :size="19" weight="bold" />
        </button>
        <button class="utility-rail-btn search-btn tooltip" type="button" data-rail-action="search" :data-tooltip="t('app.searchShortcut')" :aria-label="t('app.search')" @click="openSearch">
          <PhMagnifyingGlass :size="19" weight="bold" />
        </button>
        <button class="utility-rail-btn tooltip" :class="{ active: !sidebarCollapsed }" type="button" data-rail-action="expand" :data-tooltip="sidebarToggleTooltip" :aria-label="t('app.toggleSidebar')" @click="toggleSidebarCollapsed">
          <PhSidebarSimple :size="19" weight="bold" />
        </button>
      </div>

      <div v-if="sidebarCollapsed" class="utility-rail-sessions" aria-label="Sessions" @scroll="handleCompactSessionScroll">
        <button
          v-for="session in compactSessions"
          :key="session.id"
          type="button"
          class="utility-rail-session"
          :class="{ active: session.id === activeSessionId || session.id === activeReviewSession?.sessionId }"
          :title="session.title"
          :aria-label="session.title"
          @click="selectCompactSession(session)"
          @contextmenu.prevent="showCompactSessionContextMenu($event, session.id)"
        >
          <span>{{ sessionInitial(session.title) }}</span>
          <span v-if="session.isStreaming" class="utility-session-status streaming" aria-hidden="true"></span>
          <span v-else-if="readySessionIds.has(session.id)" class="utility-session-status ready" aria-hidden="true"></span>
        </button>
      </div>

      <div class="utility-rail-group utility-rail-bottom">
        <button v-if="!isReviewMode" class="utility-rail-btn tooltip" :class="{ active: showTerminal }" type="button" data-rail-action="terminal" :data-tooltip="terminalTooltip" :aria-label="t('app.terminal')" @click="toggleTerminalPanel">
          <PhTerminal :size="19" weight="bold" />
        </button>
        <button v-if="!isReviewMode" class="utility-rail-btn tooltip" :class="{ active: showGitTool }" type="button" data-rail-action="git" :data-tooltip="t('app.git')" :aria-label="t('app.git')" @click="toggleGitTool">
          <PhGitBranch :size="19" weight="bold" />
        </button>
        <button
          class="utility-rail-btn sidebar-memory-btn tooltip"
          :class="{ 'has-error': memoryHasError }"
          type="button"
          data-rail-action="memory"
          :data-tooltip="t('app.memory')"
          :aria-label="t('app.memory')"
          @click="openMemoryCenter"
        >
          <PhBrain :size="19" weight="bold" />
          <span v-if="memoryPendingCount > 0" class="memory-pending-badge" aria-hidden="true">{{ memoryPendingCount > 99 ? '99+' : memoryPendingCount }}</span>
          <span v-if="memoryHasError" class="memory-error-indicator" aria-hidden="true"></span>
        </button>
        <button class="utility-rail-btn tooltip" type="button" data-rail-action="settings" :data-tooltip="t('app.settings')" :aria-label="t('app.settings')" @click="openSettings">
          <PhGear :size="19" weight="bold" />
        </button>
      </div>
    </nav>

    <SessionSidebar
      ref="sessionSidebarRef"
      :clientId="clientId"
      :username="user?.username"
      :activeSessionId="activeSessionId"
      :activeReviewSessionId="activeReviewSession?.sessionId"
      :readySessionIds="readySessionIdList"
      :class="{ 'mobile-open': showMobileSidebar }"
      @selectSession="selectSession"
      @reviewSourceSelected="handleReviewSourceSelected"
      @reviewSessionSelected="handleReviewSessionSelected"
      @createSessionWithSameSettings="createSessionWithSameSettings"
      @projectPathChanged="handleProjectPathChanged"
      @agentProfileChanged="handleAgentProfileChanged"
      @sessionDeleted="handleSessionDeleted"
      @initialized="handleSidebarInitialized"
      @sessions-changed="compactSessions = $event"
      :collapsed="sidebarCollapsed"
      @extract-memories="extractSessionMemories"
      @logout="logout"
      @close="showMobileSidebar = false"
    >
      <template #tool-panel>
        <GitToolPanel
          v-if="showGitTool && !isReviewMode"
          :cwd="activeProjectPath"
          @command="submitGitCommand"
        />
      </template>
    </SessionSidebar>
    
    <main class="main">
      <header class="header">
        <div class="header-title">
          <input
            v-if="editingSessionTitle"
            ref="sessionTitleInput"
            v-model="sessionTitleDraft"
            class="session-title-input"
            :aria-label="t('components.sessionSidebar.renameSession')"
            @keydown.enter.prevent="saveSessionTitle"
            @keydown.esc.prevent="cancelSessionTitleEdit"
            @blur="saveSessionTitle"
          />
          <span v-else class="session-title-text" :title="headerTitle" @dblclick="beginSessionTitleEdit">{{ headerTitle }}</span>
          <span class="header-metadata">
            <button
              v-if="canSwitchToSessionProject"
              type="button"
              class="session-cwd session-cwd-switch"
              :title="t('app.switchProjectTitle', { path: sessionCwd })"
              @click.stop="switchToSessionProject"
            >
              <PhFolderSimple :size="13" weight="bold" aria-hidden="true" />
              <span class="session-cwd-switch-path">{{ headerProjectName }}</span>
              <span class="session-cwd-switch-label">{{ t('app.switchProject') }}</span>
            </button>
            <span v-else-if="headerSubtitle" class="session-cwd" :title="headerSubtitle">
              <PhFolderSimple :size="13" weight="bold" aria-hidden="true" />
              <span>{{ headerProjectName }}</span>
            </span>
            <span v-if="gitStatus.isGitRepo && gitStatus.branch" class="git-branch-pill" :title="gitStatus.detached ? t('app.detachedHead', { branch: gitStatus.branch }) : t('app.gitBranch', { branch: gitStatus.branch })">
              <PhGitBranch :size="13" weight="bold" />
              <span>{{ gitStatus.branch }}</span>
            </span>
            <a
              v-if="activePullRequest"
              :href="activePullRequest.url"
              class="pull-request-pill"
              :class="activePullRequest.status"
              :title="activePullRequest.status === 'merged' ? 'Pull request merged' : 'Pull request ready'"
              target="_blank"
              rel="noopener noreferrer"
            >
              <PhGitMerge v-if="activePullRequest.status === 'merged'" :size="13" weight="bold" aria-hidden="true" />
              <PhGitPullRequest v-else :size="13" weight="bold" aria-hidden="true" />
              <span>PR #{{ activePullRequest.number }}</span>
            </a>
            <span v-if="selectedAgentName" class="agent-pill" :title="t('app.agentName', { name: selectedAgentName })">
              <PhMagnifyingGlass v-if="isReviewProfileSelected" :size="13" weight="bold" />
              <PhRobot v-else :size="13" weight="bold" />
              <span>{{ selectedAgentName }}</span>
            </span>
          </span>
        </div>
        <div class="header-actions">
          <button
            v-if="!isReviewMode"
            class="icon-btn tooltip title-new-btn mobile-title-new-btn"
            @click="openTitleBarNew"
            :data-tooltip="newSessionTooltip"
            :aria-label="t('app.newSession')"
          >
            <PhPlus :size="18" weight="bold" />
          </button>
          <button
            v-if="showTaskQueue"
            class="icon-btn mobile-task-close"
            type="button"
            :aria-label="t('app.closeTaskQueue')"
            @click="setTaskQueueVisible(false)"
          >
            <PhX :size="18" weight="bold" />
          </button>
          <button class="mobile-hamburger" @click="showMobileActions = false; showMobileSidebar = !showMobileSidebar" :aria-label="t('app.toggleSidebar')">
            <PhSidebarSimple :size="22" weight="bold" />
          </button>
          <button
            v-if="activeWorktree?.worktreeStatus === 'active'"
            class="icon-btn tooltip"
            :disabled="finishingWorktree"
            @click="openFinishWorktreeConfirm"
            :data-tooltip="t('app.finishWorktreeSession')"
          >
            <PhGitBranch :size="18" weight="bold" />
          </button>
          <button
            v-if="activeSessionId"
            class="icon-btn delete-btn tooltip"
            @click="deleteSession"
            :data-tooltip="t('app.deleteSession')"
          >
            <PhTrash :size="18" weight="bold" />
          </button>
          <button
            class="icon-btn tooltip desktop-header-action"
            data-header-action="editor"
            @click="showEditor = !showEditor"
            :class="{ active: showEditor }"
            :data-tooltip="editorTooltip"
            :aria-label="t('app.editor')"
          >
            <PhNotePencil :size="18" weight="bold" />
          </button>
          <button
            class="icon-btn tooltip desktop-header-action"
            data-header-action="tasks"
            @click="toggleTaskQueue"
            :class="{ active: showTaskQueue }"
            :data-tooltip="taskQueueTooltip"
            :aria-label="t('app.taskQueue')"
          >
            <PhTray :size="18" weight="bold" />
          </button>
          <button
            class="icon-btn tooltip"
            @click="toggleFullscreen"
            :class="{ active: isFullscreen }"
            :data-tooltip="fullscreenTooltip"
            :aria-label="fullscreenAriaLabel"
          >
            <PhCornersIn v-if="isFullscreen" :size="18" weight="bold" />
            <PhCornersOut v-else :size="18" weight="bold" />
          </button>
          <div class="mobile-actions-wrap">
            <button
              class="icon-btn mobile-actions-toggle"
              @click="showMobileSidebar = false; showMobileActions = !showMobileActions"
              :class="{ active: showMobileActions }"
              :aria-label="t('app.openActions')"
              :aria-expanded="showMobileActions"
            >
              <PhDotsThreeVertical :size="20" weight="bold" />
            </button>
            <div v-if="showMobileActions" class="mobile-actions-menu">
              <button class="mobile-action-item" @click="openSearch(); showMobileActions = false">
                <PhMagnifyingGlass :size="18" weight="bold" />
                <span>{{ t('app.search') }}</span>
              </button>
              <button class="mobile-action-item" @click="openMemoryCenter(); showMobileActions = false">
                <PhBrain :size="18" weight="bold" />
                <span>{{ t('app.memory') }}</span>
              </button>
              <button class="mobile-action-item" @click="openSettings(); showMobileActions = false">
                <PhGear :size="18" weight="bold" />
                <span>{{ t('app.settings') }}</span>
              </button>
              <button
                class="mobile-action-item"
                :class="{ active: showTaskQueue }"
                @click="toggleTaskQueue(); showMobileActions = false"
              >
                <PhTray :size="18" weight="bold" />
                <span>{{ t('app.taskQueue') }}</span>
              </button>
              <button
                v-if="activeWorktree?.worktreeStatus === 'active'"
                class="mobile-action-item"
                :disabled="finishingWorktree"
                @click="openFinishWorktreeConfirm(); showMobileActions = false"
              >
                <PhGitBranch :size="18" weight="bold" />
                <span>{{ t('app.finishWorktree') }}</span>
              </button>
              <button v-if="activeSessionId" class="mobile-action-item danger" @click="deleteSession(); showMobileActions = false">
                <PhTrash :size="18" weight="bold" />
                <span>{{ t('app.deleteSession') }}</span>
              </button>
              <button v-if="!isReviewMode" class="mobile-action-item" :class="{ active: showTerminal }" @click="showTerminal = !showTerminal; showMobileActions = false">
                <PhTerminal :size="18" weight="bold" />
                <span>{{ t('app.terminal') }}</span>
              </button>
              <button class="mobile-action-item" :class="{ active: showEditor }" @click="showEditor = !showEditor; showMobileActions = false">
                <PhNotePencil :size="18" weight="bold" />
                <span>{{ t('app.editor') }}</span>
              </button>
              <button class="mobile-action-item" :class="{ active: isFullscreen }" @click="toggleFullscreen(); showMobileActions = false">
                <PhCornersIn v-if="isFullscreen" :size="18" weight="bold" />
                <PhCornersOut v-else :size="18" weight="bold" />
                <span>{{ fullscreenLabel }}</span>
              </button>
            </div>
          </div>
        </div>
      </header>
      
      <ChatPanel
        v-if="isSessionContextReady"
        ref="chatPanelRef"
        :sessionId="activeSessionId"
        :clientId="clientId"
        :projectPath="sessionCwd || selectedProjectPath"
        :sessionTitle="sessionTitle"
        :ensureSession="ensureSession"
        :createInheritedSession="createInheritedSession"
        :configureNewSession="openNewSessionDialog"
        :showHintInfo="showHintInfo"
        :showCodeBlockLanguageHeaders="showCodeBlockLanguageHeaders"
        :modelInfo="selectedAgentModelSummary"
        :showGoToTopButton="showGoToTopButton"
        :showChatViewOptionsButton="showChatViewOptionsButton"
        :fullscreen="isFullscreen"
        :reviewSourceId="activeReviewSession?.sourceId"
        :reviewSessionId="activeReviewSession?.sessionId"
        @branch-changed="handleBranchChanged"
        @toggle-fullscreen="toggleFullscreen"
      />
      <LazyTerminalPanel
        v-if="terminalFeatureLoaded"
        :visible="showTerminal"
        :mode="terminalMode"
        :isMaximized="isTerminalMaximized"
        :isFloating="isTerminalFloating"
        :sessions="terminalSessions"
        :activeId="activeTerminalId"
        :terminalHeight="terminalHeight"
        :floatPanelStyle="terminalFloatPanelStyle"
        :resizeDirections="terminalResizeDirections"
        :interaction="terminalInteraction"
        @toggleMaximize="toggleTerminalMaximize"
        @popOut="popOutTerminal"
        @dock="dockTerminal"
        @createTerminal="handleCreateTerminal"
        @close="showTerminal = false"
        @switch="switchTerminalSession"
        @closeTerminal="handleCloseTerminal"
        @setHostRef="setTerminalHostRef"
        @updateHeight="updateTerminalHeight"
        @startMove="startTerminalMove"
        @startResize="startTerminalResize"
      />
    </main>

    <LazyTaskQueuePanel
      v-if="taskQueueFeatureLoaded"
      :visible="showTaskQueue"
      :client-id="clientId"
      :current-project-path="selectedProjectPath"
      :selected-agent-profile-id="selectedAgentProfileId"
      :presets="skillPresets"
      :load-presets="loadPresets"
      @close="setTaskQueueVisible(false)"
      @started="handleTaskStarted"
      @open-session="openTaskSession"
    />
    
    <LazyEditorPanel
      v-if="editorFeatureLoaded"
      ref="editorPanelRef"
      :visible="showEditor"
      :cwd="sessionCwd || selectedProjectPath"
      :auto-refresh="editorAutoRefresh"
      @close="showEditor = false"
      @add-reference="addEditorReference"
    />

    <ConfirmModal
      :visible="showFinishWorktreeConfirm"
      :confirm-text="t('app.finish')"
      :cancel-text="t('app.cancel')"
      @confirm="finishWorktreeSession"
      @cancel="showFinishWorktreeConfirm = false"
    >
      <template #icon><PhGitBranch :size="40" weight="duotone" /></template>
      <template #title>{{ t('app.finishWorktreeTitle') }}</template>
      <template #message>
        <div class="finish-worktree-preview">
          <p>{{ t('app.finishWorktreeDescription') }}</p>
          <p class="finish-worktree-caution">{{ t('app.finishWorktreeCaution') }}</p>
          <p v-if="finishWorktreePreviewLoading">{{ t('app.loadingCleanupTargets') }}</p>
          <p v-else-if="finishWorktreePreviewError" class="preview-error">{{ finishWorktreePreviewError }}</p>
          <ul v-else-if="finishWorktreePreview" class="cleanup-list">
            <li>
              <strong>{{ t('app.removeGitWorktree') }}</strong>
              <code>{{ finishWorktreePreview.worktreePath }}</code>
            </li>
            <li>
              <strong>{{ t('app.moveSessionHistory') }}</strong>
              <code>{{ finishWorktreePreview.history.sourcePath }}</code>
              <span>→</span>
              <code>{{ finishWorktreePreview.history.destinationPath }}</code>
              <em v-if="!finishWorktreePreview.history.sourceExists">{{ t('app.noHistoryFile') }}</em>
            </li>
            <li>
              <strong>{{ t('app.rewriteSessionCwd') }}</strong>
              <code>{{ finishWorktreePreview.worktreePath }}</code>
              <span>→</span>
              <code>{{ finishWorktreePreview.baseRepoPath }}</code>
            </li>
          </ul>
        </div>
      </template>
    </ConfirmModal>

    <ConfirmModal
      :visible="showDeleteConfirm"
      variant="danger"
      :confirm-text="t('app.delete')"
      :cancel-text="t('app.cancel')"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    >
      <template #icon><PhTrash :size="40" weight="duotone" /></template>
      <template #title>{{ t('app.deleteSessionTitle') }}</template>
      <template #message>{{ t('app.deleteSessionMessage') }}</template>
    </ConfirmModal>

    <SearchModal
      :isOpen="showSearch"
      :projectPath="selectedProjectPath"
      @close="showSearch = false"
      @selectSession="handleSearchSelect"
    />

    <LazyMemoryCenter
      v-if="memoryFeatureLoaded"
      :visible="showMemoryCenter"
      :controller="memory"
      :profileLabel="selectedAgentProfileLabel"
      :projectPath="activeProjectPath"
      :sessionId="activeSessionId"
      :reviewRunId="memoryReviewRunId"
      @close="closeMemoryCenter"
      @openSession="openMemorySourceSession"
      @reviewRunConsumed="memoryReviewRunId = undefined"
    />

    <MemoryToast
      :toast="memoryToastState"
      @review="reviewMemoryExtraction"
      @undo="undoMemoryExtraction"
      @dismiss="memory.dismissToast"
    />

    <LazySettingsDialog
      v-if="settingsFeatureLoaded"
      :visible="showSettings"
      :client-id="clientId"
      :project-path="activeProjectPath"
      :totp-enabled="user?.totpEnabled || false"
      :show-hint-info="showHintInfo"
      :show-code-block-language-headers="showCodeBlockLanguageHeaders"
      :streaming-message-behavior="streamingMessageBehavior"
      :editor-auto-refresh="editorAutoRefresh"
      :confirm-session-delete="confirmSessionDelete"
      :new-session-shortcut="newSessionShortcut"
      :fullscreen-shortcut="fullscreenShortcut"
      :show-go-to-top-button="showGoToTopButton"
      :show-chat-view-options-button="showChatViewOptionsButton"
      :auto-extract-memory="autoExtractMemory"
      :theme="theme"
      :language="language"
      :sound-notification="soundNotification"
      :available-skills="availableSkills"
      :skill-presets="skillPresets"
      :gitea-server-url="gitHosting.settings.value.serverUrl"
      :gitea-token-configured="gitHosting.settings.value.tokenConfigured"
      :github-server-url="gitHosting.githubSettings.value.serverUrl"
      :github-token-configured="gitHosting.githubSettings.value.tokenConfigured"
      :github-proxy-url="gitHosting.githubSettings.value.proxyUrl || ''"
      :git-clone-parent-path="gitCloneParentPath"
      :gateway-cwds="gatewaySettings.settings.value.cwds"
      :gateway-default-profile="gatewaySettings.settings.value.defaultProfile"
      :gateway-default-skillset="gatewaySettings.settings.value.defaultSkillset"
      :gateway-default-model-provider="gatewaySettings.settings.value.defaultModelProvider"
      :gateway-default-model-id="gatewaySettings.settings.value.defaultModelId"
      :gateway-saving="gatewaySettingsSaving"
      :gateway-save-success-tick="gatewaySaveSuccessTick"
      :git-saving="gitSettingsSaving"
      :git-save-success-tick="gitSaveSuccessTick"
      :github-proxy-checking="githubProxyChecking"
      :github-proxy-check-result="githubProxyCheckResult"
      @update:show-hint-info="setShowHintInfo"
      @update:show-code-block-language-headers="setShowCodeBlockLanguageHeaders"
      @update:streaming-message-behavior="setStreamingMessageBehavior"
      @update:editor-auto-refresh="setEditorAutoRefresh"
      @update:confirm-session-delete="setConfirmSessionDelete"
      @update:new-session-shortcut="setNewSessionShortcut"
      @update:fullscreen-shortcut="setFullscreenShortcut"
      @update:show-go-to-top-button="setShowGoToTopButton"
      @update:show-chat-view-options-button="setShowChatViewOptionsButton"
      @update:auto-extract-memory="setAutoExtractMemory"
      @update:theme="setTheme"
      @update:language="setLanguage"
      @update:sound-notification="setSoundNotification"
      @update:git-clone-parent-path="setGitCloneParentPath"
      @create-skill-preset="handleCreateSkillPreset"
      @update-skill-preset="handleUpdateSkillPreset"
      @delete-skill-preset="handleDeleteSkillPreset"
      @clear-launch-cache="handleClearLaunchCache"
      @save-git-settings="handleSaveGitSettings"
      @save-gateway-settings="handleSaveGatewaySettings"
      @clear-gitea-settings="handleClearGiteaSettings"
      @test-gitea-connection="handleTestGiteaConnection"
      @clear-github-settings="handleClearGithubSettings"
      @test-github-connection="handleTestGithubConnection"
      @test-github-proxy="handleTestGithubProxy"
      @close="showSettings = false"
      @updated="refresh"
    />


    <NewSessionDialog
      :visible="showNewSessionDialog"
      :project-path="pendingNewSessionPath || selectedProjectPath"
      :agent-profile-label="selectedAgentProfileLabel"
      :available-skills="availableSkills"
      :presets="skillPresets"
      :branches="worktreeBranches"
      :models="newSessionModels"
      :initial-model="newSessionInitialModel"
      :copy-files="worktreeCopyFiles"
      :current-branch="gitStatus.detached ? undefined : gitStatus.branch"
      :branches-loading="worktreeBranchesLoading"
      :branches-error="gitStatus.isGitRepo ? worktreeBranchesError : t('app.worktreeRequiresGit')"
      @request-branches="handleRequestWorktreeBranches"
      @close="showNewSessionDialog = false"
      @create="createSessionFromDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, defineAsyncComponent } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useWebSocket } from './composables/useWebSocket';
import { useAuth } from './composables/useAuth';
import { usePreferences } from './composables/usePreferences';
import { useTheme } from './composables/useTheme';
import { i18n, setLocale } from './i18n';
import { PhBrain, PhGear, PhMagnifyingGlass, PhPlus, PhTrash, PhTerminal, PhNotePencil, PhTray, PhGitBranch, PhGitMerge, PhGitPullRequest, PhSidebarSimple, PhRobot, PhFolderSimple, PhDotsThreeVertical, PhCornersOut, PhCornersIn, PhX } from '@phosphor-icons/vue';
import LoginView from './components/LoginView.vue';
import SessionSidebar from './components/SessionSidebar.vue';
import GitToolPanel from './components/GitToolPanel.vue';
import NewSessionDialog from './components/NewSessionDialog.vue';
import ChatPanel from './components/ChatPanel.vue';
import type { ProjectTaskStartResult } from './types/projectTask';
import { useTerminalPanel } from './composables/useTerminalPanel';
import ConfirmModal from './components/ConfirmModal.vue';
import SearchModal from './components/SearchModal.vue';
import MemoryToast from './components/MemoryToast.vue';
import { useAvailableSkills } from './composables/useAvailableSkills';
import { useSkillPresets } from './composables/useSkillPresets';
import { useWorktreeBranches } from './composables/useWorktreeBranches';
import { useMemories } from './composables/useMemories';
import { useGitHosting } from './composables/useGitHosting';
import { useGatewaySettings } from './composables/useGatewaySettings';
import { cachedLaunchResource, invalidateLaunchResourceCache, launchCacheKey } from './composables/useLaunchResourceCache';
import { normalizePathSeparators } from './utils/paths';

let editorPanelPromise: ReturnType<typeof importEditorPanel> | undefined;
function importEditorPanel() {
  return import('./components/EditorPanel.vue').then((module) => module.default);
}
const loadEditorPanel = () => (editorPanelPromise ??= importEditorPanel());
const LazyEditorPanel = defineAsyncComponent(loadEditorPanel);
const LazySettingsDialog = defineAsyncComponent(() => import('./components/SettingsDialog.vue').then((module) => module.default));
const LazyMemoryCenter = defineAsyncComponent(() => import('./components/MemoryCenter.vue').then((module) => module.default));
const LazyTaskQueuePanel = defineAsyncComponent(() => import('./components/TaskQueuePanel.vue').then((module) => module.default));
const LazyTerminalPanel = defineAsyncComponent(() => import('./components/TerminalPanel.vue').then((module) => module.default));
type TerminalRuntime = typeof import('./composables/useTerminal');
type TerminalInstance = ReturnType<TerminalRuntime['createTerminalInstance']>;

let terminalRuntime: TerminalRuntime | undefined;
let terminalRuntimePromise: Promise<TerminalRuntime> | undefined;

function loadTerminalRuntime(): Promise<TerminalRuntime> {
  terminalRuntimePromise ??= import('./composables/useTerminal').then((runtime) => {
    terminalRuntime = runtime;
    return runtime;
  });
  return terminalRuntimePromise;
}

const router = useRouter();
const route = useRoute();
const { isConnected, clientId, connect, close } = useWebSocket({ autoConnect: false });
const { isAuthenticated, loading, user, sessionExpiresAt = ref<string | null>(null), refresh, logout } = useAuth();
const AUTH_REFRESH_MAX_INTERVAL_MS = 60 * 60 * 1000;
const AUTH_REFRESH_MIN_INTERVAL_MS = 1000;
let authRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let authRefreshMounted = false;

function clearAuthRefreshTimer(): void {
  if (!authRefreshTimer) return;
  clearTimeout(authRefreshTimer);
  authRefreshTimer = undefined;
}

function getNextAuthRefreshDelay(): number | null {
  const expiresAt = Date.parse(sessionExpiresAt.value || '');
  if (!Number.isFinite(expiresAt)) return null;
  const remainingMs = expiresAt - Date.now();
  return Math.max(AUTH_REFRESH_MIN_INTERVAL_MS, Math.min(AUTH_REFRESH_MAX_INTERVAL_MS, Math.floor(remainingMs / 2)));
}

function scheduleAuthRefresh(): void {
  clearAuthRefreshTimer();
  if (!authRefreshMounted || !isAuthenticated.value) return;
  const delay = getNextAuthRefreshDelay();
  if (delay === null) return;
  authRefreshTimer = setTimeout(() => void refreshAuth(), delay);
}

async function refreshAuth(): Promise<void> {
  try {
    await refresh();
  } finally {
    scheduleAuthRefresh();
  }
}

// The chat socket requires authentication, so keep it closed on the login page.
watch(isAuthenticated, (authenticated) => {
  if (authenticated) {
    connect?.();
    scheduleAuthRefresh();
  } else {
    close?.();
    clearAuthRefreshTimer();
  }
}, { immediate: true });
const {
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
  setGitCloneParentPath,
} = usePreferences();
const t = i18n.global.t;
watch(language, setLocale, { immediate: true });

const { resolvedTheme } = useTheme();
const { skills: availableSkills, loadSkills } = useAvailableSkills();
const {
  presets: skillPresets,
  loadPresets,
  createPreset,
  updatePreset,
  deletePreset,
} = useSkillPresets();
const {
  branches: worktreeBranches,
  copyFiles: worktreeCopyFiles,
  loading: worktreeBranchesLoading,
  error: worktreeBranchesError,
  loadBranches: loadWorktreeBranches,
  loadCopyFiles: loadWorktreeCopyFiles,
  resetBranches: resetWorktreeBranches,
} = useWorktreeBranches();

const DEFAULT_SESSION_TITLE = 'New Session';

const activeSessionId = computed(() => route.params.id as string | undefined);
type CompactSession = { id: string; path: string; cwd?: string; title: string; isStreaming?: boolean };
const compactSessions = ref<CompactSession[]>([]);
const sessionTitle = ref<string>();
const editingSessionTitle = ref(false);
const sessionTitleDraft = ref('');
const sessionTitleInput = ref<HTMLInputElement | null>(null);
const sessionCwd = ref<string>();
const activePullRequest = ref<PullRequestSummary>();
interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  detached?: boolean;
}

interface PullRequestSummary {
  number: number;
  url: string;
  title: string;
  status: 'ready' | 'merged';
}

interface SessionWorktreeInfo {
  sessionId: string;
  baseRepoPath: string;
  worktreePath: string;
  branchName: string;
  branchMode: 'new' | 'existing';
  baseBranch?: string;
  worktreeManaged: true;
  worktreeStatus: 'active' | 'finished';
}

type ModelOption = { provider: string; id: string; name?: string };

type WorktreePayload =
  | { mode: 'none' }
  | { mode: 'managed'; branchMode: 'new'; branchName: string; baseBranch: string; copyFile?: string }
  | { mode: 'managed'; branchMode: 'existing'; branchName: string; copyFile?: string };

const optimisticSessions = ref(new Map<string, { id: string; name?: string; firstMessage?: string; cwd?: string; worktree?: SessionWorktreeInfo }>());
const boundSessionId = ref<string>();
const sidebarInitialized = ref(false);
const activeReviewSession = ref<{ sourceId: string; sessionId: string } | null>(null);
const isReviewMode = computed(() => activeReviewSession.value !== null);
const isSessionContextReady = computed(() => !activeSessionId.value || sidebarInitialized.value);
const activeProjectPath = computed(() => sessionCwd.value || selectedProjectPath.value);
const sessionCwdDisplay = computed(() => formatHomePath(sessionCwd.value));
const showTaskQueue = ref(false);
const taskQueueFeatureLoaded = ref(false);
const headerTitle = computed(() => sessionTitle.value || 'Pi WebUI');
const headerSubtitle = computed(() => sessionCwdDisplay.value || formatHomePath(selectedProjectPath.value));
const headerProjectName = computed(() => formatProjectName(headerSubtitle.value));
const canSwitchToSessionProject = computed(() => (
  Boolean(sessionCwd.value)
  && formatHomePath(sessionCwd.value) !== formatHomePath(selectedProjectPath.value)
));
const pageTitle = computed(() => [sessionTitle.value || 'Pi WebUI', selectedAgentName.value].filter(Boolean).join(' - '));
const readySessionIds = ref<Set<string>>(new Set());
const readySessionIdList = computed(() => Array.from(readySessionIds.value));
const tabTitle = computed(() => readySessionIds.value.size > 0 ? `🔔 ${pageTitle.value}` : pageTitle.value);
const newSessionShortcutLabel = computed(() => {
  if (newSessionShortcut.value === 'disabled') return '';
  return newSessionShortcut.value === 'ctrlMetaN' ? 'Ctrl+⌘+N' : 'Ctrl+Alt+N';
});
const newSessionTooltip = computed(() => (
  newSessionShortcutLabel.value ? `${t('app.newSession')} (${newSessionShortcutLabel.value})` : t('app.newSession')
));
const sidebarToggleTooltip = computed(() => `${t('app.toggleSidebar')} (${isMacPlatform() ? '⌘B' : 'Ctrl+B'})`);
const terminalTooltip = computed(() => `${t('app.terminal')} (${isMacPlatform() ? '⌘`' : 'Ctrl+`'})`);
const editorTooltip = computed(() => `${t('app.editor')} (Ctrl+E)`);
const taskQueueTooltip = computed(() => `${t('app.taskQueue')} (Ctrl+Q)`);
const selectedProjectPath = ref('~');
const gitStatus = ref<GitStatus>({ isGitRepo: false });
let gitStatusRequestId = 0;
const selectedAgentProfileLabel = ref('default (~/.pi/agent)');
const selectedAgentProfileId = ref('default');
const selectedReviewSourceLabel = ref('');
function sessionRouteLocation(sessionId: string, cwd?: string) {
  const query: Record<string, string> = {};
  if (selectedAgentProfileId.value && selectedAgentProfileId.value !== 'default') {
    query.profile = selectedAgentProfileId.value;
  }
  if (cwd && cwd !== '~') {
    query.project = cwd;
  }
  return Object.keys(query).length > 0
    ? { path: `/sessions/${sessionId}`, query }
    : `/sessions/${sessionId}`;
}
const newSessionModels = ref<ModelOption[]>([]);
const newSessionInitialModel = ref('');
const selectedAgentName = computed(() => selectedReviewSourceLabel.value || formatAgentName(selectedAgentProfileLabel.value));
const isReviewProfileSelected = computed(() => Boolean(selectedReviewSourceLabel.value));
const selectedAgentModelSummary = ref('');
const showEditor = ref(false);
const editorFeatureLoaded = ref(false);
const showGitTool = ref(false);
const isFullscreen = ref(false);
const fullscreenLabel = computed(() => t(isFullscreen.value ? 'app.exitFullscreen' : 'app.fullscreen'));
const fullscreenTooltip = computed(() => `${fullscreenLabel.value} (${formatFullscreenShortcut(fullscreenShortcut.value)})`);
const fullscreenAriaLabel = computed(() => t(isFullscreen.value ? 'app.exitFullscreen' : 'app.enterFullscreen'));
interface EditorPanelHandle {
  openFile(path: string, line?: number, column?: number): void;
  openVirtualDiff(detail: { cwd: string; scope: string; content: string }): void;
}
const editorPanelRef = ref<EditorPanelHandle>();

async function waitForEditorPanel() {
  await loadEditorPanel();
  await nextTick();
  if (editorPanelRef.value) return editorPanelRef.value;
  return new Promise<EditorPanelHandle>((resolve) => {
    const stop = watch(editorPanelRef, (panel) => {
      if (!panel) return;
      stop();
      resolve(panel);
    }, { flush: 'post' });
  });
}
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);
const sessionSidebarRef = ref<InstanceType<typeof SessionSidebar> | null>(null);

async function beginSessionTitleEdit(): Promise<void> {
  if (!activeSessionId.value) return;
  sessionTitleDraft.value = sessionTitle.value || '';
  editingSessionTitle.value = true;
  await nextTick();
  sessionTitleInput.value?.focus();
  sessionTitleInput.value?.select();
}

function cancelSessionTitleEdit(): void {
  editingSessionTitle.value = false;
}

async function saveSessionTitle(): Promise<void> {
  if (!editingSessionTitle.value) return;
  editingSessionTitle.value = false;

  const sessionId = activeSessionId.value;
  const name = sessionTitleDraft.value.trim();
  if (!sessionId || !name || name === sessionTitle.value) return;

  try {
    const response = await fetch(`/api/sessions/${sessionId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name }),
    });
    if (!response.ok) throw new Error(`Rename failed with status ${response.status}`);

    if (activeSessionId.value === sessionId) sessionTitle.value = name;
    compactSessions.value = compactSessions.value.map((session) => (
      session.id === sessionId ? { ...session, title: name } : session
    ));
    void sessionSidebarRef.value?.loadSessions();
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToRenameSession'), error);
  }
}

function addEditorReference(path: string) {
  chatPanelRef.value?.addFileReference(path);
}
const {
  visible: showTerminal,
  toggle: toggleTerminalPanel,
  mode: terminalMode,
  isMaximized: isTerminalMaximized,
  isFloating: isTerminalFloating,
  popOut: popOutTerminal,
  dock: dockTerminal,
  toggleMaximize: toggleTerminalMaximize,
  terminalHeight,
  updateHeight: updateTerminalHeight,
  floatRect: terminalFloatRect,
  floatPanelStyle: terminalFloatPanelStyle,
  interaction: terminalInteraction,
  startMove: startTerminalMove,
  startResize: startTerminalResize,
  resizeDirections: terminalResizeDirections,
  sessions: terminalSessions,
  activeId: activeTerminalId,
  createSession: createTerminalSession,
  removeSession: removeTerminalSession,
  switchSession: switchTerminalSession,
  setHostRef: setTerminalHostRef,
  disposeAll: disposeAllTerminals,
} = useTerminalPanel();
interface FinishWorktreePreview {
  worktreePath: string;
  baseRepoPath: string;
  history: {
    sourcePath: string;
    destinationPath: string;
    sourceExists: boolean;
  };
}

const activeWorktree = ref<SessionWorktreeInfo | null>(null);
const finishingWorktree = ref(false);
const showFinishWorktreeConfirm = ref(false);
const finishWorktreePreview = ref<FinishWorktreePreview | null>(null);
const finishWorktreePreviewLoading = ref(false);
const finishWorktreePreviewError = ref('');
const showDeleteConfirm = ref(false);
const showSearch = ref(false);
const showSettings = ref(false);
const settingsFeatureLoaded = ref(false);
const gitSettingsSaving = ref(false);
const gitSaveSuccessTick = ref(0);
const gatewaySettingsSaving = ref(false);
const gatewaySaveSuccessTick = ref(0);
const githubProxyChecking = ref(false);
const githubProxyCheckResult = ref<'ok' | 'failed' | null>(null);
const sidebarCollapsedStorageKey = 'pi-webui-sidebar-collapsed';
const sidebarCollapsed = ref(loadSidebarCollapsed());
const showNewSessionDialog = ref(false);
const pendingNewSessionPath = ref('');
const showMobileSidebar = ref(false);
const showMobileActions = ref(false);
const memory = useMemories({ clientId, autoConnect: false });
const gitHosting = useGitHosting();
const gatewaySettings = useGatewaySettings();
const showMemoryCenter = ref(false);
const memoryFeatureLoaded = ref(false);
const memoryReviewRunId = ref<string>();
const memoryPendingCount = computed(() => memory.counts.value.globalPending);
const memoryHasError = computed(() => Boolean(memory.error.value || memory.warning.value));
const memoryToastState = computed(() => memory.toast.value);

watch([isAuthenticated, selectedAgentProfileId, activeProjectPath, activeSessionId], async ([authenticated, profileId, projectPath, sessionId]) => {
  if (!authenticated) return;
  memory.setContext({ profileId, projectPath, sessionId });
  memoryReviewRunId.value = undefined;
  await memory.loadCounts();
}, { immediate: true });

// Fetch session title when route changes.
watch([isAuthenticated, activeSessionId, sidebarInitialized], async ([authenticated, id, sidebarReady]) => {
  // Wait for the sidebar session list before resolving route metadata; otherwise
  // startup races the persisted-session scan and performs a request that cannot succeed yet.
  if (!authenticated || (id && !sidebarReady)) return;
  if (id && !activeReviewSession.value) {
    clearReadySession(id);
    await refreshActiveSessionMetadata(id);
  } else if (!id) {
    activeReviewSession.value = null;
    clearReadySession(id);
    await refreshActiveSessionMetadata(id);
  }
}, { immediate: true });

watch([isAuthenticated, activeProjectPath], async ([authenticated, projectPath]) => {
  if (!authenticated) return;
  await loadGitStatus(projectPath);
}, { immediate: true });

// Auto-create a terminal when the panel opens with no sessions
watch(showTerminal, (visible) => {
  if (visible && terminalSessions.value.length === 0) {
    void handleCreateTerminal();
  }
});

const terminalFeatureLoaded = ref(false);
watch(showTerminal, (visible) => {
  if (visible) terminalFeatureLoaded.value = true;
}, { flush: 'sync' });
watch(showTaskQueue, (visible) => {
  if (visible) taskQueueFeatureLoaded.value = true;
}, { flush: 'sync' });
watch(showEditor, (visible) => {
  if (visible) editorFeatureLoaded.value = true;
}, { flush: 'sync' });
watch(showMemoryCenter, (visible) => {
  if (visible) memoryFeatureLoaded.value = true;
}, { flush: 'sync' });
watch(showSettings, (visible) => {
  if (visible) settingsFeatureLoaded.value = true;
}, { flush: 'sync' });

watch(tabTitle, (title) => {
  document.title = title;
}, { immediate: true });

watch(sidebarCollapsed, (collapsed) => {
  try {
    localStorage.setItem(sidebarCollapsedStorageKey, collapsed ? 'true' : 'false');
  } catch {
    // Ignore storage failures (private browsing, disabled storage, etc.).
  }
});

function updateReadySessions(update: (nextReadySessionIds: Set<string>) => void) {
  const nextReadySessionIds = new Set(readySessionIds.value);
  update(nextReadySessionIds);
  readySessionIds.value = nextReadySessionIds;
}

function clearReadySession(sessionId?: string | null) {
  if (!sessionId || !readySessionIds.value.has(sessionId)) return;
  updateReadySessions((nextReadySessionIds) => nextReadySessionIds.delete(sessionId));
}

function handleSessionStreamingState(event: Event) {
  const detail = (event as CustomEvent<{ id?: string; isStreaming?: boolean; completed?: boolean }>).detail;
  if (!detail?.id) return;

  if (detail.isStreaming) {
    clearReadySession(detail.id);
    return;
  }

  if (!detail.completed) return;

  const isActiveVisibleSession = detail.id === activeSessionId.value && document.visibilityState === 'visible';
  if (isActiveVisibleSession) return;

  updateReadySessions((nextReadySessionIds) => nextReadySessionIds.add(detail.id!));
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    clearReadySession(activeSessionId.value);
  }
}

function formatHomePath(path?: string): string {
  if (!path) return '';
  return path
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

function formatProjectName(path: string): string {
  const normalizedPath = path.replace(/\/+$/, '');
  return normalizedPath.split('/').pop() || path;
}

function formatSessionTitle(session: { name?: string; firstMessage?: string; id: string }): string {
  if (session.name) return session.name;
  if (session.firstMessage) {
    const skillMatch = session.firstMessage.match(/^<skill\s+name="([^"]+)"/);
    if (skillMatch) return skillMatch[1];
    return session.firstMessage.slice(0, 50);
  }
  return DEFAULT_SESSION_TITLE;
}

async function handleBranchChanged(): Promise<void> {
  await loadGitStatus(activeProjectPath.value);
}

async function loadGitStatus(projectPath: string) {
  const requestId = ++gitStatusRequestId;
  if (!projectPath) {
    gitStatus.value = { isGitRepo: false };
    return;
  }

  try {
    const params = new URLSearchParams({ clientId, projectPath });
    const response = await fetch(`/api/sessions/git-status?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to load git status');
    const data = await response.json();
    // A project change or branch switch can start another status request. Do not
    // let a slower response from the previous state overwrite the current tag.
    if (requestId !== gitStatusRequestId) return;
    gitStatus.value = data?.isGitRepo
      ? { isGitRepo: true, branch: data.branch, detached: Boolean(data.detached) }
      : { isGitRepo: false };
  } catch {
    if (requestId === gitStatusRequestId) gitStatus.value = { isGitRepo: false };
  }
}

async function refreshActiveSessionMetadata(id = activeSessionId.value): Promise<boolean> {
  if (!id) {
    sessionTitle.value = undefined;
    sessionCwd.value = undefined;
    activePullRequest.value = undefined;
    activeWorktree.value = null;
    return true;
  }

  try {
    const response = await fetch(`/api/sessions/${id}/summary?clientId=${encodeURIComponent(clientId)}`);
    if (response.status === 404) return false;
    if (response.ok === false) throw new Error('Failed to load session summary');
    const session = await response.json();
    if (!session) throw new Error('Session not found');
    const optimisticSession = optimisticSessions.value.get(id);
    const displaySession = session.name || session.firstMessage
      ? session
      : { ...session, firstMessage: optimisticSession?.firstMessage };
    sessionTitle.value = formatSessionTitle(displaySession);
    sessionCwd.value = session.cwd || optimisticSession?.cwd;
    activePullRequest.value = session.pullRequest;
    activeWorktree.value = session.worktree || optimisticSession?.worktree || null;
    if (session.name || session.firstMessage) {
      optimisticSessions.value.delete(id);
    }
    return true;
  } catch {
    // Fall through to optimistic metadata or id fallback.
  }

  const optimisticSession = optimisticSessions.value.get(id);
  if (optimisticSession) {
    sessionTitle.value = formatSessionTitle(optimisticSession);
    sessionCwd.value = optimisticSession.cwd;
    activePullRequest.value = undefined;
    activeWorktree.value = optimisticSession.worktree || null;
    return true;
  }

  sessionTitle.value = DEFAULT_SESSION_TITLE;
  sessionCwd.value = undefined;
  activePullRequest.value = undefined;
  activeWorktree.value = null;
  return false;
}

async function createNewSession(options?: { cwd?: string; firstMessage?: string; modelProvider?: string; modelId?: string; enabledSkills?: string[]; disabledSkills?: string[]; presetId?: string; copySettingsFromSessionId?: string; worktree?: WorktreePayload }): Promise<string | undefined> {
  const newSessionCwd = options?.cwd || selectedProjectPath.value;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        clientId,
        cwd: newSessionCwd,
        agentProfileId: selectedAgentProfileId.value,
        modelProvider: options?.modelProvider,
        modelId: options?.modelId,
        enabledSkills: options?.enabledSkills,
        disabledSkills: options?.disabledSkills,
        presetId: options?.presetId,
        copySettingsFromSessionId: options?.copySettingsFromSessionId,
        worktree: options?.worktree,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || t('app.failedToCreateSession', { status: response.status }));
    }
    if (!data.sessionId) throw new Error('Backend did not return a session id');

    const resolvedCwd = data.worktree?.worktreePath || newSessionCwd;
    boundSessionId.value = data.sessionId;
    optimisticSessions.value.set(data.sessionId, {
      id: data.sessionId,
      firstMessage: options?.firstMessage,
      cwd: resolvedCwd,
      worktree: data.worktree,
    });
    sessionTitle.value = formatSessionTitle({ id: data.sessionId, firstMessage: options?.firstMessage });
    sessionCwd.value = resolvedCwd;
    activeWorktree.value = data.worktree || null;
    chatPanelRef.value?.setViewedSession?.(data.sessionId);
    router.push(sessionRouteLocation(data.sessionId, resolvedCwd));
    window.dispatchEvent(new CustomEvent('session-created', {
      detail: {
        id: data.sessionId,
        cwd: resolvedCwd,
        firstMessage: options?.firstMessage,
        worktree: data.worktree,
        created: new Date().toISOString(),
      },
    }));
    return data.sessionId;
  } catch (error) {
    let message = 'Failed to create session';
    if (error instanceof DOMException && error.name === 'AbortError') {
      message = 'Timed out creating session. Please check the backend Pi SDK logs and try again.';
    } else if (error instanceof Error) {
      message = error.message;
    }
    console.error('Failed to create session:', error);
    window.alert(message);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function createSessionWithSameSettings(sourceSessionId: string): Promise<string | undefined> {
  return createNewSession({
    cwd: selectedProjectPath.value,
    copySettingsFromSessionId: sourceSessionId,
  });
}

async function createInheritedSession(sourceSessionId: string, initialMessage: string): Promise<string | undefined> {
  return createNewSession({
    cwd: sessionCwd.value || selectedProjectPath.value,
    firstMessage: initialMessage,
    copySettingsFromSessionId: sourceSessionId,
  });
}

async function ensureSession(targetSessionId?: string, initialMessage?: string): Promise<string | undefined> {
  if (!targetSessionId) {
    return createNewSession({ cwd: selectedProjectPath.value, firstMessage: initialMessage });
  }

  if (boundSessionId.value === targetSessionId) {
    return targetSessionId;
  }

  try {
    const response = await fetch(`/api/sessions/${targetSessionId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    const data = await response.json();
    if (data.success) {
      boundSessionId.value = targetSessionId;
      return targetSessionId;
    }
  } catch (error) {
    console.error('Failed to resume session:', error);
  }

  return undefined;
}

async function deleteSession() {
  if (!activeSessionId.value) return;
  if (confirmSessionDelete.value) {
    showDeleteConfirm.value = true;
    return;
  }
  await confirmDelete();
}

function handleSessionDeleted(sessionId: string): void {
  optimisticSessions.value.delete(sessionId);
  compactSessions.value = compactSessions.value.filter((session) => session.id !== sessionId);
  if (activeSessionId.value !== sessionId) return;

  boundSessionId.value = undefined;
  sessionTitle.value = undefined;
  sessionCwd.value = undefined;
  activeWorktree.value = null;
  router.push('/sessions');
}

async function confirmDelete() {
  showDeleteConfirm.value = false;
  const sessionId = activeSessionId.value;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/sessions/${sessionId}?clientId=${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (data.success) {
      handleSessionDeleted(sessionId);
      window.dispatchEvent(new Event('refresh-sessions'));
    } else {
      alert('Failed to delete session: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    alert('Failed to delete session');
    console.error('Delete failed:', error);
  }
}

async function openFinishWorktreeConfirm() {
  if (!activeSessionId.value) return;
  showFinishWorktreeConfirm.value = true;
  finishWorktreePreview.value = null;
  finishWorktreePreviewError.value = '';
  finishWorktreePreviewLoading.value = true;

  try {
    const response = await fetch(`/api/sessions/${activeSessionId.value}/finish-worktree-preview?clientId=${encodeURIComponent(clientId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || 'Failed to load worktree cleanup preview');
    }
    finishWorktreePreview.value = data;
  } catch (error: any) {
    finishWorktreePreviewError.value = error?.message || 'Failed to load worktree cleanup preview';
  } finally {
    finishWorktreePreviewLoading.value = false;
  }
}

async function finishWorktreeSession() {
  if (!activeSessionId.value) return;
  finishingWorktree.value = true;
  try {
    const response = await fetch(`/api/sessions/${activeSessionId.value}/finish-worktree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || 'Failed to finish worktree session');
    }

    activeWorktree.value = activeWorktree.value ? { ...activeWorktree.value, worktreeStatus: 'finished' } : null;
    showFinishWorktreeConfirm.value = false;
    finishWorktreePreview.value = null;
    window.dispatchEvent(new Event('refresh-sessions'));
    await refreshActiveSessionMetadata();
  } catch (error: any) {
    alert(error?.message || 'Failed to finish worktree session');
  } finally {
    finishingWorktree.value = false;
  }
}

function handleProjectPathChanged(cwd: string, options?: { initial?: boolean; keepSession?: boolean }): void {
  selectedProjectPath.value = cwd;
  if (activeSessionId.value && !options?.initial && !options?.keepSession) {
    router.push('/sessions');
  }
}

function handleSidebarInitialized(): void {
  sidebarInitialized.value = true;
}

async function switchToSessionProject(): Promise<void> {
  if (!sessionCwd.value) return;
  await sessionSidebarRef.value?.switchToProjectPath(sessionCwd.value);
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(sidebarCollapsedStorageKey) === 'true';
  } catch {
    return false;
  }
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function isDesktopViewport(): boolean {
  return !window.matchMedia('(max-width: 768px)').matches;
}

function toggleSidebarCollapsed() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function toggleGitTool(): void {
  showGitTool.value = !showGitTool.value;
  if (showGitTool.value) sidebarCollapsed.value = false;
}

function submitGitCommand(command: string): void {
  void chatPanelRef.value?.submitExternalPrompt(command);
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }

  await document.documentElement.requestFullscreen();
}

function updateFullscreenState(): void {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

function setTaskQueueVisible(visible: boolean): void {
  showTaskQueue.value = visible;
  sessionStorage.setItem('pi-webui-sidebar-mode', visible ? 'tasks' : 'single');
  showMobileSidebar.value = false;
}

function toggleTaskQueue(): void {
  setTaskQueueVisible(!showTaskQueue.value);
}

function openTitleBarNew(): void {
  showMobileActions.value = false;
  void openNewSessionDialog();
}

async function openNewSessionDialog(cwd?: string) {
  pendingNewSessionPath.value = cwd || selectedProjectPath.value;
  resetWorktreeBranches();
  await refreshSelectedAgentProfileDetails();
  const modelParams = new URLSearchParams({ clientId });
  const [models, statusResponse] = await Promise.all([
    loadAgentProfileModels(selectedAgentProfileId.value),
    activeSessionId.value ? fetch(`/api/sessions/${activeSessionId.value}/status?${modelParams}`) : Promise.resolve(null),
    loadSkills(clientId, pendingNewSessionPath.value),
    loadPresets(),
    loadWorktreeCopyFiles(clientId, pendingNewSessionPath.value),
  ]);
  newSessionModels.value = models;
  const statusData = statusResponse?.ok ? await statusResponse.json() : {};
  const provider = statusData.model?.provider;
  const modelId = statusData.model?.id;
  newSessionInitialModel.value = provider && modelId ? `${provider}\u0000${modelId}` : '';
  showNewSessionDialog.value = true;
}

async function handleRequestWorktreeBranches() {
  await loadWorktreeBranches(clientId, pendingNewSessionPath.value || selectedProjectPath.value);
}

async function loadAgentProfileModels(profileId: string): Promise<ModelOption[]> {
  return cachedLaunchResource(
    launchCacheKey(['models', profileId]),
    async () => {
      const response = await fetch(`/api/sessions/agent-profiles/${encodeURIComponent(profileId)}/models`);
      if (response.ok === false) throw new Error('Failed to load models');
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    },
  ).catch(() => []);
}

async function createSessionFromDialog(payload: { cwd: string; modelProvider?: string; modelId?: string; enabledSkills?: string[]; disabledSkills?: string[]; presetId?: string; worktree?: WorktreePayload }) {
  showNewSessionDialog.value = false;
  await createNewSession(payload);
  await nextTick();
  chatPanelRef.value?.focusInput?.();
}

function formatAgentModelSummary(profile?: { defaultProvider?: string; defaultModel?: string }) {
  if (!profile?.defaultProvider || !profile?.defaultModel) return '';
  return `${profile.defaultProvider} / ${profile.defaultModel}`;
}

function formatAgentName(label: string) {
  return label.replace(/\s+\((?:~|\/)[^)]+\)$/, '');
}

async function refreshSelectedAgentProfileDetails() {
  try {
    const profile = await cachedLaunchResource(
      launchCacheKey(['agent-profile', clientId]),
      async () => {
        const response = await fetch(`/api/sessions/agent-profile?clientId=${encodeURIComponent(clientId)}`);
        const data = await response.json();
        return data.profile || null;
      },
    );
    selectedAgentProfileLabel.value = profile?.label || 'default (~/.pi/agent)';
    selectedAgentProfileId.value = profile?.id || 'default';
    selectedAgentModelSummary.value = formatAgentModelSummary(profile || undefined);
  } catch {
    selectedAgentProfileLabel.value = 'default (~/.pi/agent)';
    selectedAgentModelSummary.value = '';
  }
}

async function handleAgentProfileChanged(profileId: string) {
  selectedAgentProfileId.value = profileId;
  activeReviewSession.value = null;
  selectedReviewSourceLabel.value = '';
  // Stash current UI state into optimisticSessions so it survives the
  // clear-and-refresh cycle below; refreshActiveSessionMetadata will restore
  // it from this map when the summary fetch fails or the session is absent.
  const existingSessionId = activeSessionId.value;
  if (existingSessionId) {
    const optimisticSession = optimisticSessions.value.get(existingSessionId);
    const currentTitle = sessionTitle.value && sessionTitle.value !== DEFAULT_SESSION_TITLE
      ? sessionTitle.value
      : undefined;
    optimisticSessions.value.set(existingSessionId, {
      ...optimisticSession,
      id: existingSessionId,
      name: optimisticSession?.name || currentTitle,
      cwd: sessionCwd.value || optimisticSession?.cwd,
      worktree: activeWorktree.value || optimisticSession?.worktree,
    });
  }

  invalidateLaunchResourceCache(launchCacheKey(['agent-profile', clientId]));
  await refreshSelectedAgentProfileDetails();
  sessionTitle.value = undefined;
  sessionCwd.value = undefined;

  if (!existingSessionId) {
    return;
  }

  const sessionFound = await refreshActiveSessionMetadata(existingSessionId);
  if (!sessionFound) router.push('/sessions');
}

async function startProjectTask(taskId: string): Promise<ProjectTaskStartResult> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || t('app.taskStartFailed', { status: response.status }));
  window.dispatchEvent(new Event('refresh-tasks'));
  return data as ProjectTaskStartResult;
}

async function startTaskFromQueryIfPresent(): Promise<void> {
  const taskId = typeof route.query?.startTask === 'string' ? route.query.startTask : '';
  if (!taskId) return;

  const query = { ...route.query };
  delete query.startTask;
  await router.replace({ path: route.path, query });

  try {
    await handleTaskStarted(await startProjectTask(taskId));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.failedToStartTask'));
  }
}

async function waitForSessionContextReady(): Promise<void> {
  if (isSessionContextReady.value) return;

  await new Promise<void>((resolve) => {
    const stop = watch(isSessionContextReady, (ready) => {
      if (!ready) return;
      stop();
      resolve();
    });
  });
}

async function handleTaskStarted(result: ProjectTaskStartResult): Promise<void> {
  setTaskQueueVisible(false);
  const targetCwd = result.worktree?.worktreePath || result.task.projectPath;
  boundSessionId.value = result.sessionId;
  optimisticSessions.value.set(result.sessionId, {
    id: result.sessionId,
    cwd: targetCwd,
    firstMessage: result.prompt,
    worktree: result.worktree,
  });
  await refreshSelectedAgentProfileDetails();
  await router.push(sessionRouteLocation(result.sessionId, targetCwd));
  if (targetCwd) await sessionSidebarRef.value?.switchToProjectPath(targetCwd);
  else await sessionSidebarRef.value?.loadSessions();
  await waitForSessionContextReady();
  await nextTick();
  const sent = await chatPanelRef.value?.submitExternalPrompt?.(result.prompt);
  if (sent === false) {
    window.alert(t('app.promptNotSent'));
  }
}

async function openTaskSession(sessionId: string): Promise<void> {
  setTaskQueueVisible(false);
  await router.push(sessionRouteLocation(sessionId));
}

function sessionInitial(title: string): string {
  return Array.from(title.trim())[0]?.toLocaleUpperCase() || '?';
}

function handleCompactSessionScroll(event: Event): void {
  const list = event.currentTarget as HTMLElement;
  if (list.scrollHeight - list.scrollTop - list.clientHeight > 80) return;
  void sessionSidebarRef.value?.loadSessions({ append: true });
}

function showCompactSessionContextMenu(event: MouseEvent, sessionId: string): void {
  sessionSidebarRef.value?.showContextMenuForSession(event, sessionId);
}

async function selectSession(session: { id: string; path: string; name?: string; cwd?: string }): Promise<void> {
  activeReviewSession.value = null;
  setTaskQueueVisible(false);
  showMobileSidebar.value = false;
  showMobileActions.value = false;
  router.push(sessionRouteLocation(session.id, session.cwd));
}

function selectCompactSession(session: CompactSession): void {
  if (activeReviewSession.value) {
    handleReviewSessionSelected({
      sourceId: activeReviewSession.value.sourceId,
      sessionId: session.id,
    });
    return;
  }
  void selectSession(session);
}

function handleReviewSourceSelected(sourceId: string, sourceLabel: string): void {
  activeReviewSession.value = null;
  selectedReviewSourceLabel.value = sourceLabel;
  selectedAgentModelSummary.value = '';
}

function handleReviewSessionSelected(event: { sourceId: string; sessionId: string }): void {
  activeReviewSession.value = { sourceId: event.sourceId, sessionId: event.sessionId };
  setTaskQueueVisible(false);
  showMobileSidebar.value = false;
  showMobileActions.value = false;
  const query: Record<string, string> = { profile: event.sourceId };
  if (selectedProjectPath.value && selectedProjectPath.value !== '~') {
    query.project = selectedProjectPath.value;
  }
  void router.push({ path: `/sessions/${event.sessionId}`, query });
}

function showMemoryCenterForRun(runId?: string): void {
  showMobileSidebar.value = false;
  showMobileActions.value = false;
  memoryReviewRunId.value = runId;
  showMemoryCenter.value = true;
}

function openMemoryCenter(): void {
  showMemoryCenterForRun();
}

function reviewMemoryExtraction(runId: string): void {
  showMemoryCenterForRun(runId);
}

function closeMemoryCenter(): void {
  showMemoryCenter.value = false;
  memoryReviewRunId.value = undefined;
}

function openMemorySourceSession(sessionId: string): void {
  closeMemoryCenter();
  router.push(sessionRouteLocation(sessionId));
}

async function extractSessionMemories(sessionId: string): Promise<void> {
  try {
    await memory.extractSession(sessionId);
  } catch {
    // The memory controller exposes the request error through its reactive state.
  }
}

async function undoMemoryExtraction(runId: string): Promise<void> {
  try {
    await memory.undoExtraction(runId);
    memory.dismissToast();
  } catch {
    // Keep the toast visible; the sidebar exposes the controller error state.
  }
}

function openSearch() {
  showMobileActions.value = false;
  showSearch.value = true;
}

async function openSettings() {
  await Promise.all([loadSkills(clientId, selectedProjectPath.value), loadPresets()]);
  showSettings.value = true;
}

function handleClearLaunchCache() {
  invalidateLaunchResourceCache();
}

async function handleSaveGitSettings(payload: {
  gitea?: { serverUrl: string; token: string };
  github?: { serverUrl: string; token: string };
  gitCloneParentPath?: string;
  githubProxyUrl?: string;
}) {
  gitSettingsSaving.value = true;
  try {
    const saves: Promise<unknown>[] = [];
    if (payload.gitea) saves.push(gitHosting.saveSettings(payload.gitea));
    if (payload.github) saves.push(gitHosting.saveGithubSettings(payload.github));
    if (payload.githubProxyUrl !== undefined) saves.push(gitHosting.saveGithubProxyUrl(payload.githubProxyUrl));
    if (payload.gitCloneParentPath !== undefined) saves.push(Promise.resolve(setGitCloneParentPath(payload.gitCloneParentPath)));
    await Promise.all(saves);
    gitSaveSuccessTick.value += 1;
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.failedToSaveGitSettings'));
  } finally {
    gitSettingsSaving.value = false;
  }
}

async function handleSaveGatewaySettings(payload: { cwds: string[]; defaultProfile: string; defaultSkillset: string; defaultModelProvider: string; defaultModelId: string }) {
  gatewaySettingsSaving.value = true;
  try {
    await gatewaySettings.saveSettings(payload);
    gatewaySaveSuccessTick.value += 1;
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.failedToSaveGatewaySettings'));
  } finally {
    gatewaySettingsSaving.value = false;
  }
}

async function handleClearGiteaSettings() {
  try {
    await gitHosting.clearSettings();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.failedToClearGiteaSettings'));
  }
}

async function handleTestGiteaConnection(payload: { serverUrl: string; token: string }) {
  try {
    await gitHosting.testConnection(payload);
    window.alert(t('app.giteaConnectionSucceeded'));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.giteaConnectionFailed'));
  }
}

async function handleClearGithubSettings() {
  try {
    await gitHosting.clearGithubSettings();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.failedToClearGithubSettings'));
  }
}

async function handleTestGithubConnection(payload: { serverUrl: string; token: string }) {
  try {
    await gitHosting.testGithubConnection(payload);
    window.alert(t('app.githubConnectionSucceeded'));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : t('app.githubConnectionFailed'));
  }
}

async function handleTestGithubProxy(value: string) {
  githubProxyChecking.value = true;
  githubProxyCheckResult.value = null;
  try {
    const result = await gitHosting.testGithubProxy(value);
    githubProxyCheckResult.value = result.ok ? 'ok' : 'failed';
  } catch (error) {
    githubProxyCheckResult.value = 'failed';
    window.alert(error instanceof Error ? error.message : t('app.githubProxyCheckFailed'));
  } finally {
    githubProxyChecking.value = false;
  }
}

async function handleCreateSkillPreset(payload: { name: string; mode: 'enabled' | 'disabled'; skills: string[] }) {
  await createPreset(payload);
}

async function handleUpdateSkillPreset(payload: { id: string; changes: { name: string; mode: 'enabled' | 'disabled'; skills: string[] } }) {
  await updatePreset(payload.id, payload.changes);
}

async function handleDeleteSkillPreset(id: string) {
  await deletePreset(id);
}

async function handleSearchSelect(sessionId: string) {
  try {
    const response = await fetch(`/api/sessions/${sessionId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    const data = await response.json();
    if (data.success) {
      router.push(sessionRouteLocation(sessionId));
    }
  } catch (error) {
    console.error('Failed to resume session:', error);
  }
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .xterm'));
}

function isTerminalKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('.xterm'));
}

function hasBlockingOverlayOpen() {
  return showSearch.value
    || showSettings.value
    || showMemoryCenter.value
    || showNewSessionDialog.value
    || showDeleteConfirm.value
    || showFinishWorktreeConfirm.value;
}

function isEditorToggleShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && (event.code === 'KeyE' || event.key.toLowerCase() === 'e');
}

function handleEditorToggleKeydown(event: KeyboardEvent): void {
  // Capture Ctrl+E before selected message/code elements can stop bubbling.
  // Keep terminal Ctrl+E available for shell line editing.
  if (!isEditorToggleShortcut(event)
    || hasBlockingOverlayOpen()
    || isTerminalKeyboardTarget(event.target)) {
    return;
  }

  event.preventDefault();
  if (!event.repeat) showEditor.value = !showEditor.value;
}

function formatFullscreenShortcut(shortcut: string): string {
  return shortcut === 'ctrlShiftF' ? 'Ctrl+Shift+F' : 'F11';
}

function isProjectSelectorShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey
    && event.altKey
    && !event.metaKey
    && !event.shiftKey
    && event.code === 'KeyP';
}

function isFullscreenToggleShortcut(event: KeyboardEvent): boolean {
  if (fullscreenShortcut.value === 'ctrlShiftF') {
    return event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey && event.code === 'KeyF';
  }
  return event.key === 'F11' && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function isTaskQueueToggleShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey
    && !event.shiftKey
    && !event.metaKey
    && !event.altKey
    && event.code === 'KeyQ';
}

function handleKeydown(event: KeyboardEvent) {
  if (isProjectSelectorShortcut(event)) {
    event.preventDefault();
    if (!event.repeat && !hasBlockingOverlayOpen()) {
      sidebarCollapsed.value = false;
      void sessionSidebarRef.value?.focusProjectPath();
    }
    return;
  }

  if (isFullscreenToggleShortcut(event)) {
    event.preventDefault();
    if (!event.repeat) void toggleFullscreen();
    return;
  }

  if (isTaskQueueToggleShortcut(event)) {
    event.preventDefault();
    if (!event.repeat && !hasBlockingOverlayOpen() && !isTerminalKeyboardTarget(event.target)) {
      toggleTaskQueue();
    }
    return;
  }

  // When focus is on the page background, use simple vim-like keys for chat focus.
  // Alt variants are kept, but plain keys avoid browser/extension shortcut conflicts.
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !hasBlockingOverlayOpen() && !isEditableKeyboardTarget(event.target)) {
    const key = event.key.toLowerCase();
    if (key === 'i') {
      event.preventDefault();
      chatPanelRef.value?.focusInput?.();
      return;
    }
    if (key === 'h') {
      event.preventDefault();
      chatPanelRef.value?.focusMessagesEnd();
      return;
    }
    if (key === '/') {
      event.preventDefault();
      chatPanelRef.value?.focusInput?.({ prefix: '/' });
      return;
    }
  }

  // Cmd/Ctrl + K to open search
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    openSearch();
  }
  // Avoid plain Ctrl/Cmd + N, which browsers use for a new window.
  const isNewSessionShortcut = event.ctrlKey
    && event.code === 'KeyN'
    && newSessionShortcut.value !== 'disabled'
    && (newSessionShortcut.value === 'ctrlMetaN' ? event.metaKey && !event.altKey : event.altKey && !event.metaKey);
  if (isNewSessionShortcut) {
    event.preventDefault();
    if (!event.repeat) void openNewSessionDialog();
  }
  // Cmd/Ctrl + ` to toggle terminal
  if ((event.metaKey || event.ctrlKey) && event.key === '`') {
    event.preventDefault();
    toggleTerminalPanel();
  }
  // Cmd/Ctrl + B to toggle desktop sidebar
  if ((event.metaKey || event.ctrlKey) && event.code === 'KeyB' && isDesktopViewport()) {
    event.preventDefault();
    if (!event.repeat) toggleSidebarCollapsed();
  }
}

function resolveFilePath(filePath: string, cwd: string): string {
  const normalizedFilePath = normalizePathSeparators(filePath);
  if (normalizedFilePath.startsWith('/') || normalizedFilePath.startsWith('~/') || /^[A-Za-z]:\//.test(normalizedFilePath)) {
    return normalizedFilePath;
  }

  // Expand bare ~ to ~/ so path joining works correctly.
  const normalizedCwd = normalizePathSeparators(cwd);
  const expandedCwd = normalizedCwd === '~' ? '~/' : normalizedCwd;
  const base = expandedCwd.endsWith('/') ? expandedCwd : expandedCwd + '/';
  const fullPath = base + normalizedFilePath;
  const isAbsolute = fullPath.startsWith('/');
  const parts = fullPath.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') { resolved.pop(); continue; }
    resolved.push(part);
  }
  return isAbsolute ? '/' + resolved.join('/') : resolved.join('/');
}

async function searchProjectFiles(pattern: string, cwd: string): Promise<string[]> {
  const searchPath = cwd === '~' ? undefined : cwd;
  const params = new URLSearchParams({
    pattern,
    ...(searchPath ? { path: searchPath } : {}),
  });
  const res = await fetch(`/api/files/search?${params}`);
  const data = await res.json();
  return data.files || [];
}

function pickBestPathMatch(files: string[], requestedPath: string): string | undefined {
  const normalizedRequestedPath = normalizePathSeparators(requestedPath);
  const exact = files.find((file: string) => normalizePathSeparators(file) === normalizedRequestedPath);
  if (exact) return exact;

  const suffix = `/${normalizedRequestedPath}`;
  const suffixMatches = files.filter((file: string) => normalizePathSeparators(file).endsWith(suffix));
  if (!suffixMatches.length) return files[0];

  return suffixMatches.sort((a: string, b: string) => {
    const depthDiff = normalizePathSeparators(a).split('/').length - normalizePathSeparators(b).split('/').length;
    return depthDiff || a.localeCompare(b);
  })[0];
}

async function resolveSearchableFilePath(filePath: string, cwd: string): Promise<string | undefined> {
  const directMatches = await searchProjectFiles(filePath, cwd);
  const directMatch = pickBestPathMatch(directMatches, filePath);
  if (directMatch) return resolveFilePath(directMatch, cwd);

  const suffixMatches = await searchProjectFiles(`**/${filePath}`, cwd);
  const suffixMatch = pickBestPathMatch(suffixMatches, filePath);
  return suffixMatch ? resolveFilePath(suffixMatch, cwd) : undefined;
}

async function handleOpenVirtualDiffInEditor(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (!detail?.cwd || !detail.scope || typeof detail.content !== 'string') return;

  showEditor.value = true;
  const editorPanel = await waitForEditorPanel();
  editorPanel.openVirtualDiff({
    cwd: detail.cwd,
    scope: detail.scope,
    content: detail.content,
  });
}

async function handleOpenFileInEditor(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (!detail?.path) return;
  if (detail.onlyIfEditorVisible && !showEditor.value) return;

  const cwd = sessionCwd.value || selectedProjectPath.value;
  let filePath: string;

  if (detail.kind === 'filename') {
    try {
      const resolvedPath = await resolveSearchableFilePath(detail.path, cwd);
      if (!resolvedPath) return;
      filePath = resolvedPath;
    } catch {
      return;
    }
  } else if (!detail.path.startsWith('/') && !detail.path.startsWith('~/') && detail.path.includes('/')) {
    try {
      filePath = await resolveSearchableFilePath(detail.path, cwd) || resolveFilePath(detail.path, cwd);
    } catch {
      filePath = resolveFilePath(detail.path, cwd);
    }
  } else {
    filePath = resolveFilePath(detail.path, cwd);
  }

  showEditor.value = true;
  const editorPanel = await waitForEditorPanel();
  editorPanel.openFile(filePath, detail.line, detail.column);
}

// Terminal management: maps terminal_id -> TerminalInstance for cleanup
const terminalInstanceMap = new Map<string, TerminalInstance>();

watch(resolvedTheme, (theme) => {
  if (!terminalRuntime) return;
  terminalInstanceMap.forEach((instance) => terminalRuntime?.applyTerminalTheme(instance, theme));
});

async function handleCreateTerminal() {
  const runtime = await loadTerminalRuntime();
  if (!showTerminal.value) return;
  const terminalId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session = createTerminalSession(terminalId, 'shell', activeProjectPath.value);

  // Create terminal instance
  const instance = runtime.createTerminalInstance();
  runtime.applyTerminalTheme(instance, resolvedTheme.value);
  terminalInstanceMap.set(terminalId, instance);

  // After DOM update, open terminal in host element and connect
  const checkAndInit = () => {
    if (session.hostEl) {
      runtime.openTerminal(instance, session.hostEl);
      runtime.connectTerminal(instance, clientId, session.cwd, (_termId, shell) => {
        // Update the session label with the actual shell name from the server
        const s = terminalSessions.value.find(t => t.terminal_id === terminalId);
        if (s) s.label = shell;
      }, (_termId, _exitCode) => {
        // Auto-close the tab after a short delay so the user can see the exit message
        setTimeout(() => handleCloseTerminal(terminalId), 1500);
      }, () => {
        // The server disposes the PTY when the WebSocket closes. Remove the stale tab
        // so the user can immediately create a fresh terminal after an idle timeout.
        setTimeout(() => handleCloseTerminal(terminalId), 1500);
      });

      // Set up resize observer
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => {
          runtime.fitTerminal(instance);
        });
        observer.observe(session.hostEl);
        session.resizeObserver = observer;
      }
    } else {
      // Host element not ready yet, retry
      setTimeout(checkAndInit, 50);
    }
  };
  setTimeout(checkAndInit, 100);
}

function handleCloseTerminal(terminalId: string) {
  const instance = terminalInstanceMap.get(terminalId);
  if (instance) {
    terminalRuntime?.disposeTerminal(instance);
    terminalInstanceMap.delete(terminalId);
  }
  removeTerminalSession(terminalId);
}

function handleSessionsRefresh() {
  refreshActiveSessionMetadata();
}

function handleFirstMessage(event: Event) {
  const detail = (event as CustomEvent<{ id?: string; firstMessage?: string }>).detail;
  if (!detail?.id || !detail.firstMessage) return;

  const optimisticSession = optimisticSessions.value.get(detail.id);
  if (!optimisticSession || optimisticSession.name || optimisticSession.firstMessage) return;

  const nextSession = {
    ...optimisticSession,
    firstMessage: detail.firstMessage,
  };
  optimisticSessions.value.set(detail.id, nextSession);

  if (activeSessionId.value === detail.id) {
    sessionTitle.value = formatSessionTitle(nextSession);
    sessionCwd.value = nextSession.cwd;
  }
}

let authenticatedAppReady = false;

async function initializeAuthenticatedApp(): Promise<void> {
  await Promise.all([
    loadPreferences(),
    gitHosting.loadSettings().catch(() => {}),
    gatewaySettings.loadSettings().catch(() => {}),
    refreshSelectedAgentProfileDetails(),
  ]);
  authenticatedAppReady = true;
  if (isConnected.value) await startTaskFromQueryIfPresent();
}

watch(isAuthenticated, (authenticated) => {
  if (authenticated) void initializeAuthenticatedApp();
  else authenticatedAppReady = false;
}, { immediate: true });

// A newly opened tab cannot submit the task prompt until its chat socket is ready.
watch(isConnected, (connected) => {
  if (connected && authenticatedAppReady) void startTaskFromQueryIfPresent();
});

onMounted(() => {
  authRefreshMounted = true;
  const savedSidebarMode = sessionStorage.getItem('pi-webui-sidebar-mode');
  if (savedSidebarMode === 'single' || savedSidebarMode === 'tasks') {
    showTaskQueue.value = savedSidebarMode === 'tasks';
  } else if (savedSidebarMode) {
    sessionStorage.removeItem('pi-webui-sidebar-mode');
  }
  void refreshAuth();
  window.addEventListener('keydown', handleEditorToggleKeydown, true);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('refresh-sessions', handleSessionsRefresh);
  window.addEventListener('session-first-message', handleFirstMessage);
  window.addEventListener('session-streaming-state', handleSessionStreamingState);
  window.addEventListener('open-file-in-editor', handleOpenFileInEditor);
  window.addEventListener('open-virtual-diff-in-editor', handleOpenVirtualDiffInEditor);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('fullscreenchange', updateFullscreenState);
  updateFullscreenState();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleEditorToggleKeydown, true);
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('refresh-sessions', handleSessionsRefresh);
  window.removeEventListener('session-first-message', handleFirstMessage);
  window.removeEventListener('session-streaming-state', handleSessionStreamingState);
  window.removeEventListener('open-file-in-editor', handleOpenFileInEditor);
  window.removeEventListener('open-virtual-diff-in-editor', handleOpenVirtualDiffInEditor);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('fullscreenchange', updateFullscreenState);
  authRefreshMounted = false;
  clearAuthRefreshTimer();
  disposeAllTerminals();
  terminalInstanceMap.forEach(instance => terminalRuntime?.disposeTerminal(instance));
  terminalInstanceMap.clear();
});
</script>

<style scoped>
.app-loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
}

.app {
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  overflow: hidden;
}

.app-utility-rail {
  flex: 0 0 60px;
  width: 60px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px 0 12px 12px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.sidebar-logo {
  position: relative;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(108, 140, 255, 0.22), rgba(74, 222, 128, 0.1));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 18px rgba(0, 0, 0, 0.24);
}

.sidebar-logo img {
  width: 30px;
  height: 30px;
  display: block;
  border-radius: 10px;
}

.connection-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-full);
  background: var(--error);
  box-shadow: 0 0 0 2px var(--bg-secondary), 0 0 0 3px rgba(248, 113, 113, 0.28);
}

.sidebar-logo.connected .connection-badge {
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-secondary), 0 0 0 3px rgba(74, 222, 128, 0.28);
}

.utility-rail-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.utility-rail-primary {
  margin-top: 20px;
}

.utility-rail-sessions {
  width: 36px;
  min-height: 0;
  margin-top: 18px;
  padding-top: 18px;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  scrollbar-width: none;
}

.utility-rail-sessions::-webkit-scrollbar {
  display: none;
}

.utility-rail-session {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--text-secondary);
  background: var(--bg-surface);
  font-size: 0.9375rem;
  font-weight: 700;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.utility-rail-session:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.utility-rail-session.active {
  color: var(--sidebar-selected-text);
  background: var(--sidebar-selected-bg);
}

.utility-session-status {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 7px;
  height: 7px;
  border: 2px solid var(--bg-secondary);
  border-radius: var(--radius-full);
}

.utility-session-status.streaming {
  right: 0;
  bottom: 0;
  width: 10px;
  height: 10px;
  background: var(--success);
}

.utility-session-status.ready {
  background: var(--warning);
}

.utility-rail-bottom {
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.utility-rail-btn {
  position: relative;
  width: 36px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.utility-rail-btn:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.utility-rail-btn:active {
  transform: scale(0.94);
}

.utility-rail-btn.active {
  background: var(--accent-muted);
  color: var(--accent);
}

/* Rail tooltips open toward the content instead of below the vertical buttons. */
.app-utility-rail .tooltip::after {
  top: 50%;
  left: calc(100% + 8px);
  transform: translateY(-50%);
}

.sidebar-memory-btn.has-error {
  color: var(--warning);
}

.memory-pending-badge {
  position: absolute;
  top: -4px;
  right: -6px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 2px solid var(--bg-secondary);
  border-radius: var(--radius-full);
  color: var(--bg-primary);
  background: var(--accent);
  font-size: 0.5625rem;
  font-weight: 800;
  line-height: 1;
}

.memory-error-indicator {
  position: absolute;
  left: 4px;
  bottom: 4px;
  width: 6px;
  height: 6px;
  border: 1px solid var(--bg-secondary);
  border-radius: var(--radius-full);
  background: var(--warning);
}

.header-actions .mobile-title-new-btn {
  display: none;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  min-width: 0;
  padding: 0 1rem;
  height: 56px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}

.header-title {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 0.265rem;
  overflow: hidden;
  white-space: nowrap;
}

.finish-worktree-preview {
  text-align: left;
}

.finish-worktree-preview p {
  margin: 0 0 0.875rem;
}

.cleanup-list {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  margin: 0;
  padding-left: 1.125rem;
}

.cleanup-list li {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.cleanup-list code {
  display: block;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1.35;
  word-break: break-all;
}

.cleanup-list em,
.preview-error {
  color: var(--warning);
  font-style: normal;
}

.session-title-text,
.session-title-input {
  box-sizing: border-box;
  width: 100%;
  height: 1.5rem;
  min-width: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.2;
}

.session-title-text {
  overflow: hidden;
  line-height: 1.5rem;
  text-overflow: ellipsis;
}

.session-title-input {
  max-width: 20rem;
  padding: 0.125rem 0.25rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  outline: none;
}

.header-metadata {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.71875rem;
  line-height: 1.15;
}

.session-cwd {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
  color: inherit;
  white-space: nowrap;
}

.session-cwd > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-cwd-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.session-cwd-switch:hover {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.session-cwd-switch-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-cwd-switch-label {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 0.6875rem;
  font-weight: 600;
}

.git-branch-pill,
.agent-pill,
.pull-request-pill {
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 180px;
  color: var(--text-tertiary);
  font-weight: 500;
  text-decoration: none;
}

.git-branch-pill {
  color: var(--accent);
}

.agent-pill {
  color: #a78bfa;
}

.pull-request-pill {
  color: #60a5fa;
  cursor: pointer;
}

.pull-request-pill.merged {
  color: #c084fc;
}

.git-branch-pill svg,
.agent-pill svg,
.pull-request-pill svg {
  flex: 0 0 auto;
}

.git-branch-pill span,
.agent-pill span,
.pull-request-pill span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.mobile-actions-wrap {
  display: none;
  position: relative;
}

.mobile-actions-menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  z-index: 1002;
  min-width: 220px;
  padding: 0.375rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  box-shadow: var(--shadow-xl);
}

.mobile-action-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.9375rem;
  text-align: left;
}

.mobile-action-item:hover,
.mobile-action-item.active {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.mobile-action-item.danger {
  color: var(--error);
}

.mobile-action-item:disabled {
  opacity: 0.55;
}

.mobile-actions-backdrop {
  display: none;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}

.icon-btn:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.icon-btn:active {
  transform: scale(0.92);
}

.icon-btn.active {
  background: var(--accent-muted);
  color: var(--accent);
}

.delete-btn:hover {
  background: var(--error-muted);
  color: var(--error);
}

/* Tooltips */
.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.75rem;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
  border: 1px solid var(--border);
  z-index: 100;
  box-shadow: var(--shadow-md);
}

.tooltip:hover::after {
  opacity: 1;
}

/* ── Mobile header controls (hidden on desktop) ─────────────────────────── */

.mobile-task-close,
.mobile-hamburger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.mobile-hamburger:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

/* ── Mobile sidebar backdrop ─────────────────────────────────────────────── */

.mobile-sidebar-backdrop {
  display: none;
}

/* ── Mobile responsive (< 768px) ───────────────────────────────────────── */

@media (max-width: 768px) {
  .app-utility-rail {
    display: none;
  }

  .mobile-task-close,
  .mobile-hamburger {
    display: flex;
  }

  .header-actions .mobile-title-new-btn {
    display: inline-flex;
  }

  .header {
    height: calc(56px + var(--safe-top));
    padding: 0 0.75rem;
    padding-left: max(0.75rem, var(--safe-left));
    padding-right: max(0.75rem, var(--safe-right));
    padding-top: var(--safe-top);
  }

  .header-actions .icon-btn:not(.title-new-btn):not(.mobile-task-close):not(.mobile-actions-toggle) {
    display: none;
  }

  .mobile-actions-wrap {
    display: block;
  }

  .mobile-actions-toggle {
    display: inline-flex;
  }

  .mobile-actions-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1001;
    background: transparent;
  }

  .header-title {
    gap: 0.18rem;
  }

  .header-metadata {
    gap: 0.375rem;
  }

  .session-cwd-switch-label {
    display: none;
  }

  /* Sidebar becomes fixed overlay */
  :deep(.session-sidebar) {
    position: fixed !important;
    top: 0;
    left: 0;
    width: 85vw !important;
    max-width: 320px !important;
    height: 100vh !important;
    height: 100dvh !important;
    z-index: 1000;
    transform: translateX(-100%);
    transition: transform var(--duration-slow) var(--ease-out);
    border-right: 1px solid var(--border);
  }

  :deep(.session-sidebar.mobile-open) {
    transform: translateX(0);
  }

  :deep(.session-sidebar .sidebar-resize-handle) {
    display: none;
  }

  /* Backdrop */
  .mobile-sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
    -webkit-tap-highlight-color: transparent;
  }

  /* Terminal panel full-screen */
  :deep(.terminal-panel) {
    position: fixed !important;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100% !important;
    height: 100% !important;
    border-radius: 0 !important;
    border: none !important;
    z-index: 1100 !important;
  }

  :deep(.terminal-panel .resize-handle) {
    display: none !important;
  }

  /* Editor and task queue panels full-screen */
  :deep(.task-queue-panel),
  :deep(.editor-panel) {
    position: fixed !important;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    border: none !important;
    z-index: 1100 !important;
  }

  :deep(.editor-panel .editor-resize-handle) {
    display: none !important;
  }

  /* Chat input area stacking */
  :deep(.chat-panel .input-area) {
    flex-wrap: wrap;
    padding: 0.75rem;
    padding-left: max(0.75rem, var(--safe-left));
    padding-right: max(0.75rem, var(--safe-right));
    padding-bottom: max(0.75rem, var(--safe-bottom));
  }

  :deep(.chat-panel .composer-actions) {
    flex: 1;
    min-width: 0;
  }

  :deep(.chat-panel .send-btn),
  :deep(.chat-panel .stop-btn) {
    flex: 1;
    min-height: 40px;
  }

  /* Touch-friendly icon buttons */
  :deep(.icon-btn) {
    min-width: 32px;
    min-height: 32px;
  }
}


</style>
