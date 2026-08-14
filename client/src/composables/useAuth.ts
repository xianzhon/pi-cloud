import { computed, ref } from 'vue';

interface AuthUser {
  username: string;
  totpEnabled: boolean;
}

const user = ref<AuthUser | null>(null);
const loading = ref(false);
const requires2fa = ref(false);
const loginError = ref<string | null>(null);
const sessionExpiresAt = ref<string | null>(null);
const stagedCredentials = ref<{ username: string; password: string } | null>(null);

async function refresh() {
  loading.value = true;
  try {
    const response = await fetch('/api/auth/me');
    const data = await response.json();
    user.value = response.ok && data.authenticated ? data.user : null;
    sessionExpiresAt.value = response.ok && data.authenticated ? data.sessionExpiresAt || null : null;
    requires2fa.value = false;
  } finally {
    loading.value = false;
  }
}

async function login(username: string, password: string, totpCode?: string) {
  loginError.value = null;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, totpCode }),
  });
  const data = await response.json();

  if (!response.ok) {
    loginError.value = data.error || 'Login failed';
    return false;
  }

  if (data.requires2fa) {
    stagedCredentials.value = { username, password };
    requires2fa.value = true;
    return false;
  }

  user.value = data.user;
  sessionExpiresAt.value = data.sessionExpiresAt || null;
  requires2fa.value = false;
  stagedCredentials.value = null;
  return true;
}

async function submitTotp(code: string) {
  if (!stagedCredentials.value) return false;
  return login(stagedCredentials.value.username, stagedCredentials.value.password, code);
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  user.value = null;
  sessionExpiresAt.value = null;
  requires2fa.value = false;
  stagedCredentials.value = null;
}

export function useAuth() {
  return {
    user,
    loading,
    requires2fa,
    loginError,
    sessionExpiresAt,
    isAuthenticated: computed(() => Boolean(user.value)),
    refresh,
    login,
    submitTotp,
    logout,
  };
}

export function resetAuthForTests() {
  user.value = null;
  loading.value = false;
  requires2fa.value = false;
  loginError.value = null;
  sessionExpiresAt.value = null;
  stagedCredentials.value = null;
}
