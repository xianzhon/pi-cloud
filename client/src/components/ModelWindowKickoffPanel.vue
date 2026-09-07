<template>
  <div class="kickoff-panel">
    <section class="kickoff-card">
      <div>
        <h4>{{ t('settings.modelWindowKickoff.wecomTitle') }}</h4>
        <p>{{ t('settings.modelWindowKickoff.wecomDescription') }}</p>
      </div>
      <div class="grid">
        <label>{{ t('settings.modelWindowKickoff.channelName') }}<input v-model="channelName" /></label>
        <label>{{ t('settings.modelWindowKickoff.botKey') }}<input v-model="botKey" type="password" :placeholder="channel?.configured ? t('settings.modelWindowKickoff.keyConfigured') : ''" /></label>
      </div>
      <button class="primary" :disabled="busy || (!botKey && !channel)" @click="saveChannel">{{ t('settings.modelWindowKickoff.saveChannel') }}</button>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-for="item in kickoffs" :key="item.id" class="kickoff-card">
      <div class="card-heading">
        <strong>{{ item.provider }}/{{ item.modelId }}</strong>
        <label class="enabled"><input v-model="item.enabled" type="checkbox" /> {{ t('settings.modelWindowKickoff.enabled') }}</label>
      </div>
      <div class="grid">
        <label>{{ t('settings.modelWindowKickoff.profile') }}
          <CustomSelect
            :id="`kickoff-profile-${item.id}`"
            :model-value="item.profileId"
            :options="profileOptions"
            :aria-label="t('settings.modelWindowKickoff.profile')"
            @update:model-value="setProfile(item, $event)"
          />
        </label>
        <label>{{ t('settings.modelWindowKickoff.model') }}
          <CustomSelect
            :id="`kickoff-model-${item.id}`"
            :model-value="modelValue(item)"
            :options="modelOptions(item.profileId)"
            :aria-label="t('settings.modelWindowKickoff.model')"
            searchable
            @update:model-value="setModel(item, $event)"
          />
        </label>
        <label>{{ t('settings.modelWindowKickoff.windowHours') }}<input v-model.number="item.windowHours" type="number" min="0.02" step="0.5" /></label>
        <label>{{ t('settings.modelWindowKickoff.bufferSeconds') }}<input v-model.number="item.safetyBufferSeconds" type="number" min="0" /></label>
        <label>{{ t('settings.modelWindowKickoff.nextRun') }}<input v-model="item.nextRunLocal" type="datetime-local" /></label>
        <label>{{ t('settings.modelWindowKickoff.notification') }}
          <CustomSelect
            :id="`kickoff-notification-${item.id}`"
            :model-value="item.notificationChannelId || ''"
            :options="notificationOptions"
            :aria-label="t('settings.modelWindowKickoff.notification')"
            @update:model-value="item.notificationChannelId = $event || null"
          />
        </label>
      </div>
      <label>{{ t('settings.modelWindowKickoff.prompt') }}<textarea v-model="item.prompt" rows="2" /></label>
      <div class="status">
        <span>{{ t('settings.modelWindowKickoff.lastSuccess') }}: {{ formatTime(item.lastSuccessAt) }}</span>
        <span>{{ t('settings.modelWindowKickoff.lastAttempt') }}: {{ formatTime(item.lastAttemptAt) }}</span>
        <span>{{ t('settings.modelWindowKickoff.nextScheduled') }}: {{ formatTime(fromLocal(item.nextRunLocal)) }}</span>
        <span v-if="item.lastError" class="error">{{ t('settings.modelWindowKickoff.lastError') }}: {{ item.lastError }}</span>
      </div>
      <div class="actions"><button class="primary" :disabled="busy" @click="save(item)">{{ t('settings.modelWindowKickoff.save') }}</button><button class="danger" :disabled="busy" @click="remove(item.id)">{{ t('settings.modelWindowKickoff.delete') }}</button></div>
    </section>

    <button class="primary" :disabled="busy || !profiles.length" @click="add">{{ t('settings.modelWindowKickoff.add') }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { i18n } from '../i18n';
import { apiRequest } from '../services/apiClient';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';

const t = i18n.global.t;

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
const channel = ref<Channel>();
const channelName = ref('WeCom');
const botKey = ref('');
const busy = ref(false);
const error = ref('');
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
    const [profileResult, kickoffResult, channelResult] = await Promise.all([
      apiRequest<{ profiles: Profile[] }>('/api/sessions/agent-profiles'),
      apiRequest<{ kickoffs: KickoffResponse[] }>('/api/model-window-kickoffs'),
      apiRequest<{ channels: Channel[] }>('/api/model-window-kickoffs/notification-channels'),
    ]);
    profiles.value = profileResult.profiles;
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

async function save(item: Draft): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const result = await apiRequest<{ kickoff: KickoffResponse }, ModelWindowKickoffPayload>(
      `/api/model-window-kickoffs/${item.id}`,
      { method: 'PUT', body: payload(item) },
    );
    Object.assign(item, toDraft(result.kickoff));
  } catch (cause) {
    error.value = message(cause);
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
        prompt: 'Reply with OK only.',
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
  item.profileId = profileId;
  void loadModels(profileId);
}

function setModel(item: Draft, value: string): void {
  [item.provider, item.modelId] = value.split('\n');
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
.kickoff-panel { display: grid; gap: 14px; }
.kickoff-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-secondary); }
.kickoff-card h4, .kickoff-card p { margin: 0; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label { display: grid; gap: 5px; font-size: 13px; }
input, textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; color: var(--text-primary); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; }
.card-heading, .actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.enabled { display: flex; align-items: center; }
.enabled input { width: auto; }
.status { display: grid; gap: 4px; color: var(--text-secondary); font-size: 12px; }
.primary, .danger { width: fit-content; padding: 8px 13px; border: 0; border-radius: 6px; cursor: pointer; }
.primary { color: white; background: var(--accent-color); }
.danger { color: var(--danger-color); background: transparent; }
.error { color: var(--danger-color); }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
</style>
