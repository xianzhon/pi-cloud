<!-- client/src/components/SessionSidebar.vue -->
<template>
  <aside class="session-sidebar" :class="{ collapsed }" :style="{ '--session-sidebar-width': `${sidebarWidth}px` }">
    <div class="sidebar-header">
      <h3>Pi WebUI <span class="version-tag">v{{ version }}</span></h3>
      <div class="sidebar-header-actions">
        <button class="mobile-close-btn" @click="$emit('close')" :aria-label="t('components.sessionSidebar.closeSidebar')">
          <PhX :size="18" weight="bold" />
        </button>
      </div>
    </div>

    <div class="agent-picker">
      <div class="agent-picker-header">
        <label>
          {{ t('components.sessionSidebar.agent') }}
          <span
            v-if="selectedAgentModelSummary"
            class="agent-model-summary"
            :title="selectedAgentModelSummary"
          >
            ({{ selectedAgentModelSummary }})
          </span>
        </label>
      </div>
      <div class="agent-profile-row">
        <div class="agent-profile-input-wrapper">
          <input
            :value="selectedAgentProfileLabel"
            class="agent-profile-input"
            :title="t('components.sessionSidebar.selectedAgentProfile')"
            @focus="openAgentProfileList"
            @click="openAgentProfileList"
            @blur="closeAgentProfileList"
            readonly
          />
          <div
            v-if="isAgentProfileListOpen && agentProfiles.length > 0"
            class="agent-profile-list bounded"
          >
            <button
              v-for="profile in agentProfiles"
              :key="profile.id"
              type="button"
              class="agent-profile-option"
              @mousedown.prevent="chooseAgentProfile(profile.id)"
            >
              {{ profile.label }}
            </button>
            <button type="button" class="agent-profile-option" @mousedown.prevent="showProfileManager = true">{{ t('components.sessionSidebar.manageProfiles') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="scope-toggle">
      <button
        :class="{ active: scope === 'project' }"
        @click="scope = 'project'; loadSessions()"
        @mouseenter="showTooltip($event, t('components.sessionSidebar.projectSessionsTooltip'), 'right')"
        @mouseleave="hideTooltip"
        @touchstart="hideTooltip"
      >
        {{ t('components.sessionSidebar.project') }}
      </button>
      <button
        :class="{ active: scope === 'all' }"
        @click="scope = 'all'; loadSessions()"
        @mouseenter="showTooltip($event, t('components.sessionSidebar.allSessionsTooltip'), 'top')"
        @mouseleave="hideTooltip"
        @touchstart="hideTooltip"
      >
        {{ t('components.sessionSidebar.all') }}
      </button>
    </div>

    <div v-if="scope === 'project'" class="project-picker">
      <div class="project-path-row">
        <div class="project-path-input-wrapper">
          <input
            ref="projectPathInput"
            :value="isRecentProjectListOpen ? projectPathQuery : projectPathDisplay"
            class="project-path-input"
            :aria-label="t('components.sessionSidebar.projectPathCtrlAltP')"
            :placeholder="isRecentProjectListOpen ? t('components.sessionSidebar.searchProjects') : ''"
            @mouseenter="showTooltip($event, projectPath, 'top')"
            @mouseleave="hideTooltip"
            @touchstart="hideTooltip"
            @focus="openRecentProjectList"
            @click="openRecentProjectList"
            @input="handleProjectPathInput"
            @blur="handleProjectPathBlur"
            @keydown.down.prevent="moveRecentProjectSelection(1)"
            @keydown.up.prevent="moveRecentProjectSelection(-1)"
            @keydown.enter.prevent="selectActiveRecentProject()"
            @keydown.escape.prevent="closeRecentProjectList"
          />
          <div
            v-if="isRecentProjectListOpen && filteredProjectPathOptions.length > 0"
            ref="recentProjectList"
            class="recent-project-list bounded"
          >
            <button
              v-for="(option, index) in filteredProjectPathOptions"
              :key="option"
              type="button"
              class="recent-project-option"
              :class="{ active: index === activeRecentProjectIndex }"
              @mouseenter="showTooltip($event, option, 'right')"
              @mouseleave="hideTooltip"
              @touchstart="hideTooltip"
              @mousedown.prevent="chooseRecentProjectPath(option)"
            >
              {{ formatProjectPath(option) }}
            </button>
          </div>
        </div>
        <button class="folder-btn" :title="t('components.sessionSidebar.browseFolders')" @click="showFolderPicker = true">
          <PhFolder :size="16" weight="bold" />
        </button>
      </div>
      <div v-if="projectPathError" class="project-path-error">{{ projectPathError }}</div>
    </div>
    
    <div ref="sessionList" class="session-list" @scroll="handleSessionListScroll">
      <div 
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === activeSessionId }"
        @click="selectSession(session)"
        @contextmenu.prevent="showContextMenu($event, session)"
        @mouseenter="showTooltip($event, formatSessionTitle(session))"
        @mouseleave="hideTooltip"
        @touchstart="hideTooltip"
      >
        <div class="session-name">
          <span
            v-if="session.isStreaming"
            class="live-indicator"
            :title="t('components.sessionSidebar.liveSession')"
            :aria-label="t('components.sessionSidebar.liveSession')"
          ></span>
          <span
            v-else-if="isSessionReady(session.id)"
            class="ready-indicator"
            :title="t('components.sessionSidebar.readyForReview')"
            :aria-label="t('components.sessionSidebar.readyForReview')"
          >🔔</span>
          {{ formatSessionTitle(session) }}
        </div>
        <div class="session-meta">
          <span>{{ formatDate(session.modified) }}</span>
          <span>{{ t('components.sessionSidebar.userMessages', { count: session.messageCount }) }}</span>
          <span
            v-if="session.worktree"
            class="session-worktree-status"
            :class="session.worktree.worktreeStatus || 'active'"
            :title="worktreeSessionTitle(session)"
            :aria-label="worktreeSessionTitle(session)"
          >
            <PhGitBranch :size="13" weight="bold" aria-hidden="true" />
            <span>WT</span>
          </span>
          <span
            v-if="session.pullRequest"
            class="session-pr-status"
            :class="session.pullRequest.status"
            :title="session.pullRequest.status === 'merged' ? t('components.sessionSidebar.pullRequestMerged') : t('components.sessionSidebar.pullRequestReady')"
            :aria-label="session.pullRequest.status === 'merged' ? t('components.sessionSidebar.pullRequestMerged') : t('components.sessionSidebar.pullRequestReady')"
          >
            <PhGitMerge
              v-if="session.pullRequest.status === 'merged'"
              :size="13"
              weight="bold"
              aria-hidden="true"
            />
            <PhGitPullRequest v-else :size="13" weight="bold" aria-hidden="true" />
          </span>
        </div>
      </div>
      
      <div v-if="sessions.length === 0 && !isLoadingMore" class="empty-state">
        {{ t('components.sessionSidebar.noSessionsFound') }}
      </div>
      <div v-if="isLoadingMore" class="session-list-status" role="status">
        {{ sessions.length === 0 ? t('components.sessionSidebar.loadingSessions') : t('components.sessionSidebar.loadingOlderSessions') }}
      </div>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="session-context-menu"
        :style="{ left: `${contextMenu.left}px`, top: `${contextMenu.top}px` }"
        @click.stop
      >
        <button
          v-if="canGoToSessionProject"
          class="switch-to-project-btn"
          @click="goToSessionProject"
        >
          <PhFolder :size="14" /> {{ t('components.sessionSidebar.switchToThisProject') }}
        </button>
        <button
          v-if="canOpenSessionProjectInNewTab"
          @click="openSessionProjectInNewTab"
        >
          <PhArrowSquareOut :size="14" /> {{ t('components.sessionSidebar.openProjectInNewTab') }}
        </button>
        <button
          v-if="canCreateSessionWithSameSettings"
          @click="createSessionWithSameSettings"
        >
          <PhPlus :size="14" /> {{ t('components.sessionSidebar.newSessionWithSameSettings') }}
        </button>
        <button class="extract-memories-btn" @click="extractMemoriesFromSession">
          <PhBrain :size="14" /> {{ t('components.sessionSidebar.extractMemories') }}
        </button>
        <button @click="openRenameDialog"><PhPencilSimple :size="14" /> {{ t('components.sessionSidebar.rename') }}</button>
        <button class="danger" @click="openDeleteConfirm"><PhTrash :size="14" /> {{ t('components.sessionSidebar.delete') }}</button>
      </div>
    </Teleport>

    <!-- Rename dialog -->
    <InputPromptModal
      :visible="renameDialog.visible"
      :title="t('components.sessionSidebar.renameSession')"
      :label="t('components.sessionSidebar.sessionName')"
      :placeholder="t('components.sessionSidebar.enterANameForThisSession')"
      :model-value="renameDialog.value"
      :confirm-text="t('components.sessionSidebar.rename')"
      @confirm="confirmRename"
      @cancel="renameDialog.visible = false"
    />

    <!-- Delete confirmation -->
    <ConfirmModal
      :visible="deleteConfirm.visible"
      variant="danger"
      :confirm-text="t('components.sessionSidebar.delete')"
      @confirm="confirmDeleteSession"
      @cancel="deleteConfirm.visible = false"
    >
      <template #icon><PhTrash :size="22" weight="duotone" /></template>
      <template #title>{{ t('components.sessionSidebar.deleteSession') }}</template>
      <template #message>{{ t('components.sessionSidebar.areYouSureYouWantToDelete') }}</template>
    </ConfirmModal>

    <footer class="sidebar-footer">
      <span v-if="username" class="sidebar-username" :title="username">{{ username }}</span>
      <div class="sidebar-footer-actions">
        <button
          class="sidebar-footer-btn"
          type="button"
          :aria-label="t('components.sessionSidebar.logOut')"
          @click="logout"
          @mouseenter="showTooltip($event, t('components.sessionSidebar.logOut'), 'top')"
          @mouseleave="hideTooltip"
          @touchstart="hideTooltip"
        >
          <PhSignOut :size="18" weight="bold" />
        </button>
      </div>
    </footer>
    
    <Teleport to="body">
      <div 
        v-if="tooltip.visible" 
        class="session-tooltip"
        :class="`placement-${tooltip.placement}`"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        {{ tooltip.text }}
      </div>
    </Teleport>

    <ProfileManagerDialog
      :visible="showProfileManager"
      :profiles="agentProfiles"
      :selected-id="selectedAgentProfile"
      @close="showProfileManager = false"
      @created="handleProfileCreated"
      @updated="loadAgentProfiles"
      @deleted="handleProfileDeleted"
    />

    <FolderPickerModal
      :visible="showFolderPicker"
      :initialPath="projectPath"
      :currentProjectPath="projectPath"
      :client-id="clientId"
      @close="showFolderPicker = false"
      @select="setProjectPath"
    />

    <div
      class="sidebar-resize-handle"
      :class="{ 'is-resizing': isSidebarResizing }"
      :title="t('components.sessionSidebar.resizeSessionList')"
      @mousedown="startSidebarResize"
    />
  </aside>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { formatHomePath } from '../utils/paths';
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { PhBrain, PhFolder, PhX, PhPencilSimple, PhTrash, PhSignOut, PhPlus, PhArrowSquareOut, PhGitMerge, PhGitPullRequest, PhGitBranch } from '@phosphor-icons/vue';
import FolderPickerModal from './FolderPickerModal.vue';
import InputPromptModal from './InputPromptModal.vue';
import ConfirmModal from './ConfirmModal.vue';
import ProfileManagerDialog from './ProfileManagerDialog.vue';

const t = i18n.global.t;

interface Session {
  id: string;
  name?: string;
  path: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage?: string;
  cwd?: string;
  isStreaming?: boolean;
  pullRequest?: {
    number: number;
    url: string;
    title: string;
    status: 'ready' | 'merged';
  };
  worktree?: {
    baseRepoPath: string;
    worktreePath: string;
    worktreeManaged: true;
    worktreeStatus?: 'active' | 'finished';
  };
}

interface CompactSession {
  id: string;
  path: string;
  cwd?: string;
  title: string;
  isStreaming?: boolean;
}

interface AgentProfile {
  id: string;
  label: string;
  path: string;
  isDefault: boolean;
  defaultProvider?: string;
  defaultModel?: string;
}

const DEFAULT_SESSION_TITLE = t('components.sessionSidebar.newSession');

const props = withDefaults(defineProps<{
  activeSessionId?: string;
  clientId: string;
  username?: string;
  readySessionIds?: string[];
  collapsed?: boolean;
}>(), {
  readySessionIds: () => [],
  collapsed: false,
});

const emit = defineEmits<{
  selectSession: [session: Session];
  sessionsChanged: [sessions: CompactSession[]];
  createSessionWithSameSettings: [sessionId: string];
  projectPathChanged: [cwd: string, options?: { initial?: boolean; keepSession?: boolean }];
  agentProfileChanged: [profileId: string];
  sessionDeleted: [sessionId: string];
  initialized: [];
  close: [];
  'extract-memories': [sessionId: string];
  logout: [];
}>();

const SESSION_PAGE_SIZE = 30;

const sessions = ref<Session[]>([]);
const optimisticSessions = ref<Map<string, Session>>(new Map());
const sessionList = ref<HTMLElement | null>(null);
const nextSessionOffset = ref(0);
const hasMoreSessions = ref(false);
const isLoadingMore = ref(false);
let sessionRequestId = 0;
const streamingSessionIds = ref<Set<string>>(new Set());
const scope = ref<'project' | 'all'>('project');

// Context menu
const contextMenu = ref({ visible: false, left: 0, top: 0, session: null as Session | null });

// Rename dialog
const renameDialog = ref({ visible: false, value: '' });

// Delete confirm
const deleteConfirm = ref({ visible: false });
const tooltip = ref({ visible: false, x: 0, y: 0, text: '', placement: 'right' as 'right' | 'top' });
const agentProfiles = ref<AgentProfile[]>([]);
const selectedAgentProfile = ref('default');
const isAgentProfileListOpen = ref(false);
const showProfileManager = ref(false);
const projectPath = ref<string>('');
const projectPathOptions = ref<string[]>([]);
const projectPathError = ref('');
const isRecentProjectListOpen = ref(false);
const projectPathQuery = ref('');
const activeRecentProjectIndex = ref(0);
const projectPathInput = ref<HTMLInputElement | null>(null);
const recentProjectList = ref<HTMLElement | null>(null);
const showFolderPicker = ref(false);
const sidebarWidth = ref(280);
const minSidebarWidth = 220;
const maxSidebarWidth = 420;
const storageKey = 'pi-webui-project-path';
const agentProfileStorageKey = 'pi-webui-agent-profile';
const projectPathMruStoragePrefix = 'pi-webui-project-path-mru';
const projectPathMruTtlMs = 180 * 24 * 60 * 60 * 1000;
const projectPathMruLimit = 100;
const version = import.meta.env.VITE_APP_VERSION || 'dev';
const projectPathDisplay = computed(() => formatProjectPath(projectPath.value));
const filteredProjectPathOptions = computed(() => {
  const query = projectPathQuery.value.trim().toLowerCase();
  if (!query) return projectPathOptions.value;
  return projectPathOptions.value.filter((path) => (
    path.toLowerCase().includes(query) || formatHomePath(path).toLowerCase().includes(query)
  ));
});
const selectedAgentProfileLabel = computed(() => (
  agentProfiles.value.find((profile) => profile.id === selectedAgentProfile.value)?.label || selectedAgentProfile.value
));
const selectedAgentModelSummary = computed(() => {
  const profile = agentProfiles.value.find((item) => item.id === selectedAgentProfile.value);
  if (!profile?.defaultProvider || !profile?.defaultModel) return '';
  return `${profile.defaultProvider} / ${profile.defaultModel}`;
});
const canGoToSessionProject = computed(() => (
  scope.value === 'all'
  && Boolean(contextMenu.value.session && getSessionProjectPath(contextMenu.value.session))
  && !isSessionInCurrentProject(contextMenu.value.session!)
));
const canCreateSessionWithSameSettings = computed(() => (
  Boolean(contextMenu.value.session && isSessionInCurrentProject(contextMenu.value.session))
));
const canOpenSessionProjectInNewTab = computed(() => (
  scope.value === 'all'
  && Boolean(contextMenu.value.session && getSessionProjectPath(contextMenu.value.session))
));
const readySessionIdSet = computed(() => new Set(props.readySessionIds));

async function loadAgentProfiles() {
  try {
    const response = await fetch('/api/sessions/agent-profiles');
    const data = await response.json();
    agentProfiles.value = Array.isArray(data.profiles) ? data.profiles : [];
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToLoadAgentProfiles'), error);
    agentProfiles.value = [];
  }
}

async function syncAgentProfile(profileId: string) {
  const response = await fetch('/api/sessions/agent-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: props.clientId, profileId }),
  });
  const data = await response.json();
  selectedAgentProfile.value = data.profile?.id || 'default';
  sessionStorage.setItem(agentProfileStorageKey, selectedAgentProfile.value);
  emit('agentProfileChanged', selectedAgentProfile.value);
}

