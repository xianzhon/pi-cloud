<template>
  <section class="security-panel" :class="{ embedded }">
    <header v-if="!embedded" class="security-header">
      <h2>{{ t('components.securityPanel.security') }}</h2>
      <button @click="$emit('close')">{{ t('components.securityPanel.close') }}</button>
    </header>

    <section class="security-card two-factor-card">
      <div class="security-card-header">
        <div>
          <h3>{{ t('components.securityPanel.twoFactorAuthentication') }}</h3>
          <p class="security-status">{{ t('components.securityPanel.status') }} <strong>{{ totpEnabled ? t('components.securityPanel.enabled') : t('components.securityPanel.disabled') }}</strong></p>
        </div>
        <button v-if="!totpEnabled && !setup" class="start-2fa dialog-action primary-action" @click="startSetup">{{ t('components.securityPanel.enable2FA') }}</button>
        <button v-if="totpEnabled" class="disable-2fa dialog-action compact-action danger-action" @click="disable2fa">{{ t('components.securityPanel.disable2FA') }}</button>
      </div>

      <div v-if="setup" class="totp-setup">
        <img :src="setup.qrCodeDataUrl" :alt="t('components.securityPanel.totpQrCode')" />
        <p>{{ t('components.securityPanel.manualKey') }} <code>{{ setup.secret }}</code></p>
        <input v-model="verificationCode" name="verificationCode" :placeholder="t('components.securityPanel.verificationCode')" />
        <button class="verify-2fa dialog-action primary-action" @click="enable2fa">{{ t('components.securityPanel.verifyAndEnable') }}</button>
      </div>
    </section>

    <section class="security-card">
      <div class="audit-header">
        <h3>{{ t('components.securityPanel.auditLog') }}</h3>
        <button class="clear-audit" type="button" :disabled="!events.length" @click="showClearAuditConfirm = true">{{ t('components.securityPanel.clearLog') }}</button>
      </div>
      <div class="audit-table-wrap">
        <table class="audit-table">
          <thead><tr><th>{{ t('components.securityPanel.time') }}</th><th>{{ t('components.securityPanel.event') }}</th><th>{{ t('components.securityPanel.status2') }}</th><th>{{ t('components.securityPanel.ip') }}</th></tr></thead>
          <tbody>
            <tr v-if="!paginatedEvents.length">
              <td colspan="4" class="audit-empty">
                <span class="audit-empty-title">{{ t('components.securityPanel.noAuditEventsYet') }}</span>
                <span>{{ t('components.securityPanel.securityActivityWillAppearHereAsIt') }}</span>
              </td>
            </tr>
            <tr v-for="event in paginatedEvents" :key="event.id">
              <td>{{ formatAuditTime(event.createdAt) }}</td>
              <td>
                <div class="audit-event-cell">
                  <span>{{ formatAuditType(event.type) }}</span>
                  <span v-if="event.count > 1" class="audit-count">×{{ event.count }}</span>
                </div>
              </td>
              <td><span class="audit-status" :class="[`audit-status-${event.status}`, event.status]">{{ formatAuditStatus(event.status) }}</span></td>
              <td>{{ event.ip || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="events.length" class="audit-pagination">
        <span class="audit-range">{{ t('components.securityPanel.showingGroups', { start: pageStart, end: pageEnd, total: groupedEvents.length }) }}</span>
        <div class="audit-page-actions">
          <button class="dialog-action compact-action audit-prev" :disabled="auditPage === 1" @click="auditPage -= 1">{{ t('components.securityPanel.previous') }}</button>
          <span class="audit-page-indicator">{{ t('components.securityPanel.pageOf', { page: auditPage, total: totalAuditPages }) }}</span>
          <button class="dialog-action compact-action audit-next" :disabled="auditPage === totalAuditPages" @click="auditPage += 1">{{ t('components.securityPanel.next') }}</button>
        </div>
      </footer>
    </section>

    <ConfirmModal
      :visible="showClearAuditConfirm"
      :confirm-text="t('components.securityPanel.clearLog')"
      variant="danger"
      @confirm="clearAudit"
      @cancel="showClearAuditConfirm = false"
    >
      <template #title>{{ t('components.securityPanel.clearAuditLog') }}</template>
      <template #message>{{ t('components.securityPanel.thisPermanentlyDeletesAllAuditEvents') }}</template>
    </ConfirmModal>
  </section>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, onMounted, ref } from 'vue';
import ConfirmModal from './ConfirmModal.vue';

const t = i18n.global.t;

withDefaults(defineProps<{
  totpEnabled: boolean;
  embedded?: boolean;
}>(), {
  embedded: false,
});
const emit = defineEmits<{ close: []; updated: [] }>();

const setup = ref<{ secret: string; qrCodeDataUrl: string; otpauthUrl: string } | null>(null);
const verificationCode = ref('');
const events = ref<any[]>([]);
const auditPage = ref(1);
const showClearAuditConfirm = ref(false);
// Keep the security panel compact enough to show pagination without a second vertical scroll area.
const AUDIT_PAGE_SIZE = 7;

type AuditRow = {
  id: number;
  createdAt: string;
  type: string;
  status: 'success' | 'failure' | 'info';
  ip?: string;
  count: number;
  groupKey: string;
};

function getAuditGroupKey(event: any): string {
  return `${event.type}|${event.status}|${event.username || ''}|${event.ip || ''}|${event.metadata?.path || ''}|${event.metadata?.method || ''}|${event.metadata?.reason || ''}`;
}

// Only collapse adjacent events so separate bursts remain visible in their original order.
const groupedEvents = computed<AuditRow[]>(() => {
  const rows: AuditRow[] = [];
  for (const event of events.value) {
    const previous = rows[rows.length - 1];
    const groupKey = getAuditGroupKey(event);
    if (previous?.groupKey === groupKey) {
      previous.count += 1;
      continue;
    }
    rows.push({ ...event, count: 1, groupKey });
  }
  return rows;
});

const totalAuditPages = computed(() => Math.max(1, Math.ceil(groupedEvents.value.length / AUDIT_PAGE_SIZE)));
const pageStart = computed(() => groupedEvents.value.length === 0 ? 0 : (auditPage.value - 1) * AUDIT_PAGE_SIZE + 1);
const pageEnd = computed(() => Math.min(auditPage.value * AUDIT_PAGE_SIZE, groupedEvents.value.length));
const paginatedEvents = computed(() => groupedEvents.value.slice(pageStart.value - 1, pageEnd.value));

function formatAuditTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

const auditTypeLabels: Record<string, string> = {
  login_success: t('components.securityPanel.login'),
  login_failure: t('components.securityPanel.loginAttempt'),
  logout: t('components.securityPanel.logout'),
  totp_success: t('components.securityPanel.twoFactorAuthentication'),
  totp_failure: t('components.securityPanel.twoFactorAuthentication'),
  websocket_auth_failure: t('components.securityPanel.websocketAuthentication'),
  unauthorized_http: t('components.securityPanel.unauthorizedRequest'),
};

function formatAuditType(type: string): string {
  const label = auditTypeLabels[type];
  if (label) return label;
  return type.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAuditStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function loadAudit() {
  const response = await fetch('/api/auth/audit');
  events.value = (await response.json()).events || [];
  auditPage.value = 1;
}

async function clearAudit(): Promise<void> {
  await fetch('/api/auth/audit', { method: 'DELETE' });
  showClearAuditConfirm.value = false;
  await loadAudit();
}

async function startSetup() {
  const response = await fetch('/api/auth/2fa/setup', { method: 'POST' });
  setup.value = await response.json();
}

async function enable2fa() {
  if (!setup.value) return;
  await fetch('/api/auth/2fa/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: setup.value.secret, code: verificationCode.value }),
  });
  setup.value = null;
  emit('updated');
  await loadAudit();
}

async function disable2fa() {
  await fetch('/api/auth/2fa/disable', { method: 'POST' });
  emit('updated');
  await loadAudit();
}

onMounted(loadAudit);
</script>

<style scoped>
.security-panel {
  padding: 1rem;
  overflow: auto;
  height: 100%;
}
.security-panel.embedded {
  padding: 0;
}
.security-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.security-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.security-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.security-card h3 {
  margin: 0 0 0.25rem;
}
.audit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.audit-header h3 {
  margin-bottom: 0;
}
.clear-audit {
  border: 1px solid var(--error);
  border-radius: var(--radius-md);
  padding: 0.4rem 0.75rem;
  color: var(--error);
  font-size: 0.75rem;
  font-weight: 700;
}
.clear-audit:hover:not(:disabled) {
  color: white;
  background: var(--error);
}
.clear-audit:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.security-status {
  margin: 0;
  color: var(--text-secondary);
}
.security-status strong {
  color: var(--text-primary);
}
.primary-action,
.danger-action {
  border: none;
  color: white;
  font-weight: 600;
}
.primary-action {
  background: var(--accent);
}
.primary-action:hover {
  background: var(--accent-hover);
}
.danger-action {
  background: var(--error);
}
.danger-action:hover {
  filter: brightness(0.92);
}
.totp-setup {
  display: grid;
  gap: 0.75rem;
  max-width: 360px;
  margin-top: 1rem;
}
.totp-setup img {
  width: 180px;
  height: 180px;
  background: white;
  padding: 0.5rem;
  border-radius: 8px;
}
@media (max-width: 640px) {
  .security-card-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
.audit-table-wrap {
  overflow-x: auto;
}
.audit-table {
  width: 100%;
  min-width: 600px;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.audit-table th,
.audit-table td {
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 0.5rem;
  text-align: left;
}
.audit-table th {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.audit-table tbody tr:last-child td {
  border-bottom: 0;
}
.audit-empty {
  height: 8rem;
  color: var(--text-secondary);
  text-align: center !important;
}
.audit-empty-title {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--text-primary);
  font-weight: 650;
}
.audit-event-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.audit-count {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
}
.audit-status {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-full);
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 700;
}
.audit-status.success {
  color: var(--success);
  background: var(--success-muted);
}
.audit-status.failure {
  color: var(--error);
  background: var(--error-muted);
}
.audit-status.info {
  color: var(--accent);
  background: var(--accent-muted);
}
.audit-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-top: 0.875rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}
.audit-page-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.audit-page-indicator {
  color: var(--text-primary);
  font-weight: 650;
  white-space: nowrap;
}
.audit-page-actions button {
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
}
.audit-page-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
@media (max-width: 640px) {
  .audit-pagination {
    align-items: stretch;
    flex-direction: column-reverse;
    gap: 0.75rem;
  }
  .audit-range {
    text-align: center;
  }
  .audit-page-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 0.5rem;
    width: 100%;
  }
  .audit-page-actions button {
    justify-content: center;
    min-width: 0;
    padding-inline: 0.625rem;
  }
  .audit-page-indicator {
    align-self: center;
    padding: 0 0.25rem;
  }
}
</style>
