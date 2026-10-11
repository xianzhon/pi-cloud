<template>
  <Teleport to="body">
    <div class="mcp-editor-backdrop" @click.self="close" @keydown.esc.stop.prevent="close" @keydown.tab="trapFocus">
      <section ref="dialog" class="mcp-editor" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <header>
          <div><h3 :id="titleId">{{ t(server ? 'mcp.edit' : 'mcp.addServer') }}</h3><p>{{ t('mcp.editorHelp') }}</p></div>
          <DialogCloseButton :label="t('mcp.close')" :disabled="busy" @click="close" />
        </header>
        <form @submit.prevent="submit">
          <div class="editor-fields">
            <label>{{ t('mcp.serverName') }}<input ref="nameInput" v-model="name" name="mcp-server-name" :disabled="Boolean(server) || busy" required pattern="[a-zA-Z0-9_-]{1,100}" placeholder="my-server" /></label>
            <div class="connection-field">
              <span>{{ t('mcp.connectionType') }}</span>
              <div class="connection-options" role="group" :aria-label="t('mcp.connectionType')">
                <button v-for="type in ['stdio', 'http']" :key="type" type="button" :aria-pressed="transport === type" :disabled="busy" @click="transport = type">{{ t(type === 'stdio' ? 'mcp.localCommand' : 'mcp.httpServer') }}</button>
              </div>
            </div>
            <template v-if="transport === 'stdio'">
              <label>{{ t('mcp.command') }}<input v-model="command" name="mcp-command" required :disabled="busy" placeholder="npx" /></label>
              <label>{{ t('mcp.arguments') }}<textarea v-model="args" name="mcp-args" rows="3" :disabled="busy" placeholder="-y&#10;your-mcp-server" /><small>{{ t('mcp.argumentsHelp') }}</small></label>
            </template>
            <label v-else>{{ t('mcp.url') }}<input v-model="url" name="mcp-url" type="url" required :disabled="busy" placeholder="https://example.com/mcp" /></label>
            <details class="advanced">
              <summary>{{ t('mcp.advanced') }}</summary>
              <div class="advanced-fields">
                <label v-if="transport === 'stdio'">{{ t('mcp.cwd') }}<input v-model="cwd" name="mcp-cwd" :disabled="busy" /></label>
                <div class="variables">
                  <span>{{ t(transport === 'stdio' ? 'mcp.environment' : 'mcp.headers') }}</span>
                  <p v-if="server?.secretFields?.includes(transport === 'stdio' ? 'env' : 'headers')">{{ t('mcp.storedValues') }}</p>
                  <div v-for="(row, index) in activeVariables" :key="index" class="variable-row">
                    <input v-model="row.key" :aria-label="t('mcp.variableName')" :placeholder="t('mcp.variableName')" :disabled="busy" />
                    <input v-model="row.value" :aria-label="t('mcp.variableValue')" :placeholder="t('mcp.variableValue')" :disabled="busy" autocomplete="off" />
                    <button type="button" :aria-label="t('mcp.removeValue')" :disabled="busy" @click="activeVariables.splice(index, 1)">×</button>
                  </div>
                  <button type="button" :disabled="busy" @click="activeVariables.push({ key: '', value: '' })">{{ t('mcp.addValue') }}</button>
                </div>
                <label>{{ t('mcp.additionalOptions') }}<textarea v-model="advanced" name="mcp-server-config" rows="5" spellcheck="false" :disabled="busy" /></label>
              </div>
            </details>
            <p class="editor-hint">{{ t('mcp.serverHelp') }}</p>
            <p class="editor-hint">{{ t('mcp.secretHelp') }}</p>
            <p v-if="validation || error" class="editor-error" role="alert">{{ validation || error }}</p>
          </div>
          <footer>
            <button type="button" :disabled="busy" @click="close">{{ t('mcp.cancel') }}</button>
            <button type="submit" class="primary" :disabled="busy">{{ t(busy ? 'mcp.saving' : 'mcp.save') }}</button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { i18n } from '../i18n';
import DialogCloseButton from './DialogCloseButton.vue';

