<template>
  <section class="passkey-card">
    <header>
      <div><h3>{{ t('passkeys.title') }}</h3><p>{{ t('passkeys.help') }}</p></div>
      <button v-if="passkeysEnabled" type="button" class="dialog-action primary" :disabled="busy || !supported" @click="open()">{{ t('passkeys.add') }}</button>
    </header>
    <p v-if="!passkeysEnabled">{{ t('passkeys.configure') }}</p>
    <template v-else>
      <p v-if="!supported">{{ t('passkeys.unsupported') }}</p>
      <p v-if="!keys.length">{{ t('passkeys.empty') }}</p>
      <div v-for="key in keys" :key="key.id" class="passkey-row">
        <div><strong>{{ key.name }}</strong><small>{{ t('passkeys.created') }}: {{ new Date(key.createdAt).toLocaleString() }}</small><small>{{ t('passkeys.lastUsed') }}: {{ key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : t('passkeys.never') }}</small></div>
        <button type="button" class="dialog-action danger" :disabled="busy" @click="open(key)">{{ t('passkeys.delete') }}</button>
      </div>
    </template>
    <ConfirmModal :visible="dialogOpen" :variant="target ? 'danger' : 'primary'" :confirm-text="t(busy ? 'passkeys.working' : target ? 'passkeys.delete' : 'passkeys.add')" @confirm="confirm" @cancel="close">
      <template #title>{{ t(target ? 'passkeys.delete' : 'passkeys.add') }}</template>
      <template #message>
        <div class="passkey-form">
          <p>{{ target ? t('passkeys.deleteConfirm', { name: target.name }) : t('passkeys.confirmHelp') }}</p>
          <label v-if="!target">{{ t('passkeys.name') }}<input v-model="name" maxlength="80" :disabled="busy" /></label>
          <label>{{ t('components.securityPanel.password') }}<input v-model="password" type="password" autocomplete="current-password" :disabled="busy" /></label>
          <label v-if="totpEnabled">{{ t('components.securityPanel.currentVerificationCode') }}<input v-model="code" inputmode="numeric" autocomplete="one-time-code" :disabled="busy" /></label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
      </template>
    </ConfirmModal>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { browserSupportsWebAuthn, startRegistration, WebAuthnAbortService, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { i18n } from '../i18n';
import { useAuth } from '../composables/useAuth';
import { useToasts } from '../composables/useToasts';
import { apiRequest, getApiErrorMessage } from '../services/apiClient';
import ConfirmModal from './ConfirmModal.vue';

interface Passkey { id: string; name: string; createdAt: string; lastUsedAt: string | null }
defineProps<{ totpEnabled: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const t = i18n.global.t;
const { passkeysEnabled } = useAuth();
const { showToast } = useToasts();
const supported = browserSupportsWebAuthn();
const keys = ref<Passkey[]>([]);
const busy = ref(false);
const dialogOpen = ref(false);
const target = ref<Passkey | null>(null);
const name = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
let disposed = false;

async function load() {
  const data = await apiRequest<{ passkeys: Passkey[] }>('/api/auth/passkeys');
  if (!disposed) keys.value = data.passkeys;
}
function open(key?: Passkey) {
  target.value = key || null;
  name.value = '';
  password.value = '';
  code.value = '';
  error.value = '';
  dialogOpen.value = true;
}
function close() {
  if (busy.value) return;
  dialogOpen.value = false;
  password.value = '';
  code.value = '';
  error.value = '';
}
async function confirm() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const deleting = Boolean(target.value);
  try {
    const body = { password: password.value, totpCode: code.value, name: name.value };
    if (target.value) {
      await apiRequest(`/api/auth/passkeys/${encodeURIComponent(target.value.id)}`, {
        method: 'DELETE', body, handleUnauthorized: false,
      });
    } else {
      const optionsJSON = await apiRequest<PublicKeyCredentialCreationOptionsJSON, typeof body>('/api/auth/passkeys/register/options', {
        method: 'POST', body, handleUnauthorized: false,
      });
      if (disposed) return;
      const response = await startRegistration({ optionsJSON });
      if (disposed) return;
      await apiRequest('/api/auth/passkeys/register/verify', { method: 'POST', body: { response } });
    }
    if (disposed) return;
    password.value = '';
    code.value = '';
    dialogOpen.value = false;
    showToast(t(deleting ? 'passkeys.deleted' : 'passkeys.added'), 'success');
    emit('updated');
    await load();
  } catch (cause) {
    if (!disposed) {
      error.value = getApiErrorMessage(cause, t('passkeys.failed'));
      showToast(error.value, 'error');
    }
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  if (!passkeysEnabled.value) return;
  try { await load(); }
  catch (cause) { if (!disposed) showToast(getApiErrorMessage(cause, t('passkeys.failed')), 'error'); }
});
onBeforeUnmount(() => {
  disposed = true;
  if (busy.value) WebAuthnAbortService.cancelCeremony();
  password.value = '';
  code.value = '';
});
</script>

<style scoped>
.passkey-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; margin-bottom: 1rem; }
.passkey-card header, .passkey-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.passkey-card h3 { margin: 0 0 0.25rem; }
.passkey-card p, .passkey-row small { color: var(--text-secondary); font-size: 0.875rem; }
.passkey-card header p { margin: 0; }
.passkey-row { padding-top: 1rem; }
.passkey-row strong { overflow-wrap: anywhere; }
.passkey-row small { display: block; margin-top: 0.25rem; }
.passkey-form, .passkey-form label { display: grid; gap: 0.75rem; }
.primary { background: var(--accent); color: white; }
.danger { color: var(--error); border: 1px solid var(--error); }
.error { color: var(--error); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 640px) { .passkey-card header { flex-direction: column; align-items: flex-start; } }
</style>
