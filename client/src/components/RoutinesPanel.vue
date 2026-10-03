<template>
  <div class="routines-panel">
    <header class="panel-heading">
      <div>
        <h3>{{ t('settings.routines.title') }}</h3>
        <p>{{ t('settings.routines.description') }}</p>
      </div>
      <button
        data-test="add"
        :disabled="busy || !profiles.length"
        @click="edit()"
      >
        {{ t('settings.routines.add') }}
      </button>
    </header>
    <p class="time-basis">
      {{ t('settings.routines.serverTime', { zone: serverTimeZone }) }}
    </p>
    <div
      v-if="notice"
      class="routine-toast"
      :class="{ error: notice.error }"
      role="status"
      aria-live="polite"
    >
      {{ notice.message }}
    </div>
    <form v-if="draft" class="routine-card editor" @submit.prevent="save">
      <div class="fields">
        <label
          >{{ t('settings.routines.name')
          }}<input
            v-model="draft.name"
            data-test="name"
            required
            maxlength="200"
        /></label>
        <label
          >{{ t('settings.routines.profile')
          }}<select v-model="draft.profileId" @change="changeProfile">
            <option v-for="p in profiles" :key="p.id" :value="p.id">
              {{ p.label || p.id }}
            </option>
          </select></label
        >
        <label
          >{{ t('settings.routines.model')
          }}<select v-model="selectedModel" required>
            <option
              v-for="m in models"
              :key="m.provider + m.id"
              :value="m.provider + '\n' + m.id"
            >
              {{ m.name || m.id }} [{{ m.provider }}]
            </option>
          </select></label
        >
        <label
          >{{ t('settings.routines.project') }}
          <div class="path-field">
            <input v-model="draft.projectPath" required /><button
              type="button"
              @click="picker = true"
            >
              {{ t('settings.routines.browse') }}
            </button>
          </div></label
        >
        <label class="full"
          >{{ t('settings.routines.prompt')
          }}<textarea
            v-model="draft.prompt"
            data-test="prompt"
            required
            maxlength="50000"
            rows="4"
          />
        </label>
        <label
          >{{ t('settings.routines.schedule')
          }}<select v-model="kind">
            <option value="once">{{ t('settings.routines.once') }}</option>
            <option value="interval">
              {{ t('settings.routines.interval') }}
            </option>
            <option value="daily">{{ t('settings.routines.daily') }}</option>
          </select></label
        >
        <label v-if="kind === 'daily'"
          >{{ t('settings.routines.dailyTime')
          }}<input v-model="dailyTime" type="time" required
        /></label>
        <label v-else
          >{{ t('settings.routines.firstRun')
          }}<input v-model="startLocal" type="datetime-local" required
        /></label>
        <label v-if="kind === 'interval'"
          >{{ t('settings.routines.minutes')
          }}<input
            v-model.number="intervalMinutes"
            type="number"
            min="5"
            max="525600"
            required
        /></label>
        <label
          >{{ t('settings.routines.timeout')
          }}<input
            v-model.number="draft.timeoutMinutes"
            type="number"
            min="1"
            max="120"
            required
        /></label>
        <label
          >{{ t('settings.routines.channel')
          }}<select v-model="draft.notificationChannelId">
            <option :value="null">{{ t('settings.routines.none') }}</option>
            <option v-for="c in channels" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select></label
        >
      </div>
      <p class="hint">{{ t('settings.routines.channelHint') }}</p>
      <label class="enabled"
        ><input v-model="draft.enabled" type="checkbox" />{{
          t('settings.routines.enabled')
        }}</label
      >
      <p class="permission-note">{{ t('settings.routines.permissions') }}</p>
      <footer>
        <button type="button" :disabled="busy" @click="draft = null">
          {{ t('settings.routines.close') }}</button
        ><button type="submit" :disabled="busy || !selectedModel">
          {{ t('settings.routines.save') }}
        </button>
      </footer>
    </form>
    <p v-if="!routines.length && !draft" class="empty">
      {{ t('settings.routines.empty') }}
    </p>
    <article v-for="r in routines" :key="r.id" class="routine-card">
      <div class="row">
        <strong>{{ r.name }}</strong
        ><span class="state">{{
          r.enabled
            ? t('settings.routines.enabled')
            : t('settings.routines.disabled')
        }}</span>
      </div>
      <p class="path">{{ r.projectPath }}</p>
      <p>
        {{ scheduleLabel(r) }} · {{ t('settings.routines.next') }}:
        {{ formatTime(r.nextRunAt) }}
      </p>
      <p v-if="latest(r.id)">
        {{ t('settings.routines.last') }}:
        {{ statusLabel(latest(r.id)!.status) }}
      </p>
      <footer>
        <button :disabled="busy" @click="edit(r)">
          {{ t('settings.routines.edit') }}</button
        ><button
          :disabled="busy || hasActive(r.id)"
          @click="action('/' + r.id + '/run')"
        >
          {{ t('settings.routines.run') }}</button
        ><button
          :disabled="busy || hasActive(r.id)"
          @click="confirm = { path: '/' + r.id, method: 'DELETE' }"
        >
          {{ t('settings.routines.remove') }}
        </button>
      </footer>
    </article>
    <div class="history-heading">
      <h4>{{ t('settings.routines.history') }}</h4>
      <button :disabled="busy" @click="refresh">
        {{ t('settings.routines.refresh') }}
      </button>
    </div>
    <p v-if="!runs.length" class="empty">{{ t('settings.routines.noRuns') }}</p>
    <article v-for="run in runs" :key="run.id" class="routine-card run-card">
      <div class="row">
        <strong>{{ run.snapshot.name }}</strong
        ><span class="state" :class="run.status">{{
          statusLabel(run.status)
        }}</span>
      </div>
      <p>{{ formatTime(run.queuedAt) }} → {{ formatTime(run.finishedAt) }}</p>
      <p class="path">{{ run.id }}</p>
      <p v-if="run.sessionId" class="path">
        {{ t('settings.routines.session') }}: {{ run.sessionId }}
      </p>
      <details v-if="run.summary || run.error">
        <summary>{{ t('settings.routines.result') }}</summary>
        <pre>{{ run.summary || run.error }}</pre>
      </details>
      <p v-if="run.delivery">
        {{ t('settings.routines.delivery') }}:
        {{ statusLabel(run.delivery.status)
        }}<span v-if="run.delivery.error"> · {{ run.delivery.error }}</span>
      </p>
      <footer
        v-if="
          run.status === 'queued' ||
          run.status === 'running' ||
          run.delivery?.status === 'failed'
        "
      >
        <button
          v-if="run.status === 'queued' || run.status === 'running'"
          :disabled="busy"
          @click="
            confirm = { path: '/runs/' + run.id + '/cancel', method: 'POST' }
          "
        >
          {{ t('settings.routines.cancelRun') }}</button
        ><button
          v-if="run.delivery?.status === 'failed'"
          :disabled="busy"
          @click="action('/runs/' + run.id + '/retry-delivery')"
        >
          {{ t('settings.routines.retryDelivery') }}
        </button>
      </footer>
    </article>
    <footer class="pagination">
      <button :disabled="busy || offset === 0" @click="page(-1)">
        {{ t('settings.routines.previous') }}</button
      ><span>{{ offset + 1 }}–{{ offset + runs.length }}</span
      ><button :disabled="busy || runs.length < 20" @click="page(1)">
        {{ t('settings.routines.nextPage') }}
      </button>
    </footer>
    <ConfirmModal
      :visible="Boolean(confirm)"
      variant="warning"
      @confirm="confirmAction"
      @cancel="confirm = null"
      ><template #message>{{
        t('settings.routines.confirm')
      }}</template></ConfirmModal
    >
    <FolderPickerModal
      :visible="picker"
      :initial-path="draft?.projectPath || defaultProject"
      :client-id="clientId"
      :show-clone="false"
      @close="picker = false"
      @select="selectProject"
    />
  </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { i18n } from '../i18n';