const props = defineProps<{ server?: { name: string; config: Record<string, unknown>; secretFields?: string[] }; busy: boolean; error: string }>();
const emit = defineEmits<{ save: [name: string, config: Record<string, unknown>]; close: [] }>();
const t = i18n.global.t;
const config = props.server?.config || {};
const name = ref(props.server?.name || '');
const transport = ref(config.url ? 'http' : 'stdio');
const command = ref(String(config.command || ''));
const args = ref((config.args as string[] || []).join('\n'));
const url = ref(String(config.url || ''));
const cwd = ref(String(config.cwd || ''));
const advanced = ref(JSON.stringify(Object.fromEntries(Object.entries(config).filter(([key]) => !['command', 'args', 'url', 'cwd'].includes(key))), null, 2));
const env = ref<{ key: string; value: string }[]>([]);
const headers = ref<{ key: string; value: string }[]>([]);
const activeVariables = computed(() => transport.value === 'stdio' ? env.value : headers.value);
const validation = ref('');
const dialog = ref<HTMLElement>();
const nameInput = ref<HTMLInputElement>();
const titleId = `mcp-editor-${Math.random().toString(36).slice(2)}`;
const previousFocus = document.activeElement as HTMLElement | null;
onMounted(async () => { await nextTick(); (props.server ? dialog.value : nameInput.value)?.focus(); });
onBeforeUnmount(() => previousFocus?.focus());
function close() { if (!props.busy) emit('close'); }
function trapFocus(event: KeyboardEvent) {
  const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary') || [])].filter(el => !el.closest('details:not([open])') || el.tagName === 'SUMMARY');
  const first = elements[0]; const last = elements[elements.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first?.focus(); }
}
function submit() {
  if (props.busy) return;
  validation.value = '';
  let options: Record<string, unknown>;
  try {
    options = JSON.parse(advanced.value || '{}');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error();
  } catch { validation.value = t('mcp.invalidJson'); return; }
  if (['command', 'args', 'url', 'cwd', 'env', 'headers'].some(key => key in options)) { validation.value = t('mcp.reservedOptions'); return; }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(name.value) || (transport.value === 'stdio' && !command.value.trim())) { validation.value = t('mcp.requiredFields'); return; }
  if (transport.value === 'http') {
    try { const parsed = new URL(url.value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
    catch { validation.value = t('mcp.invalidUrl'); return; }
  }
  const result: Record<string, unknown> = { ...options, ...(transport.value === 'stdio' ? { command: command.value.trim(), args: args.value.split('\n').filter(arg => arg.length > 0), ...(cwd.value.trim() ? { cwd: cwd.value.trim() } : {}) } : { url: url.value.trim() }) };
  const rows = activeVariables.value.filter(row => row.key || row.value);
  if (rows.some(row => !row.key.trim()) || new Set(rows.map(row => row.key.trim())).size !== rows.length) { validation.value = t('mcp.invalidVariables'); return; }
  if (rows.length) result[transport.value === 'stdio' ? 'env' : 'headers'] = Object.fromEntries(rows.map(row => [row.key.trim(), row.value]));
  emit('save', name.value, result);
}
</script>

<style scoped>
.mcp-editor-backdrop { position: fixed; inset: 0; z-index: 2100; display: flex; align-items: center; justify-content: center; padding: 1rem; background: rgba(0, 0, 0, .58); backdrop-filter: blur(6px); }
.mcp-editor { width: min(580px, 100%); max-height: calc(100dvh - 2rem); display: flex; flex-direction: column; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-xl); overflow: hidden; color: var(--text-primary); }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.25rem; border-bottom: 1px solid var(--border-subtle); }
h3 { margin: 0; font-size: 1.05rem; }
header p { margin: .4rem 0 0; color: var(--text-secondary); font-size: .875rem; }
form { display: flex; flex-direction: column; min-height: 0; }
.editor-fields { display: grid; gap: 1rem; padding: 1.25rem; overflow-y: auto; }
label, .connection-field, .variables, .advanced-fields { display: grid; gap: .5rem; font-size: .875rem; }
input, textarea { box-sizing: border-box; width: 100%; padding: .65rem .75rem; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border); border-radius: var(--radius-md); }
textarea { resize: vertical; font-family: var(--font-mono, monospace); }
input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
small, .editor-hint, .variables p { color: var(--text-secondary); font-size: .8rem; line-height: 1.5; margin: 0; }
button { padding: .6rem .85rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; }
button:disabled, input:disabled { opacity: .5; cursor: default; }
.connection-options { display: flex; gap: .5rem; }
.connection-options button { flex: 1; }
.connection-options button[aria-pressed=true] { border-color: var(--accent); color: var(--accent); background: var(--accent-muted); }
.advanced { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
summary { padding: .75rem; cursor: pointer; font-size: .875rem; }
.advanced-fields { padding: 0 .75rem .75rem; gap: 1rem; }
.variable-row { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: .4rem; }
.variable-row input { min-width: 0; }
footer { display: flex; justify-content: flex-end; gap: .75rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border-subtle); }
.primary { background: var(--accent); color: var(--text-inverse, #fff); border-color: var(--accent); }
.editor-error { color: var(--error-color, #ef4444); margin: 0; font-size: .875rem; }
</style>