async function loadInitialAgentProfile() {
  const urlProfileId = new URLSearchParams(window.location.search).get('profile');
  if (urlProfileId && agentProfiles.value.some((profile) => profile.id === urlProfileId)) {
    await syncAgentProfile(urlProfileId);
    return;
  }

  const savedProfileId = sessionStorage.getItem(agentProfileStorageKey);
  if (savedProfileId && agentProfiles.value.some((profile) => profile.id === savedProfileId)) {
    await syncAgentProfile(savedProfileId);
    return;
  }

  const response = await fetch(`/api/sessions/agent-profile?clientId=${encodeURIComponent(props.clientId)}`);
  const data = await response.json();
  selectedAgentProfile.value = data.profile?.id || 'default';
  sessionStorage.setItem(agentProfileStorageKey, selectedAgentProfile.value);
  emit('agentProfileChanged', selectedAgentProfile.value);
}

async function loadDefaultProjectPath(): Promise<string> {
  try {
    const response = await fetch('/api/sessions/project-path');
    const data = await response.json();
    return data.projectPath || '~';
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToGetProjectPath'), error);
    return '~';
  }
}

function projectPathMruStorageKey(profileId = selectedAgentProfile.value): string {
  return `${projectPathMruStoragePrefix}:${profileId || 'default'}`;
}

