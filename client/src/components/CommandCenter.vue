<template>
  <Teleport to="body">
    <div v-if="visible" class="command-center-backdrop" @mousedown.self="emit('close')">
      <div class="command-center" role="dialog" aria-modal="true" :aria-label="t('components.commandCenter.title')" @keydown="onKeydown">
        <input ref="input" v-model="query" :aria-label="t('components.commandCenter.title')" :placeholder="t('components.commandCenter.placeholder')" autocomplete="off" />
        <div class="command-center-results" role="listbox" :aria-label="t('components.commandCenter.title')">
          <template v-for="group in groups" :key="group.kind">
            <div v-if="group.items.length" class="command-center-heading">{{ t(`components.commandCenter.${group.kind}`) }}</div>
            <button v-for="item in group.items" :key="item.key" type="button" role="option"
              :aria-selected="selectedIndex === item.index" :class="{ selected: selectedIndex === item.index }"
              @mousemove="selectedIndex = item.index" @click="choose(item)">
              <span class="command-center-label">{{ item.label }}</span>
              <small v-if="item.detail">{{ item.detail }}</small>
            </button>
          </template>
          <div v-if="loading" class="command-center-message">{{ t('components.commandCenter.loading') }}</div>
          <div v-else-if="!itemCount" class="command-center-message">{{ t('components.commandCenter.noResults') }}</div>
        </div>
        <div class="command-center-footer">↑↓ {{ t('components.commandCenter.navigate') }} · Enter {{ t('components.commandCenter.open') }} · Esc {{ t('components.commandCenter.close') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { i18n } from '../i18n';

const t = i18n.global.t;
const props = defineProps<{ visible: boolean; clientId: string; projectPath: string }>();
const emit = defineEmits<{
  close: [];
  session: [session: { id: string; cwd?: string; path: string }];
  file: [path: string];
  action: [id: string];
}>();

type Item = { key: string; label: string; detail?: string; kind: 'actions' | 'sessions' | 'files'; value: string; index: number; cwd?: string; path?: string };
const input = ref<HTMLInputElement>();
const query = ref('');
const selectedIndex = ref(0);
const sessions = ref<Array<{ id: string; name?: string; firstMessage?: string; cwd?: string; path: string }>>([]);
const files = ref<string[]>([]);
const loading = ref(false);
let requestId = 0;

const actions = computed(() => [
  { id: 'new', label: t('app.newSession') },
  { id: 'terminal', label: t('app.terminal') },
  { id: 'editor', label: t('app.editor') },
  { id: 'sidebar', label: t('app.toggleSidebar') },
  { id: 'tasks', label: t('app.taskInbox') },
  { id: 'memory', label: t('app.memory') },
  { id: 'settings', label: t('app.settings') },
  { id: 'search', label: t('components.commandCenter.searchMessages') },
  { id: 'git', label: t('app.git') },
]);
const groups = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  const actionsOnly = text.startsWith('>');
  const search = (actionsOnly ? text.slice(1) : text).trim();
  let index = 0;
  const sessionItems: Item[] = actionsOnly ? [] : sessions.value
    .filter(s => `${s.name || s.firstMessage || ''} ${s.cwd || ''}`.toLocaleLowerCase().includes(search))
    .slice(0, 10).map(s => ({ key: `session:${s.id}`, label: s.name || s.firstMessage || t('components.sessionSidebar.newSession'), detail: s.cwd, kind: 'sessions', value: s.id, index: index++, cwd: s.cwd, path: s.path }));
  const actionItems: Item[] = actions.value.filter(a => a.label.toLocaleLowerCase().includes(search))
    .map(a => ({ key: `action:${a.id}`, label: a.label, kind: 'actions', value: a.id, index: index++ }));
  const fileItems: Item[] = actionsOnly || !search ? [] : files.value
    .filter(path => path.toLocaleLowerCase().includes(search)).slice(0, 20)
    .map(path => ({ key: `file:${path}`, label: path.split('/').pop() || path, detail: path, kind: 'files', value: path, index: index++ }));
  return [{ kind: 'sessions', items: sessionItems }, { kind: 'actions', items: actionItems }, { kind: 'files', items: fileItems }] as const;
});
const itemCount = computed(() => groups.value.reduce((count, group) => count + group.items.length, 0));

watch(() => props.visible, async visible => {
  ++requestId;
  if (!visible) return;
  query.value = '';
  selectedIndex.value = 0;
  sessions.value = [];
  files.value = [];
  loading.value = false;
  await nextTick();
  if (!props.visible) return;
  input.value?.focus();
  void loadResults();
}, { immediate: true });
watch(() => props.projectPath, () => { if (props.visible) void loadResults(); });
watch(query, () => { selectedIndex.value = 0; });
watch(itemCount, count => { if (selectedIndex.value >= count) selectedIndex.value = Math.max(0, count - 1); });

async function loadResults() {
  const id = ++requestId;
  loading.value = true;
  sessions.value = [];
  files.value = [];
  try {
    const params = new URLSearchParams({ clientId: props.clientId, scope: 'all', limit: '50' });
    const root = props.projectPath && props.projectPath !== '~' ? props.projectPath : '.';
    const [sessionResponse, fileResponse] = await Promise.all([
      fetch(`/api/sessions?${params}`),
      fetch(`/api/files/search?pattern=**/*&path=${encodeURIComponent(root)}`),
    ]);
    const sessionData = sessionResponse.ok ? await sessionResponse.json() as { sessions: typeof sessions.value } : { sessions: [] };
    const fileData = fileResponse.ok ? await fileResponse.json() as { files: string[] } : { files: [] };
    if (id !== requestId || !props.visible) return;
    sessions.value = sessionData.sessions || [];
    files.value = fileData.files || [];
  } catch {
    // Leave available actions visible if a search request fails.
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function choose(item: Item) {
  if (item.kind === 'sessions') emit('session', { id: item.value, cwd: item.cwd, path: item.path || '' });
  else if (item.kind === 'files') emit('file', item.value);
  else emit('action', item.value);
  emit('close');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault();
    input.value?.focus();
  } else if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (itemCount.value) selectedIndex.value = (selectedIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + itemCount.value) % itemCount.value;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = groups.value.flatMap(group => group.items)[selectedIndex.value];
    if (item) choose(item);
  }
}
</script>

<style scoped>
.command-center-backdrop { position: fixed; inset: 0; z-index: 2100; background: rgba(0, 0, 0, .55); display: flex; justify-content: center; align-items: flex-start; padding: min(15vh, 110px) 12px 12px; }
.command-center { width: min(100%, 620px); background: var(--bg-secondary, #24242a); color: var(--text-primary, #fff); border: 1px solid var(--border, #555); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .35); overflow: hidden; }
.command-center input { box-sizing: border-box; width: 100%; padding: 16px; background: transparent; border: 0; border-bottom: 1px solid var(--border, #555); color: inherit; font: inherit; outline: none; }
.command-center-results { max-height: min(55vh, 450px); overflow: auto; padding: 8px; }
.command-center-heading { padding: 8px 10px 4px; opacity: .65; font-size: 12px; }
.command-center-results button { display: flex; width: 100%; gap: 12px; padding: 9px 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; cursor: pointer; align-items: center; }
.command-center-results button.selected { background: var(--bg-hover, #444); }
.command-center-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.command-center-results small { opacity: .6; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-center-message, .command-center-footer { padding: 10px 16px; opacity: .65; font-size: 12px; }
.command-center-footer { border-top: 1px solid var(--border, #555); }
</style>
