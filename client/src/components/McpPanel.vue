<template>
  <section class="mcp-panel" :aria-label="t('mcp.title')">
    <p>{{ t(sessionId ? 'mcp.sessionHelp' : 'mcp.profileHelp') }}</p>
    <p v-if="!sessionId">{{ t('mcp.installHelp') }}</p>
    <label v-if="!sessionId">{{ t('mcp.profile') }}
      <select v-model="profileId" :disabled="busy" @change="editor = null; load()">
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.label || profile.id }}</option>
      </select>
    </label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading">{{ t('mcp.loading') }}</p>
    <button v-if="!sessionId" type="button" data-testid="add-mcp-server" :disabled="busy || !profileId" @click="editor = { name: '', text: JSON.stringify({ command: 'npx', args: ['-y', 'your-mcp-server'] }, null, 2), existing: false }">{{ t('mcp.addServer') }}</button>
    <form v-if="editor" @submit.prevent="saveServer">
      <label>{{ t('mcp.serverName') }}<input v-model="editor.name" name="mcp-server-name" :disabled="editor.existing || busy" required pattern="[a-zA-Z0-9_-]{1,100}" /></label>
      <label>{{ t('mcp.configuration') }}<textarea v-model="editor.text" name="mcp-server-config" rows="8" spellcheck="false" :disabled="busy" required /></label>
      <p>{{ t('mcp.serverHelp') }}</p>
      <p>{{ t('mcp.secretHelp') }}</p>
      <button type="submit" :disabled="busy">{{ t('mcp.save') }}</button>
      <button type="button" :disabled="busy" @click="editor = null">{{ t('mcp.cancel') }}</button>
    </form>
    <p v-if="!loading && !servers.length">{{ t('mcp.empty') }}</p>
    <article v-for="server in servers" :key="server.name" class="mcp-server">
      <header><h4>{{ server.name }}</h4><span>{{ server.transport }}</span></header>
      <small class="mcp-source">{{ server.source }}</small>
      <p>{{ (server.status ? statusLabel(server.status) : '') || t(server.cachedAt ? (server.cacheValid === false ? 'mcp.stale' : 'mcp.cached') : 'mcp.undiscovered') }}</p>
      <template v-if="!sessionId">
        <button type="button" :disabled="busy" @click="discover(server.name)">{{ t('mcp.discover') }}</button>
        <button v-if="server.editable || server.canOverride" type="button" :disabled="busy" @click="editServer(server)">{{ t(server.editable ? 'mcp.edit' : 'mcp.override') }}</button>
        <button v-if="server.editable" type="button" :disabled="busy" @click="removeTarget = server.name">{{ t('mcp.remove') }}</button>
      </template>
      <p v-if="!server.tools.length">{{ t('mcp.noTools') }}</p>
      <label v-for="tool in server.tools" :key="tool.name" class="mcp-tool" :data-tool="tool.name">
        <input type="checkbox" :checked="tool.enabled" :disabled="busy || (sessionId ? !tool.profileEnabled : tool.excluded)" @change="onToggle(server.name, tool, $event)" />
        <span><strong>{{ tool.name }}</strong> <small>{{ t(tool.exposure === 'direct' ? 'mcp.direct' : 'mcp.proxy') }}</small>
          <small v-if="!tool.profileEnabled && sessionId"> · {{ t('mcp.profileDisabled') }}</small>
          <small v-if="tool.excluded"> · {{ t('mcp.excluded') }}</small>
          <span class="mcp-description">{{ tool.description }}</span>
        </span>
      </label>
    </article>
    <ConfirmModal :visible="Boolean(removeTarget)" variant="danger" @confirm="removeServer" @cancel="removeTarget = ''">
      <template #title>{{ t('mcp.remove') }}</template>
      <template #message>{{ t('mcp.removeHelp', { name: removeTarget }) }}</template>
    </ConfirmModal>
  </section>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { i18n } from '../i18n';
import { useToasts } from '../composables/useToasts';
import ConfirmModal from './ConfirmModal.vue';