function readProjectPathMru(profileId = selectedAgentProfile.value): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(projectPathMruStorageKey(profileId)) || 'null') as {
      updatedAt?: number;
      paths?: unknown[];
    } | null;
    if (!data?.updatedAt || Date.now() - data.updatedAt > projectPathMruTtlMs || !Array.isArray(data.paths)) return [];
    return data.paths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .slice(0, projectPathMruLimit);
  } catch {
    return [];
  }
}

function writeProjectPathMru(paths: string[], profileId = selectedAgentProfile.value): void {
  try {
    localStorage.setItem(projectPathMruStorageKey(profileId), JSON.stringify({
      updatedAt: Date.now(),
      paths: Array.from(new Set(paths.filter((path) => path.trim()))).slice(0, projectPathMruLimit),
    }));
  } catch {
    // MRU ordering is a convenience; project switching should still work if storage is unavailable.
  }
}

function sortProjectPathsByMru(paths: string[], profileId = selectedAgentProfile.value): string[] {
  const mruPaths = readProjectPathMru(profileId);
  const mruIndex = new Map(mruPaths.map((path, index) => [path, index]));
  return [...paths].sort((left, right) => {
    const leftIndex = mruIndex.get(left);
    const rightIndex = mruIndex.get(right);
    if (leftIndex === undefined && rightIndex === undefined) return 0;
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });
}