import { apiRequest } from '../services/apiClient';
import type { Routine, RoutineInput, Run, Schedule } from '../types/routine';
import ConfirmModal from './ConfirmModal.vue';
import FolderPickerModal from './FolderPickerModal.vue';
defineProps<{ clientId?: string }>();
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
const routines = ref<Routine[]>([]),
  runs = ref<Run[]>([]),
  latestRuns = ref<Run[]>([]),
  profiles = ref<Profile[]>([]),
  models = ref<Model[]>([]),
  channels = ref<{ id: string; name: string }[]>([]);
const draft = ref<(RoutineInput & { id?: string }) | null>(null),
  selectedModel = ref(''),
  kind = ref<Schedule['kind']>('interval'),
  startLocal = ref(''),
  dailyTime = ref('08:00'),
  intervalMinutes = ref(60);
const busy = ref(false),
  picker = ref(false),
  defaultProject = ref(''),
  serverTimeZone = ref(''),
  offset = ref(0),
  notice = ref<{ message: string; error: boolean } | null>(null),
  confirm = ref<{ path: string; method: string } | null>(null);
let poll: ReturnType<typeof setInterval> | undefined,
  toastTimer: ReturnType<typeof setTimeout> | undefined;
let alive = true,
  loading = false,
  refreshQueued = false,
  modelRequest = 0;
