<template>
  <section class="mcp-panel" :aria-label="t('mcp.title')">
    <p>{{ t(sessionId ? 'mcp.sessionHelp' : 'mcp.profileHelp') }}</p>
    <p v-if="!sessionId">{{ t('mcp.installHelp') }}</p>
    <div v-if="!sessionId" class="mcp-toolbar">
      <div class="profile-field"><label for="mcp-profile">{{ t('mcp.profile') }}</label>
        <CustomSelect id="mcp-profile" :model-value="profileId" :options="profiles.map(profile => ({ value: profile.id, label: profile.label || profile.id }))" searchable :disabled="busy" @update:model-value="selectProfile" />
      </div>
      <button type="button" class="primary" data-testid="add-mcp-server" :disabled="busy || !profileId" @click="openEditor()">{{ t('mcp.addServer') }}</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading">{{ t('mcp.loading') }}</p>
    <McpServerEditor v-if="editor" :server="editor.server" :busy="busy" :error="error" @save="saveServer" @close="editor = null" />
    <p v-if="!loading && !servers.length">{{ t('mcp.empty') }}</p>
    <article v-for="server in servers" :key="server.name" class="mcp-server">
      <header>
        <div class="server-heading"><h4>{{ server.name }}</h4><span class="transport">{{ t(server.transport === 'stdio' ? 'mcp.localCommand' : 'mcp.httpServer') }}</span></div>
        <button type="button" class="server-toggle" role="switch" :aria-checked="server.enabled" :aria-label="t('mcp.toggleServer', { name: server.name })" :disabled="busy || Boolean(sessionId && !server.profileEnabled)" :data-server="server.name" @click="toggle(server.name, !server.enabled)"><span class="toggle-track"><span /></span>{{ t(server.enabled ? 'mcp.enabled' : 'mcp.disabled') }}</button>
      </header>
      <small v-if="sessionId && !server.profileEnabled" class="profile-disabled">{{ t('mcp.profileDisabled') }}</small>
      <small class="mcp-source">{{ server.source }}</small>
      <p>{{ (server.status ? statusLabel(server.status) : '') || t(server.cachedAt ? (server.cacheValid === false ? 'mcp.stale' : 'mcp.cached') : 'mcp.undiscovered') }}</p>
      <div v-if="!sessionId" class="server-actions">
        <button type="button" :disabled="busy || !server.enabled" @click="discover(server.name)">{{ t('mcp.discover') }}</button>
        <button v-if="server.editable || server.canOverride" type="button" :disabled="busy" @click="openEditor(server)">{{ t(server.editable ? 'mcp.edit' : 'mcp.override') }}</button>
        <button v-if="server.editable" type="button" :disabled="busy" @click="removeTarget = server.name">{{ t('mcp.remove') }}</button>
      </div>
      <details class="server-tools">
        <summary>{{ t('mcp.tools', { count: server.tools.length }) }}</summary>
        <p v-if="!server.tools.length">{{ t('mcp.noTools') }}</p>
        <ul v-else>
          <li v-for="tool in server.tools" :key="tool.name" :data-tool="tool.name"><strong>{{ tool.name }}</strong><span v-if="tool.description" class="mcp-description">{{ tool.description }}</span></li>
        </ul>
      </details>
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
import CustomSelect from './CustomSelect.vue';
import McpServerEditor from './McpServerEditor.vue';

interface Tool { name: string; description: string }
interface Server { name: string; source: string; transport: string; editable: boolean; canOverride?: boolean; enabled: boolean; profileEnabled: boolean; secretFields?: string[]; config: Record<string, unknown>; tools: Tool[]; cachedAt: number | null; cacheValid?: boolean; status?: string }
const props = defineProps<{ sessionId?: string; clientId?: string; projectPath?: string }>();
const t = i18n.global.t;
const { showToast } = useToasts();
const profiles = ref<{ id: string; label?: string }[]>([]);
const profileId = ref('');
const servers = ref<Server[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const editor = ref<{ server?: Server } | null>(null);
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
  } finally { if (!disposed) busy.value = false; }
}
function selectProfile(value: string) {
  profileId.value = value; editor.value = null; removeTarget.value = ''; void load();
}
async function toggle(server: string, enabled: boolean) {
  const changes = [{ server, enabled }];
  await mutate(() => props.sessionId
    ? request(`/api/sessions/${encodeURIComponent(props.sessionId)}/mcp`, 'PUT', { clientId: props.clientId, changes })
    : request(`${profileUrl()}/servers`, 'PUT', { changes, ...(props.projectPath ? { projectPath: props.projectPath } : {}) }));
}
function openEditor(server?: Server) {
  error.value = ''; editor.value = { server };
}
async function saveServer(name: string, config: Record<string, unknown>) {
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
.mcp-panel { display: grid; gap: 16px; }
.mcp-panel p { margin: 0; color: var(--text-secondary); font-size: .875rem; line-height: 1.5; }
.mcp-toolbar { display: flex; align-items: flex-end; gap: 12px; margin: 4px 0; }
.profile-field { flex: 1; min-width: 0; display: grid; gap: 8px; }
.profile-field label { font-size: .875rem; }
.mcp-panel button { padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; font-size: .8rem; }
.mcp-panel button.primary { background: var(--accent); border-color: var(--accent); color: var(--text-inverse, #fff); }
.mcp-panel button:disabled { opacity: .5; cursor: default; }
.mcp-server { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; background: var(--bg-secondary); }
.mcp-server header, .server-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.mcp-server header { justify-content: space-between; }
.mcp-server h4 { margin: 0; overflow-wrap: anywhere; }
.transport { color: var(--text-secondary); background: var(--bg-tertiary); padding: 3px 7px; border-radius: var(--radius-sm); font-size: .75rem; }
.mcp-source { display: block; overflow-wrap: anywhere; color: var(--text-secondary); margin: 8px 0; font-size: .75rem; }
.profile-disabled { color: var(--text-secondary); }
.server-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.mcp-panel .server-toggle { display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 4px 0; }
.toggle-track { width: 30px; height: 18px; padding: 2px; box-sizing: border-box; border-radius: 12px; background: var(--border); }
.toggle-track span { display: block; width: 14px; height: 14px; border-radius: 50%; background: var(--text-secondary); transition: transform .15s; }
[aria-checked=true] .toggle-track { background: var(--accent); }
[aria-checked=true] .toggle-track span { background: #fff; transform: translateX(12px); }
.server-tools { margin-top: 16px; border-top: 1px solid var(--border-subtle); padding-top: 12px; }
.server-tools summary { color: var(--text-secondary); font-size: .8rem; cursor: pointer; }
.server-tools ul { padding: 0; list-style: none; margin: 8px 0 0; }
.server-tools li { padding: 8px 0; font-size: .8rem; overflow-wrap: anywhere; }
.server-tools p { margin-top: 8px; }
.mcp-description { display: block; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }
.mcp-panel .error { color: var(--error-color, #ef4444); }
@media (max-width: 520px) { .mcp-toolbar { align-items: stretch; flex-direction: column; } }
</style>