function rememberProjectPath(path: string, profileId = selectedAgentProfile.value): void {
  const trimmed = path.trim();
  if (!trimmed) return;
  writeProjectPathMru([trimmed, ...readProjectPathMru(profileId).filter((entry) => entry !== trimmed)], profileId);
  projectPathOptions.value = sortProjectPathsByMru(projectPathOptions.value, profileId);
}

async function refreshProjectPath(options: { preferSaved: boolean; initial?: boolean } = { preferSaved: true }) {
  const urlProjectPath = new URLSearchParams(window.location.search).get('project');
  const savedPath = sessionStorage.getItem(storageKey);
  const defaultPath = await loadDefaultProjectPath();
  const nextPath = urlProjectPath
    || (options.preferSaved && savedPath && projectPathOptions.value.includes(savedPath)
      ? savedPath
      : projectPathOptions.value[0] || defaultPath || '~');

  projectPath.value = nextPath;
  sessionStorage.setItem(storageKey, nextPath);
  rememberProjectPath(nextPath);
  emit('projectPathChanged', projectPath.value, options.initial ? { initial: true } : undefined);
}

async function loadProjectPathOptions() {
  try {
    const response = await fetch(`/api/sessions/project-paths?clientId=${encodeURIComponent(props.clientId)}`);
    const data = await response.json();
    projectPathOptions.value = sortProjectPathsByMru(Array.from(new Set(
      (data.projectPaths || []).filter((path: unknown): path is string => typeof path === 'string' && path.trim().length > 0)
    )));
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToLoadProjectPathOptions'), error);
    projectPathOptions.value = [];
  }
}

async function loadSessions(options: { append?: boolean } = {}) {
  const append = options.append === true;
  if (append && (!hasMoreSessions.value || isLoadingMore.value)) return;

  const requestId = append ? sessionRequestId : ++sessionRequestId;
  const offset = append ? nextSessionOffset.value : 0;
  isLoadingMore.value = true;

  try {
    const params = new URLSearchParams({
      scope: scope.value,
      clientId: props.clientId,
      offset: String(offset),
      limit: String(SESSION_PAGE_SIZE),
    });
    if (scope.value === 'project' && projectPath.value) {
      params.set('projectPath', projectPath.value);
    }
    const response = await fetch(`/api/sessions?${params}`);
    const data = await response.json();
    if (requestId !== sessionRequestId) return;

    const loadedSessions: Session[] = (data.sessions || []).map((session: Session) => {
      const optimisticSession = optimisticSessions.value.get(session.id);
      const isStreaming = session.isStreaming || streamingSessionIds.value.has(session.id);
      if (!optimisticSession) return { ...session, isStreaming };

      if (session.name || session.firstMessage) {
        optimisticSessions.value.delete(session.id);
        return { ...session, isStreaming };
      }

      return {
        ...session,
        firstMessage: optimisticSession.firstMessage,
        isStreaming,
      };
    });
    const retainedSessions = append ? sessions.value : Array.from(optimisticSessions.value.values()).filter(shouldShowSession);
    const loadedIds = new Set(loadedSessions.map((session) => session.id));

    sessions.value = [
      ...retainedSessions.filter((session) => !loadedIds.has(session.id)),
      ...loadedSessions,
    ];
    nextSessionOffset.value = Number.isInteger(data.nextOffset) ? data.nextOffset : offset + loadedSessions.length;
    hasMoreSessions.value = data.hasMore === true;
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToLoadSessions'), error);
  } finally {
    if (requestId === sessionRequestId) isLoadingMore.value = false;
  }
}

function handleSessionListScroll() {
  const list = sessionList.value;
  if (!list || list.scrollHeight - list.scrollTop - list.clientHeight > 80) return;
  void loadSessions({ append: true });
}

function logout() {
  emit('logout');
}