function notify(message: string, error = false) {
  if (!alive) return;
  notice.value = { message, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    notice.value = null;
  }, 5000);
}
async function refresh() {
  if (loading) {
    refreshQueued = true;
    return;
  }
  loading = true;
  const requestedOffset = offset.value;
  try {
    const [r, h] = await Promise.all([
      apiRequest<{
        routines: Routine[];
        latestRuns: Run[];
        serverTimeZone: string;
      }>('/api/routines'),
      apiRequest<{ runs: Run[] }>(
        `/api/routines/runs?offset=${requestedOffset}&limit=20`,
      ),
    ]);
    if (alive) {
      routines.value = r.routines;
      latestRuns.value = r.latestRuns;
      serverTimeZone.value = r.serverTimeZone;
      if (requestedOffset === offset.value) runs.value = h.runs;
    }
  } catch (e) {
    if (alive) notify(String((e as Error).message), true);
  } finally {
    loading = false;
    if (alive && refreshQueued) {
      refreshQueued = false;
      void refresh();
    }
  }
}
async function changeProfile() {
  if (!draft.value) return;
  const id = draft.value.profileId;
  const request = ++modelRequest;
  models.value = [];
  selectedModel.value = '';
  try {
    const result = await apiRequest<{ models: Model[] }>(
      `/api/sessions/agent-profiles/${encodeURIComponent(id)}/models`,
    );
    if (!alive || request !== modelRequest || draft.value?.profileId !== id)
      return;
    models.value = result.models;
    const p = profiles.value.find((p) => p.id === id);
    const m =
      result.models.find(
        (m) =>
          m.provider === draft.value!.provider && m.id === draft.value!.modelId,
      ) ||
      result.models.find(
        (m) => m.provider === p?.defaultProvider && m.id === p?.defaultModel,
      ) ||
      result.models[0];
    selectedModel.value = m ? `${m.provider}\n${m.id}` : '';
  } catch (e) {
    if (alive) notify((e as Error).message, true);
  }
}
async function edit(r?: Routine) {
  draft.value = r
    ? JSON.parse(JSON.stringify(r))
    : {
        name: '',
        prompt: '',
        projectPath: defaultProject.value,
        profileId: profiles.value[0]?.id || '',
        provider: '',
        modelId: '',
        enabled: false,
        schedule: {
          kind: 'interval',
          startAt: new Date(Date.now() + 3600000).toISOString(),
          minutes: 60,
        },
        timeoutMinutes: 30,
        notificationChannelId: null,
      };
  const schedule = draft.value!.schedule;
  kind.value = schedule.kind;
  if (schedule.kind === 'daily') dailyTime.value = schedule.time;
  else {
    startLocal.value = toLocal(schedule.startAt);
    if (schedule.kind === 'interval') intervalMinutes.value = schedule.minutes;
  }
  await changeProfile();
}
function toLocal(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  try {
    const [provider, modelId] = selectedModel.value.split('\n');
    const schedule: Schedule =
      kind.value === 'daily'
        ? { kind: 'daily', time: dailyTime.value }
        : kind.value === 'once'
          ? { kind: 'once', startAt: new Date(startLocal.value).toISOString() }
          : {
              kind: 'interval',
              startAt: new Date(startLocal.value).toISOString(),
              minutes: intervalMinutes.value,
            };
    await apiRequest(
      '/api/routines' + (draft.value.id ? '/' + draft.value.id : ''),
      {
        method: draft.value.id ? 'PUT' : 'POST',
        body: { ...draft.value, provider, modelId, schedule },
      },
    );
    draft.value = null;
    notify(t('settings.routines.saved'));
    await refresh();
  } catch (e) {
    notify((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function action(path: string, method = 'POST') {
  busy.value = true;
  try {
    await apiRequest('/api/routines' + path, { method });
    notify(t('settings.routines.accepted'));
    await refresh();
  } catch (e) {
    notify((e as Error).message, true);
  } finally {
    busy.value = false;
  }
}
async function confirmAction() {
  const command = confirm.value;
  confirm.value = null;
  if (command) await action(command.path, command.method);
}
function selectProject(value: { path: string }) {
  if (draft.value) draft.value.projectPath = value.path;
  picker.value = false;
}
function latest(id: string) {
  return latestRuns.value.find((r) => r.routineId === id);
}
function hasActive(id: string) {
  return latestRuns.value.some(
    (r) =>
      r.routineId === id && (r.status === 'queued' || r.status === 'running'),
  );
}
function statusLabel(status: string) {
  return t('settings.routines.status.' + status);
}
function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}
function scheduleLabel(r: Routine) {
  return r.schedule.kind === 'daily'
    ? `${t('settings.routines.daily')} ${r.schedule.time}`
    : r.schedule.kind === 'interval'
      ? t('settings.routines.every', { minutes: r.schedule.minutes })
      : t('settings.routines.once');
}
async function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * 20);
  await refresh();
}
onMounted(async () => {
  try {
    const [p, c, d] = await Promise.all([
      apiRequest<{ profiles: Profile[] }>('/api/sessions/agent-profiles'),
      apiRequest<{
        channels: { id: string; name: string; configured: boolean }[];
      }>('/api/model-window-kickoffs/notification-channels'),
      apiRequest<{ projectPath: string }>('/api/sessions/project-path'),
    ]);
    if (!alive) return;
    profiles.value = p.profiles;
    channels.value = c.channels.filter((c) => c.configured);
    defaultProject.value = d.projectPath;
    await refresh();
    if (alive)
      poll = setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, 5000);
  } catch (e) {
    if (alive) notify((e as Error).message, true);
  }
});
onUnmounted(() => {
  alive = false;
  clearInterval(poll);
  clearTimeout(toastTimer);
});
</script>
<style scoped>
.routines-panel {
  display: grid;
  gap: 1rem;
}
.panel-heading,
.row,
.history-heading,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.panel-heading h3,
.history-heading h4 {
  margin: 0;
}
.panel-heading p,
.hint,
.time-basis,
.path,
.empty {
  color: var(--text-secondary);
  font-size: 0.82rem;
}
.panel-heading p {
  max-width: 36rem;
}
.routine-card {
  padding: 1.1rem 1.2rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-secondary);
}
.routine-card p {
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.fields label {
  display: grid;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}
.full {
  grid-column: 1/-1;
}
input,
select,
textarea {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 0.65rem;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 7px;
  font: inherit;
}
input:focus,
select:focus,
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
textarea {
  resize: vertical;
}
.path-field {
  display: flex;
  gap: 0.4rem;
}
.enabled {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  font-size: 0.85rem;
}
.enabled input {
  width: auto;
}
.permission-note {
  padding: 0.75rem;
  border-left: 3px solid var(--accent);
  background: var(--bg-primary);
  line-height: 1.6;
}
button {
  padding: 0.55rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text-primary);
  background: var(--bg-primary);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
footer {
  justify-content: flex-end;
  margin-top: 1rem;
  flex-wrap: wrap;
}
.state {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  background: var(--bg-primary);
  color: var(--text-secondary);
}
.state.succeeded {
  color: var(--success);
}
.state.failed,
.state.interrupted,
.state.timed_out,
.error {
  color: var(--error);
}
.routine-toast {
  padding: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--success);
}
.run-card summary {
  cursor: pointer;
  font-size: 0.82rem;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.8rem;
  line-height: 1.6;
  max-height: 20rem;
  overflow: auto;
}
.pagination {
  justify-content: space-between;
  font-size: 0.8rem;
}
.path {
  font-family: monospace;
}
@media (max-width: 650px) {
  .fields {
    grid-template-columns: 1fr;
  }
  .panel-heading {
    align-items: flex-start;
  }
  .full {
    grid-column: auto;
  }
}
</style>
