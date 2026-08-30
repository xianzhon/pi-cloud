<template>
  <div class="login-shell">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-brand">
        <span class="login-logo" aria-hidden="true">
          <img src="/icon.svg" alt="" />
        </span>
        <div>
          <h1>Pi Cloud</h1>
          <p class="login-subtitle">{{ t('components.loginView.signInToContinue') }}</p>
        </div>
      </div>

      <template v-if="!requires2fa">
        <label>
          {{ t('components.loginView.username') }}
          <input name="username" v-model="username" autocomplete="username" required autofocus />
        </label>
        <label>
          {{ t('components.loginView.password') }}
          <input name="password" v-model="password" type="password" autocomplete="current-password" required />
        </label>
      </template>

      <template v-else>
        <label>
          {{ t('components.loginView.authenticatorCode') }}
          <input name="totpCode" v-model="totpCode" inputmode="numeric" autocomplete="one-time-code" required autofocus />
        </label>
      </template>

      <p v-if="loginError" class="login-error">{{ loginError }}</p>
      <button class="login-submit" type="submit">{{ requires2fa ? t('components.loginView.verify') : t('components.loginView.signIn') }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { ref } from 'vue';
import { useAuth } from '../composables/useAuth';

const t = i18n.global.t;

const { login, submitTotp, requires2fa, loginError } = useAuth();
const username = ref('');
const password = ref('');
const totpCode = ref('');

async function submit() {
  if (requires2fa.value) {
    await submitTotp(totpCode.value);
    return;
  }
  await login(username.value, password.value);
}
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  width: 100vw;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: var(--login-shell-bg);
}

.login-card {
  width: min(380px, calc(100vw - 2rem));
  padding: 2rem;
  border: 1px solid var(--login-card-border);
  border-radius: 22px;
  background: var(--login-card-bg);
  box-shadow: var(--login-card-shadow);
  backdrop-filter: blur(18px);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.login-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 0.25rem;
  text-align: center;
}

.login-logo {
  position: relative;
  width: 64px;
  height: 64px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(108, 140, 255, 0.22), rgba(74, 222, 128, 0.1));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1),
              0 14px 34px rgba(0, 0, 0, 0.36);
}

.login-logo::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 28px;
  background: radial-gradient(circle at 35% 25%, rgba(108, 140, 255, 0.32), transparent 62%);
  z-index: -1;
}

.login-logo img {
  width: 52px;
  height: 52px;
  display: block;
  border-radius: 16px;
}

.login-card h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.login-subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

.login-card label {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.login-card input {
  min-height: 42px;
  background: var(--login-input-bg);
  border-color: var(--login-card-border);
}

.login-card input:hover {
  border-color: rgba(139, 164, 255, 0.42);
}

.login-error {
  padding: 0.625rem 0.75rem;
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: var(--radius-md);
  background: var(--error-muted);
  color: var(--login-error-text);
  font-size: 0.875rem;
  text-align: center;
}

.login-submit {
  min-height: 44px;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent), #4f7cff);
  color: white;
  font-weight: 600;
  font-size: 0.9375rem;
  box-shadow: 0 10px 24px rgba(108, 140, 255, 0.22);
  transition: transform var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.login-submit:hover {
  background: linear-gradient(135deg, var(--accent-hover), #6c8cff);
  box-shadow: 0 14px 30px rgba(108, 140, 255, 0.3);
}

.login-submit:active {
  transform: scale(0.98);
}
</style>