function formatProjectPath(path?: string): string {
  const displayPath = formatHomePath(path);
  if (displayPath.length <= 48) return displayPath;

  const parts = displayPath.split('/');
  return `${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`;
}

function basenamePath(path: string): string {
  const trimmed = path.replace(/\/$/, '');
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

async function moveProject(oldProjectPath: string, destinationParentPath: string, newProjectName: string) {
  const response = await fetch('/api/sessions/move-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: props.clientId,
      oldProjectPath,
      destinationParentPath,
      newProjectName,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || t('components.sessionSidebar.failedToMoveProjectStatus', { status: response.status }));
  }
  return data as { success: true; projectPath: string; movedSessions: number; skippedSessionFiles: number };
}

async function relocateSessions(oldProjectPath: string, newProjectPath: string) {
  const response = await fetch('/api/sessions/relocate-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: props.clientId,
      oldProjectPath,
      newProjectPath,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || t('components.sessionSidebar.failedToRelocateSessionsStatus', { status: response.status }));
  }
  return data as { success: true; moved: number; skipped: number };
}

async function setProjectPath(selection: string | { path: string; moveMode?: 'rename' | 'move-project' | 'move-sessions'; projectName?: string; refreshProjectPaths?: boolean }) {
  const selectedPath = typeof selection === 'string' ? selection : selection.path;
  const moveMode = typeof selection === 'object' ? selection.moveMode : undefined;
  const selectedProjectName = typeof selection === 'object' ? selection.projectName : undefined;
  const shouldRefreshProjectPaths = typeof selection === 'object' && selection.refreshProjectPaths;
  const previousPath = projectPath.value;
  projectPathError.value = '';

  try {
    let nextPath = selectedPath || '~';
    if (moveMode === 'rename' && previousPath && selectedPath) {
      const result = await moveProject(previousPath, selectedPath, selectedProjectName || basenamePath(previousPath));
      nextPath = result.projectPath;
      await loadProjectPathOptions();
    } else if (moveMode === 'move-project' && previousPath && selectedPath && previousPath !== selectedPath) {
      const result = await moveProject(previousPath, selectedPath, basenamePath(previousPath));
      nextPath = result.projectPath;
      await loadProjectPathOptions();
    } else if (moveMode === 'move-sessions' && previousPath && selectedPath && previousPath !== selectedPath) {
      await relocateSessions(previousPath, selectedPath);
      nextPath = selectedPath;
      await loadProjectPathOptions();
    }

    projectPath.value = nextPath;
    sessionStorage.setItem(storageKey, projectPath.value);
    rememberProjectPath(projectPath.value);
    showFolderPicker.value = false;
    emit('projectPathChanged', projectPath.value);
    await loadSessions();
    if (shouldRefreshProjectPaths) await loadProjectPathOptions();
  } catch (error) {
    projectPath.value = previousPath;
    projectPathError.value = error instanceof Error ? error.message : t('components.sessionSidebar.failedToMoveProject');
  }
}

function openAgentProfileList() {
  isAgentProfileListOpen.value = true;
}

function closeAgentProfileList() {
  isAgentProfileListOpen.value = false;
}

async function chooseAgentProfile(profileId: string) {
  isAgentProfileListOpen.value = false;
  await syncAgentProfile(profileId);
  await loadProjectPathOptions();
  await refreshProjectPath({ preferSaved: false });
  await loadSessions();
}

async function handleProfileCreated(_profileId: string) {
  await loadAgentProfiles();
}

async function handleProfileDeleted(result: { activeProfileChanged: boolean }) {
  await loadAgentProfiles();
  if (!result.activeProfileChanged) return;
  const response = await fetch(`/api/sessions/agent-profile?clientId=${encodeURIComponent(props.clientId)}`);
  const data = await response.json();
  selectedAgentProfile.value = data.profile?.id || 'default';
  sessionStorage.setItem(agentProfileStorageKey, selectedAgentProfile.value);
  emit('agentProfileChanged', selectedAgentProfile.value);
  await loadProjectPathOptions();
  await refreshProjectPath({ preferSaved: false });
  await loadSessions();
}

async function focusProjectPath(): Promise<void> {
  if (scope.value !== 'project') {
    scope.value = 'project';
    void loadSessions();
  }

  await nextTick();
  projectPathInput.value?.focus();
}

async function switchToProjectPath(path: string): Promise<void> {
  if (scope.value !== 'project') {
    scope.value = 'project';
  }

  projectPath.value = path || '~';
  sessionStorage.setItem(storageKey, projectPath.value);
  rememberProjectPath(projectPath.value);
  emit('projectPathChanged', projectPath.value, { keepSession: true });
  await loadSessions();
}

function openRecentProjectList() {
  if (isRecentProjectListOpen.value) return;
  projectPathQuery.value = '';
  activeRecentProjectIndex.value = 0;
  isRecentProjectListOpen.value = true;
}

function closeRecentProjectList() {
  isRecentProjectListOpen.value = false;
  projectPathQuery.value = '';
  activeRecentProjectIndex.value = 0;
}

function handleProjectPathInput(event: Event): void {
  projectPathQuery.value = (event.target as HTMLInputElement).value;
  activeRecentProjectIndex.value = 0;
}

function moveRecentProjectSelection(direction: 1 | -1): void {
  const lastIndex = filteredProjectPathOptions.value.length - 1;
  if (lastIndex < 0) return;

  const nextIndex = activeRecentProjectIndex.value + direction;
  activeRecentProjectIndex.value = Math.min(Math.max(nextIndex, 0), lastIndex);
}

async function scrollActiveRecentProjectIntoView(): Promise<void> {
  await nextTick();
  const activeOption = recentProjectList.value?.querySelector<HTMLElement>('.recent-project-option.active');
  activeOption?.scrollIntoView?.({ block: 'nearest' });
}

watch(activeRecentProjectIndex, scrollActiveRecentProjectIntoView);