interface Tool { name: string; description: string; enabled: boolean; profileEnabled: boolean; excluded?: boolean; exposure: string }
interface Server { name: string; source: string; transport: string; editable: boolean; canOverride?: boolean; config: Record<string, unknown>; tools: Tool[]; cachedAt: number | null; cacheValid?: boolean; status?: string }
const props = defineProps<{ sessionId?: string; clientId?: string; projectPath?: string }>();
const t = i18n.global.t;
const { showToast } = useToasts();
const profiles = ref<{ id: string; label?: string }[]>([]);
const profileId = ref('');
const servers = ref<Server[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const editor = ref<{ name: string; text: string; existing: boolean } | null>(null);
const removeTarget = ref('');
let requestId = 0;
let disposed = false;
function statusLabel(status: string) {
  const labels: Record<string, string> = { connected: 'connected', 'not connected': 'disconnected', 'needs-auth': 'needsAuth', failed: 'connectionFailed', cached: 'cached' };
  return labels[status] ? t(`mcp.${labels[status]}`) : status;
}
function profileUrl() { return `/api/sessions/agent-profiles/${encodeURIComponent(profileId.value)}/mcp`; }
function contextQuery() { return props.projectPath ? `?${new URLSearchParams({ projectPath: props.projectPath })}` : ''; }
async function request(url: string, method?: string, data?: unknown) {
  const response = await fetch(url, method ? { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || t('mcp.failed'));
  return result;
}
async function load() {
  const id = ++requestId;
  loading.value = true; error.value = ''; servers.value = [];
  try {
    if (!props.sessionId && !profiles.value.length) {
      const result = await request('/api/sessions/agent-profiles');
      if (disposed || id !== requestId) return;
      profiles.value = result.profiles || [];
      profileId.value = profiles.value[0]?.id || '';
    }
    if (!props.sessionId && !profileId.value) return;
    const url = props.sessionId ? `/api/sessions/${encodeURIComponent(props.sessionId)}/mcp?${new URLSearchParams({ clientId: props.clientId || '' })}` : profileUrl() + contextQuery();
    const result = await request(url);
    if (!disposed && id === requestId) servers.value = result.servers || [];
  } catch (cause) { if (!disposed && id === requestId) error.value = cause instanceof Error ? cause.message : t('mcp.failed'); }
  finally { if (!disposed && id === requestId) loading.value = false; }
}
async function mutate(work: () => Promise<any>) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  const id = requestId;
  try {
    const result = await work();
    if (!disposed && id === requestId) { servers.value = result.servers || []; showToast(t('mcp.saved'), 'success'); }
  } catch (cause) {
    if (!disposed && id === requestId) { error.value = cause instanceof Error ? cause.message : t('mcp.failed'); showToast(error.value, 'error'); }
    // Restore checkbox state after a rejected permission change.
    if (!disposed && id === requestId) servers.value = [...servers.value];
  } finally { if (!disposed) busy.value = false; }
}
function onToggle(server: string, tool: Tool, event: Event) {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  input.checked = tool.enabled;
  void toggle(server, tool.name, enabled);
}
async function toggle(server: string, tool: string, enabled: boolean) {
  const changes = [{ server, tool, enabled }];
  await mutate(() => props.sessionId
    ? request(`/api/sessions/${encodeURIComponent(props.sessionId)}/mcp`, 'PUT', { clientId: props.clientId, changes })
    : request(`${profileUrl()}/tools`, 'PUT', { changes, ...(props.projectPath ? { projectPath: props.projectPath } : {}) }));
}
function editServer(server: Server) {
  editor.value = { name: server.name, text: JSON.stringify(server.config, null, 2), existing: true };
}
async function saveServer() {
  if (!editor.value) return;
  let config: unknown;
  try { config = JSON.parse(editor.value.text); } catch { error.value = t('mcp.invalidJson'); return; }
  const name = editor.value.name;
  await mutate(() => request(`${profileUrl()}/servers/${encodeURIComponent(name)}`, 'PUT', { config, ...(props.projectPath ? { projectPath: props.projectPath } : {}) }));
  if (!error.value) editor.value = null;
}
async function discover(server: string) {
  await mutate(() => request(`${profileUrl()}/discover`, 'POST', { server, ...(props.projectPath ? { projectPath: props.projectPath } : {}) }));
}
async function removeServer() {
  const name = removeTarget.value; removeTarget.value = '';
  await mutate(() => request(`${profileUrl()}/servers/${encodeURIComponent(name)}${contextQuery()}`, 'DELETE'));
}
watch(() => [props.sessionId, props.clientId, props.projectPath], () => { editor.value = null; removeTarget.value = ''; void load(); }, { immediate: true });
onBeforeUnmount(() => { disposed = true; ++requestId; });
</script>

<style scoped>
.mcp-panel { display: grid; gap: 12px; }
.mcp-panel p { margin: 0; color: var(--text-secondary); }
.mcp-panel label, .mcp-panel form { display: grid; gap: 8px; }
.mcp-panel button { padding: 6px 10px; margin-right: 6px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; }
.mcp-panel button:disabled { opacity: .5; cursor: default; }
.mcp-panel input:not([type=checkbox]), .mcp-panel select, .mcp-panel textarea { padding: 8px; color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; width: 100%; box-sizing: border-box; }
.mcp-panel textarea { font-family: monospace; }
.mcp-server { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; }
.mcp-server header { display: flex; align-items: center; gap: 12px; }
.mcp-server h4 { margin: 0; }
.mcp-source { display: block; overflow-wrap: anywhere; color: var(--text-secondary); margin: 8px 0; }
.mcp-panel .mcp-tool { display: flex; align-items: flex-start; padding: 10px 0; }
.mcp-tool input { margin-top: 4px; }
.mcp-description { display: block; color: var(--text-secondary); overflow-wrap: anywhere; }
.mcp-panel .error { color: var(--error-color, #ef4444); }
</style>
