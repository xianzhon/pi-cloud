import { createClientId } from './id';

const CLIENT_ID_KEY = 'pi-webui-client-id';
const OWNER_KEY_PREFIX = 'pi-webui-client-owner:';
const OWNER_TTL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 2_000;

interface ClientIdOwner {
  token: string;
  updatedAt: number;
}

let clientId: string | null = null;
let heartbeatTimer: number | null = null;
const ownerToken = createClientId();

function getStorageItem(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function setStorageItem(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignore storage failures (private browsing, disabled storage, etc.).
  }
}

function removeStorageItem(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore storage failures (private browsing, disabled storage, etc.).
  }
}

function ownerKey(id: string): string {
  return `${OWNER_KEY_PREFIX}${id}`;
}

function readOwner(id: string): ClientIdOwner | null {
  const raw = getStorageItem(globalThis.localStorage, ownerKey(id));
  if (!raw) return null;

  try {
    const owner = JSON.parse(raw) as Partial<ClientIdOwner>;
    if (typeof owner.token !== 'string' || typeof owner.updatedAt !== 'number') return null;
    return { token: owner.token, updatedAt: owner.updatedAt };
  } catch {
    return null;
  }
}

function isLiveOwner(owner: ClientIdOwner | null): boolean {
  return Boolean(owner && owner.token !== ownerToken && Date.now() - owner.updatedAt < OWNER_TTL_MS);
}

function writeOwner(id: string): void {
  setStorageItem(globalThis.localStorage, ownerKey(id), JSON.stringify({
    token: ownerToken,
    updatedAt: Date.now(),
  }));
}

function removeOwner(id: string): void {
  const owner = readOwner(id);
  if (owner?.token === ownerToken) {
    removeStorageItem(globalThis.localStorage, ownerKey(id));
  }
}

function initializeClientId(): string {
  let id = getStorageItem(globalThis.sessionStorage, CLIENT_ID_KEY) || createClientId();

  if (isLiveOwner(readOwner(id))) {
    id = createClientId();
  }

  setStorageItem(globalThis.sessionStorage, CLIENT_ID_KEY, id);
  writeOwner(id);
  return id;
}

function startHeartbeat(): void {
  if (heartbeatTimer || typeof window === 'undefined') return;

  heartbeatTimer = window.setInterval(() => {
    if (clientId) writeOwner(clientId);
  }, HEARTBEAT_INTERVAL_MS);

  window.addEventListener('pagehide', () => {
    if (clientId) removeOwner(clientId);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });
}

export function getTabClientId(): string {
  if (!clientId) {
    clientId = initializeClientId();
    startHeartbeat();
  }

  return clientId;
}

export function __resetTabClientIdForTests(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (clientId) removeOwner(clientId);
  clientId = null;
}