function selectActiveRecentProject() {
  const path = filteredProjectPathOptions.value[activeRecentProjectIndex.value];
  if (path) chooseRecentProjectPath(path);
  else commitProjectPath();
}

function handleProjectPathBlur() {
  if (projectPathQuery.value.trim()) commitProjectPath();
  else closeRecentProjectList();
}

function commitProjectPath() {
  const path = projectPathQuery.value.trim();
  if (!path) return;
  closeRecentProjectList();
  void setProjectPath(path);
}

function chooseRecentProjectPath(path: string) {
  closeRecentProjectList();
  void setProjectPath(path);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('components.sessionSidebar.justNow');
  if (diffMins < 60) return formatRelativeUnit(diffMins, 'minute');
  if (diffHours < 24) return formatRelativeUnit(diffHours, 'hour');
  if (diffDays < 7) return formatRelativeUnit(diffDays, 'day');

  return date.toLocaleDateString();
}

function formatRelativeUnit(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  if (i18n.global.locale.value !== 'en') {
    return new Intl.RelativeTimeFormat(i18n.global.locale.value, { numeric: 'always', style: 'long' }).format(-value, unit);
  }
  if (unit === 'minute') return `${value}m ago`;
  if (unit === 'hour') return `${value}h ago`;
  return `${value}d ago`;
}

function selectSession(session: Session) {
  hideTooltip();
  emit('selectSession', session);
}

function isSessionReady(sessionId: string): boolean {
  return readySessionIdSet.value.has(sessionId);
}

function showTooltip(event: MouseEvent, text: string, placement: 'right' | 'top' = 'right') {
  if (typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches) {
    return;
  }

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tooltip.value = {
    visible: true,
    x: placement === 'top' ? rect.left + rect.width / 2 : rect.right + 8,
    y: placement === 'top' ? rect.top - 8 : rect.top + rect.height / 2,
    text,
    placement,
  };
}

function hideTooltip() {
  tooltip.value.visible = false;
}

function clampSidebarWidth(width: number): number {
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));
}

function handleSidebarResize(event: MouseEvent) {
  sidebarWidth.value = clampSidebarWidth(event.clientX);
}

const isSidebarResizing = ref(false);

function stopSidebarResize() {
  isSidebarResizing.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  window.removeEventListener('mousemove', handleSidebarResize);
  window.removeEventListener('mouseup', stopSidebarResize);
}

function startSidebarResize(event: MouseEvent) {
  event.preventDefault();
  isSidebarResizing.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', handleSidebarResize);
  window.addEventListener('mouseup', stopSidebarResize);
}

function normalizeProjectPath(path?: string): string {
  return (path || '').replace(/\/+$/, '');
}

function getSessionProjectPath(session: Session): string {
  return session.worktree?.baseRepoPath || session.cwd || session.path || '';
}

function isSessionInCurrentProject(session: Session): boolean {
  const currentProjectPath = normalizeProjectPath(projectPath.value);
  if (!currentProjectPath) return false;
  return [session.cwd, session.path, session.worktree?.baseRepoPath]
    .some((path) => normalizeProjectPath(path) === currentProjectPath);
}

function shouldShowSession(session: Session): boolean {
  if (scope.value === 'all') return true;
  if (!projectPath.value) return true;
  return isSessionInCurrentProject(session);
}

function addCreatedSession(event: Event) {
  const detail = (event as CustomEvent<Partial<Session> & { cwd?: string }>).detail;
  if (!detail?.id) return;

  const optimisticSession: Session = {
    id: detail.id,
    name: detail.name,
    path: detail.path || detail.cwd || '',
    cwd: detail.cwd,
    created: detail.created || new Date().toISOString(),
    modified: detail.modified || detail.created || new Date().toISOString(),
    messageCount: detail.messageCount || 0,
    firstMessage: detail.firstMessage,
    worktree: detail.worktree,
  };

  optimisticSessions.value.set(optimisticSession.id, optimisticSession);
  if (optimisticSession.cwd) {
    projectPathOptions.value = Array.from(new Set([optimisticSession.cwd, ...projectPathOptions.value]));
  }
  void loadProjectPathOptions();
  sessions.value = [
    ...(shouldShowSession(optimisticSession) ? [optimisticSession] : []),
    ...sessions.value.filter((session) => session.id !== optimisticSession.id),
  ];
}

function updateFirstMessage(event: Event) {
  const detail = (event as CustomEvent<{ id?: string; firstMessage?: string }>).detail;
  if (!detail?.id || !detail.firstMessage) return;

  const existingOptimistic = optimisticSessions.value.get(detail.id);
  const existingSession = sessions.value.find((session) => session.id === detail.id);
  if (existingSession?.name || existingSession?.firstMessage) return;

  const nextSession: Session = {
    ...(existingOptimistic || existingSession),
    id: detail.id,
    path: existingOptimistic?.path || existingSession?.path || '',
    cwd: existingOptimistic?.cwd || existingSession?.cwd,
    created: existingOptimistic?.created || existingSession?.created || new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: existingOptimistic?.messageCount || existingSession?.messageCount || 0,
    firstMessage: detail.firstMessage,
  };

  optimisticSessions.value.set(detail.id, nextSession);
  sessions.value = sessions.value.map((session) => (
    session.id === detail.id ? { ...session, firstMessage: detail.firstMessage } : session
  ));
}

function updateStreamingState(event: Event) {
  const detail = (event as CustomEvent<{ id?: string; isStreaming?: boolean }>).detail;
  if (!detail?.id || typeof detail.isStreaming !== 'boolean') return;

  const nextStreamingSessionIds = new Set(streamingSessionIds.value);
  if (detail.isStreaming) {
    nextStreamingSessionIds.add(detail.id);
  } else {
    nextStreamingSessionIds.delete(detail.id);
  }
  streamingSessionIds.value = nextStreamingSessionIds;

  const existingOptimistic = optimisticSessions.value.get(detail.id);
  if (existingOptimistic) {
    optimisticSessions.value.set(detail.id, {
      ...existingOptimistic,
      isStreaming: detail.isStreaming,
    });
  }

  sessions.value = sessions.value.map((session) => (
    session.id === detail.id ? { ...session, isStreaming: detail.isStreaming } : session
  ));
}

