<template>
  <div class="kickoff-panel">
    <section class="notification-card">
      <div class="section-heading">
        <span class="section-icon"><PhBell :size="20" weight="fill" /></span>
        <div>
          <h4>{{ t('settings.modelWindowKickoff.wecomTitle') }}</h4>
          <p>{{ t('settings.modelWindowKickoff.wecomDescription') }}</p>
        </div>
      </div>
      <div class="field-grid">
        <label class="field">{{ t('settings.modelWindowKickoff.channelName') }}<input v-model="channelName" /></label>
        <label class="field">{{ t('settings.modelWindowKickoff.botKey') }}<input v-model="botKey" type="password" :placeholder="channel?.configured ? t('settings.modelWindowKickoff.keyConfigured') : ''" /></label>
      </div>
      <div class="notification-actions">
        <button v-if="channel" class="button danger" :disabled="busy" @click="deleteChannel">
          <PhTrash :size="16" />
          {{ t('settings.modelWindowKickoff.deleteChannel') }}
        </button>
        <button class="button secondary" :disabled="busy || (!botKey && !channel)" @click="saveChannel">
          <PhFloppyDisk :size="16" />
          {{ t('settings.modelWindowKickoff.saveChannel') }}
        </button>
      </div>
    </section>

    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <section v-for="item in kickoffs" :key="item.id" class="kickoff-card" @input="clearSaveStatus(item.id)">
      <header class="card-heading">
        <div class="model-heading">
          <span class="model-label">{{ t('settings.modelWindowKickoff.model') }}</span>
          <strong>{{ item.modelId }}</strong>
          <span class="provider-name">{{ item.provider }}</span>
        </div>
        <label class="enabled-switch">
          <input v-model="item.enabled" type="checkbox" />
          <span class="switch-track" aria-hidden="true"></span>
          <span>{{ t('settings.modelWindowKickoff.enabled') }}</span>
        </label>
      </header>

      <div class="field-grid">
        <label class="field">{{ t('settings.modelWindowKickoff.profile') }}
          <CustomSelect
            :id="`kickoff-profile-${item.id}`"
            :model-value="item.profileId"
            :options="profileOptions"
            :aria-label="t('settings.modelWindowKickoff.profile')"
            @update:model-value="setProfile(item, $event)"
          />
        </label>
        <label class="field">{{ t('settings.modelWindowKickoff.model') }}
          <CustomSelect
            :id="`kickoff-model-${item.id}`"
            :model-value="modelValue(item)"
            :options="modelOptions(item.profileId)"
            :aria-label="t('settings.modelWindowKickoff.model')"
            searchable
            @update:model-value="setModel(item, $event)"
          />
        </label>
        <label class="field">{{ t('settings.modelWindowKickoff.projectPath') }}
          <span class="path-picker-field">
            <input :value="item.projectPath" readonly :title="item.projectPath" />
            <button
              type="button"
              class="path-picker-button"
              :aria-label="t('settings.modelWindowKickoff.selectProjectPath')"
              :title="t('settings.modelWindowKickoff.selectProjectPath')"
              @click="openProjectPicker(item)"
            >
              <PhFolderOpen :size="18" weight="bold" />
            </button>
          </span>
        </label>
        <label class="field">{{ t('settings.modelWindowKickoff.windowHours') }}<input v-model.number="item.windowHours" type="number" min="0.02" step="0.5" /></label>
        <label class="field">{{ t('settings.modelWindowKickoff.bufferSeconds') }}<input v-model.number="item.safetyBufferSeconds" type="number" min="0" /></label>
        <label class="field">{{ t('settings.modelWindowKickoff.nextRun') }}<input v-model="item.nextRunLocal" type="datetime-local" /></label>
        <label class="field">{{ t('settings.modelWindowKickoff.notification') }}
          <CustomSelect
            :id="`kickoff-notification-${item.id}`"
            :model-value="item.notificationChannelId || ''"
            :options="notificationOptions"
            :aria-label="t('settings.modelWindowKickoff.notification')"
            @update:model-value="setNotificationChannel(item, $event)"
          />
        </label>
        <label class="field prompt-field">{{ t('settings.modelWindowKickoff.prompt') }}<textarea v-model="item.prompt" rows="3" /></label>
      </div>

      <div class="status-grid">
        <div><span>{{ t('settings.modelWindowKickoff.lastSuccess') }}</span><strong>{{ formatTime(item.lastSuccessAt) }}</strong></div>
        <div><span>{{ t('settings.modelWindowKickoff.lastAttempt') }}</span><strong>{{ formatTime(item.lastAttemptAt) }}</strong></div>
        <div><span>{{ t('settings.modelWindowKickoff.nextScheduled') }}</span><strong>{{ formatTime(fromLocal(item.nextRunLocal)) }}</strong></div>
        <div v-if="item.lastError" class="status-error"><span>{{ t('settings.modelWindowKickoff.lastError') }}</span><strong>{{ item.lastError }}</strong></div>
      </div>

      <footer class="card-actions">
        <span v-if="saveStatus[item.id] === 'saved'" class="save-success" role="status">
          {{ t('settings.modelWindowKickoff.saved') }}
        </span>
        <button class="button danger" :disabled="busy" @click="remove(item.id)"><PhTrash :size="16" />{{ t('settings.modelWindowKickoff.delete') }}</button>
        <button class="button primary save-button" :disabled="busy" @click="save(item)">
          <PhFloppyDisk :size="16" />
          {{ saveButtonLabel(item.id) }}
        </button>
      </footer>
    </section>

    <button class="add-button" :disabled="busy || !profiles.length" @click="add"><PhPlus :size="18" weight="bold" />{{ t('settings.modelWindowKickoff.add') }}</button>

    <FolderPickerModal
      :visible="showProjectPicker"
      :initial-path="pickerInitialPath"
      :client-id="clientId"
      :title="t('settings.modelWindowKickoff.selectProjectPath')"
      :show-clone="false"
      @close="closeProjectPicker"
      @select="selectProjectPath"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { PhBell, PhFloppyDisk, PhFolderOpen, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { i18n } from '../i18n';
import { apiRequest } from '../services/apiClient';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';
import FolderPickerModal from './FolderPickerModal.vue';

const t = i18n.global.t;

withDefaults(defineProps<{
  clientId?: string;
}>(), {
  clientId: '',
});

interface Profile {
  id: string;
  label?: string;
  defaultProvider?: string;
  defaultModel?: string;
}

interface Model {
  provider: string;
  id: string;
  name?: string;
}

interface Channel {
  id: string;
  name: string;
  configured: boolean;
}

interface KickoffResponse {
  id: string;
  enabled: boolean;
  profileId: string;
  provider: string;
  modelId: string;
  projectPath: string;
  prompt: string;
  windowDurationMinutes: number;
  safetyBufferSeconds: number;
  notificationChannelId: string | null;
  nextRunAt: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

interface Draft extends KickoffResponse {
  windowHours: number;
  nextRunLocal: string;
}

interface ModelWindowKickoffPayload {
  enabled: boolean;
  profileId: string;
  provider: string;
  modelId: string;
  projectPath: string;
  prompt: string;
  windowDurationMinutes: number;
  safetyBufferSeconds: number;
  notificationChannelId: string | null;
  nextRunAt: string;
}

const profiles = ref<Profile[]>([]);
const models = ref<Record<string, Model[]>>({});
const channels = ref<Channel[]>([]);
const kickoffs = ref<Draft[]>([]);
const defaultProjectPath = ref('~');
const channel = ref<Channel>();
const channelName = ref('WeCom');
const botKey = ref('');
const busy = ref(false);
const error = ref('');
const saveStatus = ref<Record<string, 'saving' | 'saved'>>({});
const selectedProjectDraft = ref<Draft>();
const showProjectPicker = computed(() => Boolean(selectedProjectDraft.value));
const pickerInitialPath = computed(() => selectedProjectDraft.value?.projectPath || defaultProjectPath.value || '~');
const profileOptions = computed<CustomSelectOption[]>(() => profiles.value.map((profile) => ({
  value: profile.id,
  label: profile.label || profile.id,
})));
const notificationOptions = computed<CustomSelectOption[]>(() => [
  { value: '', label: t('settings.modelWindowKickoff.none') },
  ...channels.value.map((entry) => ({ value: entry.id, label: entry.name })),
]);

onMounted(load);

async function load(): Promise<void> {
  error.value = '';
  try {
    const [profileResult, kickoffResult, channelResult, projectPathResult] = await Promise.all([
      apiRequest<{ profiles: Profile[] }>('/api/sessions/agent-profiles'),
      apiRequest<{ kickoffs: KickoffResponse[] }>('/api/model-window-kickoffs'),
      apiRequest<{ channels: Channel[] }>('/api/model-window-kickoffs/notification-channels'),
      apiRequest<{ projectPath: string }>('/api/sessions/project-path'),
    ]);
    profiles.value = profileResult.profiles;
    defaultProjectPath.value = projectPathResult.projectPath;
    kickoffs.value = kickoffResult.kickoffs.map(toDraft);
    channels.value = channelResult.channels;
    channel.value = channels.value.find((entry) => entry.configured);
    if (channel.value) {
      channelName.value = channel.value.name;
    }

    const profileIds = kickoffs.value.map((item) => item.profileId);
    if (profiles.value[0]) {
      profileIds.push(profiles.value[0].id);
    }
    await Promise.all([...new Set(profileIds)].map(loadModels));
  } catch (cause) {
    error.value = message(cause);
  }
}

async function loadModels(profileId: string): Promise<void> {
  if (!profileId || models.value[profileId]) {
    return;
  }
  const result = await apiRequest<{ models: Model[] }>(`/api/sessions/agent-profiles/${encodeURIComponent(profileId)}/models`);
  models.value[profileId] = result.models;
}

function openProjectPicker(item: Draft): void {
  selectedProjectDraft.value = item;
}

function closeProjectPicker(): void {
  selectedProjectDraft.value = undefined;
}

function selectProjectPath(payload: { path: string }): void {
  if (selectedProjectDraft.value) {
    clearSaveStatus(selectedProjectDraft.value.id);
    selectedProjectDraft.value.projectPath = payload.path;
  }
  closeProjectPicker();
}

async function save(item: Draft): Promise<void> {
  busy.value = true;
  error.value = '';
  saveStatus.value[item.id] = 'saving';
  try {
    const result = await apiRequest<{ kickoff: KickoffResponse }, ModelWindowKickoffPayload>(
      `/api/model-window-kickoffs/${item.id}`,
      { method: 'PUT', body: payload(item) },
    );
    Object.assign(item, toDraft(result.kickoff));
    saveStatus.value[item.id] = 'saved';
  } catch (cause) {
    error.value = message(cause);
    clearSaveStatus(item.id);
  } finally {
    busy.value = false;
  }
}

async function add(): Promise<void> {
  const profile = profiles.value[0];
  if (!profile) {
    return;
  }

  await loadModels(profile.id);
  const availableModels = models.value[profile.id] || [];
  const defaultModel = availableModels.find(
    (entry) => entry.provider === profile.defaultProvider && entry.id === profile.defaultModel,
  );
  const model = defaultModel || availableModels[0];
  if (!model) {
    error.value = t('settings.modelWindowKickoff.noModels');
    return;
  }

  busy.value = true;
  try {
    const result = await apiRequest<{ kickoff: KickoffResponse }, object>('/api/model-window-kickoffs', {
      method: 'POST',
      body: {
        profileId: profile.id,
        provider: model.provider,
        modelId: model.id,
        projectPath: defaultProjectPath.value,
        prompt: 'Ping',
        windowDurationMinutes: 300,
        safetyBufferSeconds: 60,
        nextRunAt: new Date().toISOString(),
        notificationChannelId: channel.value?.id || null,
      },
    });
    kickoffs.value.push(toDraft(result.kickoff));
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function remove(id: string): Promise<void> {
  busy.value = true;
  try {
    await apiRequest(`/api/model-window-kickoffs/${id}`, { method: 'DELETE' });
    kickoffs.value = kickoffs.value.filter((item) => item.id !== id);
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function deleteChannel(): Promise<void> {
  if (!channel.value) return;

  busy.value = true;
  error.value = '';
  const channelId = channel.value.id;
  try {
    await apiRequest(`/api/model-window-kickoffs/notification-channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
    channels.value = channels.value.filter((entry) => entry.id !== channelId);
    kickoffs.value.forEach((item) => {
      if (item.notificationChannelId === channelId) item.notificationChannelId = null;
    });
    channel.value = undefined;
    channelName.value = 'WeCom';
    botKey.value = '';
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

async function saveChannel(): Promise<void> {
  busy.value = true;
  try {
    const result = await apiRequest<{ channel: Channel }, object>('/api/model-window-kickoffs/notification-channels/wecom', {
      method: 'POST',
      body: {
        id: channel.value?.id,
        name: channelName.value,
        botKey: botKey.value,
      },
    });
    channel.value = result.channel;
    botKey.value = '';
    await load();
  } catch (cause) {
    error.value = message(cause);
  } finally {
    busy.value = false;
  }
}

function payload(item: Draft): ModelWindowKickoffPayload {
  return {
    enabled: item.enabled,
    profileId: item.profileId,
    provider: item.provider,
    modelId: item.modelId,
    projectPath: item.projectPath,
    prompt: item.prompt,
    windowDurationMinutes: Math.round(item.windowHours * 60),
    safetyBufferSeconds: item.safetyBufferSeconds,
    notificationChannelId: item.notificationChannelId,
    nextRunAt: fromLocal(item.nextRunLocal),
  };
}

function toDraft(item: KickoffResponse): Draft {
  return {
    ...item,
    windowHours: item.windowDurationMinutes / 60,
    nextRunLocal: toLocal(item.nextRunAt),
  };
}

function modelValue(item: Draft): string {
  return `${item.provider}\n${item.modelId}`;
}

function modelOptions(profileId: string): CustomSelectOption[] {
  return (models.value[profileId] || []).map((model) => ({
    value: `${model.provider}\n${model.id}`,
    label: `${model.name || model.id} [${model.provider}]`,
  }));
}

function setProfile(item: Draft, profileId: string): void {
  clearSaveStatus(item.id);
  item.profileId = profileId;
  void loadModels(profileId);
}

function setModel(item: Draft, value: string): void {
  clearSaveStatus(item.id);
  [item.provider, item.modelId] = value.split('\n');
}

function setNotificationChannel(item: Draft, value: string): void {
  clearSaveStatus(item.id);
  item.notificationChannelId = value || null;
}

function clearSaveStatus(id: string): void {
  delete saveStatus.value[id];
}

function saveButtonLabel(id: string): string {
  return saveStatus.value[id] === 'saving'
    ? t('settings.modelWindowKickoff.saving')
    : t('settings.modelWindowKickoff.save');
}

function toLocal(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocal(value: string): string {
  return new Date(value).toISOString();
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
</script>

<style scoped>
.kickoff-panel {
  display: grid;
  gap: 1rem;
  padding-bottom: 0.25rem;
}

.notification-card,
.kickoff-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-secondary);
}

.notification-card {
  display: grid;
  gap: 1rem;
  padding: 1.1rem 1.2rem;
}

.section-heading,
.card-heading,
.card-actions,
.notification-actions {
  display: flex;
  align-items: center;
}

.section-heading {
  gap: 0.75rem;
}

.section-heading h4,
.section-heading p {
  margin: 0;
}

.section-heading h4 {
  font-size: 0.95rem;
}

.section-heading p {
  margin-top: 0.2rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.section-icon {
  display: grid;
  flex: 0 0 auto;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  color: var(--accent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.notification-actions {
  justify-content: flex-end;
  gap: 0.6rem;
}

.kickoff-card {
  overflow: hidden;
}

.card-heading {
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.2rem;
  border-bottom: 1px solid var(--border);
}

.model-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.5rem;
}

.model-label {
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.model-heading strong {
  overflow: hidden;
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-name {
  flex: 0 0 auto;
  padding: 0.2rem 0.45rem;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.7rem;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem 1rem;
}

.kickoff-card > .field-grid {
  padding: 1.2rem;
}

.field {
  display: grid;
  min-width: 0;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 500;
}

.field input,
.field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.65rem 0.75rem;
  color: var(--text-primary);
  outline: none;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 7px;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 400;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.field input:focus,
.field textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
}

.field textarea {
  min-height: 5rem;
  resize: vertical;
}

.prompt-field {
  grid-column: 1 / -1;
}

.path-picker-field {
  display: flex;
  min-width: 0;
}

.path-picker-field input {
  min-width: 0;
  border-radius: 7px 0 0 7px;
  cursor: default;
}

.path-picker-button {
  display: grid;
  flex: 0 0 2.6rem;
  place-items: center;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-left: 0;
  border-radius: 0 7px 7px 0;
  cursor: pointer;
}

.path-picker-button:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
}

.enabled-switch {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
}

.enabled-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.switch-track {
  position: relative;
  width: 2rem;
  height: 1.1rem;
  border-radius: 999px;
  background: var(--border);
  transition: background 0.15s;
}

.switch-track::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 0.85rem;
  height: 0.85rem;
  content: '';
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  transition: transform 0.15s;
}

.enabled-switch input:checked + .switch-track {
  background: var(--accent);
}

.enabled-switch input:checked + .switch-track::after {
  transform: translateX(0.9rem);
}

.enabled-switch input:focus-visible + .switch-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0 1.2rem 1.2rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--border);
}

.status-grid > div {
  display: grid;
  min-width: 0;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  background: var(--bg-primary);
}

.status-grid span {
  color: var(--text-secondary);
  font-size: 0.68rem;
}

.status-grid strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-grid .status-error {
  grid-column: 1 / -1;
}

.status-error strong,
.error-message {
  color: var(--error);
}

.error-message {
  margin: 0;
  padding: 0.7rem 0.85rem;
  border: 1px solid color-mix(in srgb, var(--error) 35%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--error) 8%, transparent);
  font-size: 0.8rem;
}

.card-actions {
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.8rem 1.2rem;
  border-top: 1px solid var(--border);
}

.save-success {
  margin-right: auto;
  color: var(--success);
  font-size: 0.82rem;
}

.button,
.add-button {
  display: inline-flex;
  width: auto;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.55rem 0.85rem;
  border-radius: 7px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.button {
  border: 1px solid transparent;
}

.button.primary {
  color: white;
  background: var(--accent);
}


.button.secondary {
  color: var(--text-primary);
  background: var(--bg-primary);
  border-color: var(--border);
}

.button.danger {
  color: var(--error);
  background: transparent;
  border-color: color-mix(in srgb, var(--error) 35%, var(--border));
}

.button:hover:not(:disabled),
.add-button:hover:not(:disabled) {
  filter: brightness(1.08);
}

.button:disabled,
.add-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.add-button {
  min-height: 3rem;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent) 50%, var(--border));
}

.add-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

@media (max-width: 700px) {
  .field-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .status-grid {
    gap: 1px;
  }

  .card-heading {
    align-items: flex-start;
  }

  .model-heading {
    flex-wrap: wrap;
  }

  .model-label {
    width: 100%;
  }
}
</style>
