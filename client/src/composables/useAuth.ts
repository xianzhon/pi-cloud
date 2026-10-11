import { computed, ref } from 'vue';
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { apiRequest, getApiErrorMessage, onSessionExpired } from '../services/apiClient';

export interface AuthUser {
  username: string;
  totpEnabled: boolean;
}

const user = ref<AuthUser | null>(null);
const loading = ref(false);
const passkeysEnabled = ref(false);
const passkeyBusy = ref(false);
const requires2fa = ref(false);
const loginError = ref<string | null>(null);
const sessionExpiresAt = ref<string | null>(null);
const stagedCredentials = ref<{ username: string; password: string } | null>(null);

interface AuthStatusResponse {
  authenticated: boolean;
  user: AuthUser | null;
  sessionExpiresAt?: string | null;
  passkeysEnabled?: boolean;
}

interface LoginRequest {
  username: string;
  password: string;
  totpCode?: string;
}

interface LoginResponse extends AuthStatusResponse {
  requires2fa: boolean;
}

function clearSession(): void {
  user.value = null;
  sessionExpiresAt.value = null;
  requires2fa.value = false;
  stagedCredentials.value = null;
}

onSessionExpired(clearSession);

async function refresh() {
  loading.value = true;
  try {
    const data = await apiRequest<AuthStatusResponse>('/api/auth/me');
    passkeysEnabled.value = Boolean(data.passkeysEnabled);
    user.value = data.authenticated ? data.user : null;
    sessionExpiresAt.value = data.authenticated ? data.sessionExpiresAt || null : null;
    requires2fa.value = false;
  } finally {
    loading.value = false;
  }
}

async function login(username: string, password: string, totpCode?: string) {
  loginError.value = null;
  let data: LoginResponse;
  try {
    data = await apiRequest<LoginResponse, LoginRequest>('/api/auth/login', {
      method: 'POST',
      body: { username, password, totpCode },
      handleUnauthorized: false,
    });
  } catch (error) {
    loginError.value = getApiErrorMessage(error, 'Login failed');
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

async function loginWithPasskey() {
  if (passkeyBusy.value) return false;
  passkeyBusy.value = true;
  loginError.value = null;
  try {
    const optionsJSON = await apiRequest<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkeys/login/options', {
      method: 'POST', handleUnauthorized: false,
    });
    const response = await startAuthentication({ optionsJSON });
    const data = await apiRequest<LoginResponse, { response: typeof response }>('/api/auth/passkeys/login/verify', {
      method: 'POST', body: { response }, handleUnauthorized: false,
    });
    user.value = data.user;
    sessionExpiresAt.value = data.sessionExpiresAt || null;
    requires2fa.value = false;
    stagedCredentials.value = null;
    return true;
  } catch (error) {
    loginError.value = getApiErrorMessage(error, 'Passkey login failed');
    return false;
  } finally {
    passkeyBusy.value = false;
  }
}

async function submitTotp(code: string) {
  if (!stagedCredentials.value) return false;
  return login(stagedCredentials.value.username, stagedCredentials.value.password, code);
}

async function logout() {
  await apiRequest<void>('/api/auth/logout', { method: 'POST' });
  clearSession();
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
    loginWithPasskey,
    passkeysEnabled,
    passkeyBusy,
    submitTotp,
    logout,
  };
}

export function resetAuthForTests() {
  clearSession();
  loading.value = false;
  passkeysEnabled.value = false;
  passkeyBusy.value = false;
  loginError.value = null;
}