function worktreeSessionTitle(session: Session): string {
  const status = session.worktree?.worktreeStatus === 'finished'
    ? t('components.sessionSidebar.worktreeSessionFinished')
    : t('components.sessionSidebar.worktreeSessionActive');
  return session.worktree?.worktreePath ? `${status}: ${formatHomePath(session.worktree.worktreePath)}` : status;
}

function formatSessionTitle(session: Session): string {
  if (session.name) return session.name;
  if (session.firstMessage) {
    // Extract skill name from skill call XML
    const skillMatch = session.firstMessage.match(/^<skill\s+name="([^"]+)"/);
    if (skillMatch) return skillMatch[1];
    return session.firstMessage.slice(0, 50);
  }
  return DEFAULT_SESSION_TITLE;
}

watch(sessions, (items) => {
  emit('sessionsChanged', items.map((session) => ({
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    title: formatSessionTitle(session),
    isStreaming: session.isStreaming,
  })));
}, { immediate: true });

// ── Context menu ───────────────────────────────────────────────────────────

function showContextMenu(event: MouseEvent, session: Session) {
  closeContextMenu();
  contextMenu.value = { visible: true, left: event.clientX, top: event.clientY, session };
  nextTick(() => {
    document.addEventListener('click', closeContextMenu, { once: true });
    document.addEventListener('keydown', handleContextMenuEscape, { once: true });
  });
}

function showContextMenuForSession(event: MouseEvent, sessionId: string): void {
  const session = sessions.value.find((item) => item.id === sessionId);
  if (session) showContextMenu(event, session);
}

function closeContextMenu() {
  contextMenu.value.visible = false;
  document.removeEventListener('keydown', handleContextMenuEscape);
}

function handleContextMenuEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') closeContextMenu();
}

async function goToSessionProject() {
  const session = contextMenu.value.session;
  const targetProjectPath = session ? getSessionProjectPath(session) : '';
  closeContextMenu();
  if (!session || !targetProjectPath || isSessionInCurrentProject(session)) return;

  scope.value = 'project';
  await setProjectPath(targetProjectPath);
}

function openSessionProjectInNewTab() {
  const session = contextMenu.value.session;
  const targetProjectPath = session ? getSessionProjectPath(session) : '';
  closeContextMenu();
  if (!targetProjectPath) return;

  const url = new URL('/', window.location.origin);
  if (targetProjectPath !== '~') url.searchParams.set('project', targetProjectPath);
  if (selectedAgentProfile.value && selectedAgentProfile.value !== 'default') {
    url.searchParams.set('profile', selectedAgentProfile.value);
  }
  window.open(url.toString(), '_blank', 'noopener');
}

function createSessionWithSameSettings() {
  const session = contextMenu.value.session;
  closeContextMenu();
  if (session) emit('createSessionWithSameSettings', session.id);
}

function extractMemoriesFromSession() {
  const session = contextMenu.value.session;
  closeContextMenu();
  if (session) emit('extract-memories', session.id);
}

function openRenameDialog() {
  const session = contextMenu.value.session;
  closeContextMenu();
  if (!session) return;
  renameDialog.value = {
    visible: true,
    value: formatSessionTitle(session),
  };
}

async function confirmRename(newName: string) {
  renameDialog.value.visible = false;
  const session = contextMenu.value.session;
  const trimmed = newName.trim();
  if (!session || !trimmed) return;

  try {
    const response = await fetch(`/api/sessions/${session.id}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, name: trimmed }),
    });
    if (response.ok) {
      const idx = sessions.value.findIndex(s => s.id === session.id);
      if (idx !== -1) {
        sessions.value[idx] = { ...sessions.value[idx], name: trimmed };
      }
    }
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToRenameSession'), error);
  }
}

function openDeleteConfirm() {
  closeContextMenu();
  deleteConfirm.value.visible = true;
}

async function confirmDeleteSession() {
  deleteConfirm.value.visible = false;
  const session = contextMenu.value.session;
  if (!session) return;

  try {
    const response = await fetch(`/api/sessions/${session.id}?clientId=${encodeURIComponent(props.clientId)}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (data.success) {
      optimisticSessions.value.delete(session.id);
      sessions.value = sessions.value.filter(s => s.id !== session.id);
      emit('sessionDeleted', session.id);
      window.dispatchEvent(new Event('refresh-sessions'));
    }
  } catch (error) {
    console.error(t('components.sessionSidebar.failedToDeleteSession'), error);
  }
}

onMounted(async () => {
  await loadAgentProfiles();
  await loadInitialAgentProfile();
  await loadProjectPathOptions();
  await refreshProjectPath({ preferSaved: true, initial: true });
  await loadSessions();
  emit('initialized');
});

// Listen for session list events
const refreshHandler = () => loadSessions();
const projectPathMruStorageHandler = (event: StorageEvent) => {
  if (event.key !== projectPathMruStorageKey()) return;
  projectPathOptions.value = sortProjectPathsByMru(projectPathOptions.value);
};
onMounted(() => {
  window.addEventListener('refresh-sessions', refreshHandler);
  window.addEventListener('session-created', addCreatedSession);
  window.addEventListener('session-first-message', updateFirstMessage);
  window.addEventListener('session-streaming-state', updateStreamingState);
  window.addEventListener('storage', projectPathMruStorageHandler);
});

// Cleanup
onUnmounted(() => {
  window.removeEventListener('refresh-sessions', refreshHandler);
  window.removeEventListener('session-created', addCreatedSession);
  window.removeEventListener('session-first-message', updateFirstMessage);
  window.removeEventListener('session-streaming-state', updateStreamingState);
  window.removeEventListener('storage', projectPathMruStorageHandler);
  stopSidebarResize();
});

defineExpose({ focusProjectPath, loadSessions, showContextMenuForSession, switchToProjectPath });
</script>

<style scoped>
.session-sidebar {
  position: relative;
  flex: 0 0 var(--session-sidebar-width);
  width: var(--session-sidebar-width);
  min-width: 220px;
  max-width: 420px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color var(--duration-fast) var(--ease-out);
}

@media (min-width: 769px) {
  .session-sidebar.collapsed {
    flex: 0 0 0;
    width: 0;
    min-width: 0;
    border-right: 0;
  }

  .session-sidebar.collapsed > * {
    display: none;
  }
}

.sidebar-header {
  padding: 0 1rem;
  height: 56px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.mobile-close-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.mobile-close-btn:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 56px;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.sidebar-username {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer-actions {
  display: flex;
  gap: 0.25rem;
}

.sidebar-footer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.sidebar-footer-btn:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.sidebar-header h3 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
}

.version-tag {
  font-size: 0.6875rem;
  font-weight: 400;
  color: var(--text-tertiary);
}

.agent-picker-header {
  margin-bottom: 0.35rem;
}

.agent-model-summary {
  color: var(--text-tertiary);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}


.agent-picker,
.project-picker {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
}

.agent-picker label {
  display: block;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.agent-profile-row,
.project-path-row {
  display: flex;
  gap: 0.35rem;
}

.agent-profile-input-wrapper,
.project-path-input-wrapper {
  position: relative;
  flex: 1;
  min-width: 0;
}

.agent-profile-input,
.project-path-input {
  width: 100%;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.agent-profile-input:hover,
.project-path-input:hover {
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}

.project-path-error {
  margin-top: 0.5rem;
  color: var(--error);
  font-size: 0.85rem;
}

.agent-profile-list,
.recent-project-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--bg-surface);
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--accent));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow-x: hidden;
}

