<template>
  <section class="tokens-card">
    <header>
      <div><h3>{{ t('apiTokens.title') }}</h3><p>{{ t('apiTokens.help') }}</p></div>
      <button type="button" class="dialog-action primary" :disabled="busy" @click="open()">{{ t('apiTokens.create') }}</button>
    </header>
    <p v-if="!tokens.length">{{ t('apiTokens.empty') }}</p>
    <div v-for="token in tokens" :key="token.id" class="token-row">
      <div>
        <strong>{{ token.name }}</strong> <code>{{ token.prefix }}…</code>
        <small>{{ t('apiTokens.expires') }}: {{ new Date(token.expiresAt).toLocaleString() }}</small>
        <small>{{ t('apiTokens.lastUsed') }}: {{ token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : t('apiTokens.never') }}</small>
      </div>
      <button type="button" class="dialog-action danger" :disabled="busy" @click="open(token)">{{ t('apiTokens.revoke') }}</button>
    </div>
    <div v-if="newToken" class="token-secret">
      <p>{{ t('apiTokens.shownOnce') }}</p>
      <textarea :value="newToken" readonly :aria-label="t('apiTokens.title')" @focus="($event.target as HTMLTextAreaElement).select()" />
      <button type="button" class="dialog-action" @click="copy">{{ t('apiTokens.copy') }}</button>
      <button type="button" class="dialog-action" @click="newToken = ''">{{ t('apiTokens.dismiss') }}</button>
    </div>
    <ConfirmModal :visible="dialogOpen" :variant="target ? 'danger' : 'primary'" :confirm-text="confirmText" @confirm="confirm" @cancel="close">
      <template #title>{{ t(target ? 'apiTokens.revoke' : 'apiTokens.create') }}</template>
      <template #message>
        <div class="token-form">
          <p>{{ target ? t('apiTokens.revokeConfirm', { name: target.name }) : t('apiTokens.confirmHelp') }}</p>
          <template v-if="!target">
            <label>{{ t('apiTokens.name') }}<input v-model="name" maxlength="80" :disabled="busy" /></label>
            <label>{{ t('apiTokens.expires') }}<input v-model="expiresAt" type="datetime-local" :disabled="busy" /></label>
          </template>
          <label>{{ t('components.securityPanel.password') }}<input v-model="password" type="password" autocomplete="current-password" :disabled="busy" /></label>
          <label v-if="totpEnabled">{{ t('components.securityPanel.currentVerificationCode') }}<input v-model="code" inputmode="numeric" autocomplete="one-time-code" :disabled="busy" /></label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
      </template>
    </ConfirmModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { i18n } from '../i18n';
import { useToasts } from '../composables/useToasts';
import { apiRequest, getApiErrorMessage } from '../services/apiClient';
import ConfirmModal from './ConfirmModal.vue';

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string;
  lastUsedAt: string | null;
}
defineProps<{ totpEnabled: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const t = i18n.global.t;
const { showToast } = useToasts();
const tokens = ref<ApiToken[]>([]);
const busy = ref(false);
const dialogOpen = ref(false);
const target = ref<ApiToken | null>(null);
const name = ref('');
const expiresAt = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
const newToken = ref('');
let disposed = false;

const confirmText = computed(() => {
  if (busy.value) return t('apiTokens.working');
  return t(target.value ? 'apiTokens.revoke' : 'apiTokens.create');
});

async function load(): Promise<void> {
  const data = await apiRequest<{ tokens: ApiToken[] }>('/api/auth/tokens');
  if (!disposed) tokens.value = data.tokens;
}
function open(token?: ApiToken): void {
  target.value = token || null;
  name.value = '';
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  expiresAt.value = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
  password.value = '';
  code.value = '';
  error.value = '';
  dialogOpen.value = true;
}
function close(): void {
  if (busy.value) return;
  dialogOpen.value = false;
  password.value = '';
  code.value = '';
  error.value = '';
}
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(newToken.value);
    showToast(t('apiTokens.copied'), 'success');
  } catch {
    showToast(t('apiTokens.copyFailed'), 'error');
  }
}
async function confirm(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const credentials = { password: password.value, totpCode: code.value };
    if (target.value) {
      await apiRequest(`/api/auth/tokens/${encodeURIComponent(target.value.id)}`, {
        method: 'DELETE',
        body: credentials,
        handleUnauthorized: false,
      });
    } else {
      const tokenName = name.value.trim();
      const date = new Date(expiresAt.value);
      const expiration = date.getTime();
      if (!tokenName || !Number.isFinite(expiration) || expiration <= Date.now()) {
        throw new Error(t('apiTokens.invalidInput'));
      }
      const result = await apiRequest<{ token: string }, typeof credentials & { name: string; expiresAt: string }>('/api/auth/tokens', {
        method: 'POST',
        body: { ...credentials, name: tokenName, expiresAt: date.toISOString() },
        handleUnauthorized: false,
      });
      if (!disposed) newToken.value = result.token;
    }
    if (disposed) return;
    showToast(t(target.value ? 'apiTokens.revoked' : 'apiTokens.created'), 'success');
    password.value = '';
    code.value = '';
    dialogOpen.value = false;
    emit('updated');
    await load();
  } catch (cause) {
    if (!disposed) {
      error.value = getApiErrorMessage(cause, t('apiTokens.failed'));
      showToast(error.value, 'error');
    }
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    await load();
  } catch (cause) {
    if (!disposed) showToast(getApiErrorMessage(cause, t('apiTokens.failed')), 'error');
  }
});
onBeforeUnmount(() => {
  disposed = true;
  password.value = '';
  code.value = '';
  newToken.value = '';
});
</script>

<style scoped>
.tokens-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; margin-bottom: 1rem; }
.tokens-card header, .token-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.tokens-card h3 { margin: 0 0 0.25rem; }
.tokens-card p, .token-row small { color: var(--text-secondary); font-size: 0.875rem; }
.tokens-card header p { margin: 0; }
.token-row { padding-top: 1rem; }
.token-row strong { overflow-wrap: anywhere; }
.token-row small { display: block; margin-top: 0.25rem; }
.token-secret { margin-top: 1rem; }
.token-secret textarea { width: 100%; box-sizing: border-box; font-family: monospace; }
.token-form, .token-form label { display: grid; gap: 0.75rem; }
.primary { background: var(--accent); color: white; }
.danger { color: var(--error); border: 1px solid var(--error); }
.error { color: var(--error); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 640px) { .tokens-card header { flex-direction: column; align-items: flex-start; } }
</style>