.agent-profile-list.bounded,
.recent-project-list.bounded {
  max-height: 20rem;
  overflow-y: auto;
}

.agent-profile-option,
.recent-project-option {
  display: block;
  width: 100%;
  padding: 0.45rem 0.55rem;
  color: var(--text-primary);
  font-size: 0.8125rem;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.agent-profile-option:hover,
.recent-project-option:hover,
.recent-project-option.active {
  background: var(--accent-muted);
  color: var(--text-primary);
}

.project-path-row {
  display: flex;
  gap: 0.35rem;
}

.folder-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.5rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.folder-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.scope-toggle {
  display: flex;
  padding: 0.5rem;
  gap: 0.25rem;
}

.scope-toggle button {
  flex: 1;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.scope-toggle button.active {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.scope-toggle button:hover:not(.active) {
  color: var(--text-primary);
}

.session-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem;
}

.session-item {
  min-width: 0;
  max-width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  margin-bottom: 0.125rem;
  overflow: hidden;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.session-tooltip {
  position: fixed;
  transform: translateY(-50%);
  padding: 6px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  color: var(--text-primary);
  white-space: normal;
  max-width: 300px;
  z-index: 1000;
  pointer-events: none;
  box-shadow: var(--shadow-md);
}

.session-tooltip.placement-top {
  transform: translate(-50%, -100%);
}

.session-item:hover {
  background: var(--bg-surface);
}

.session-item.active {
  background: var(--sidebar-selected-bg);
  border-color: var(--sidebar-selected-border);
  color: var(--sidebar-selected-text);
  box-shadow: var(--sidebar-selected-shadow);
}

.session-name {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-indicator {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--success);
  box-shadow: 0 0 0 2px var(--success-muted);
  animation: live-indicator-blink 2s ease-in-out infinite;
}

/* Light-theme selected rows need extra contrast against their blue background. */
[data-theme="light"] .session-item.active .live-indicator {
  background: var(--sidebar-selected-text);
  box-shadow: 0 0 0 2px var(--sidebar-selected-border),
              0 0 8px var(--sidebar-selected-text);
}

.ready-indicator {
  flex: 0 0 auto;
  font-size: 0.8125rem;
  line-height: 1;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--warning) 45%, transparent));
}

.session-pr-status,
.session-worktree-status {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

.session-worktree-status {
  gap: 0.15rem;
  color: #34d399;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.session-worktree-status.finished {
  color: var(--text-tertiary);
}

.session-pr-status.ready {
  color: #60a5fa;
}

.session-pr-status.merged {
  color: #c084fc;
}

@keyframes live-indicator-blink {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.82);
  }
}

.session-meta {
  min-width: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  display: flex;
  gap: 0.5rem;
}

.session-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item.active .session-meta {
  color: var(--sidebar-selected-muted);
}

.empty-state,
.session-list-status {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-secondary);
}

.session-list-status {
  padding-block: 0.75rem;
  font-size: 0.75rem;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}

.sidebar-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  right: 5px;
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s;
}

.sidebar-resize-handle:hover::after,
.sidebar-resize-handle.is-resizing::after {
  background: var(--accent);
}

/* ── Context menu ─────────────────────────────────────────────────────── */

.session-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 160px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 0.25rem 0;
}

.session-context-menu button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.875rem;
  color: var(--text-primary);
  font-size: 0.8125rem;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.session-context-menu button:hover {
  background: var(--accent-muted);
}

.session-context-menu button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.session-context-menu button:disabled:hover {
  background: none;
}

.session-context-menu button.danger {
  color: var(--error);
}

.session-context-menu button.danger:hover {
  background: var(--error-muted);
}

/* ── Mobile ────────────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .mobile-close-btn {
    display: flex;
  }

  .agent-picker,
  .project-picker {
    padding: 0.625rem 0.75rem;
  }

  .session-item {
    min-height: 48px;
  }

  .session-sidebar.collapsed {
    flex: 0 0 var(--session-sidebar-width);
    width: var(--session-sidebar-width);
    min-width: 220px;
    border-right: 1px solid var(--border);
  }

  .session-tooltip {
    display: none;
  }
}

</style>
