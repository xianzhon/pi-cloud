// client/src/composables/useWebSocket.ts
import { ref, onUnmounted } from 'vue';
import { getTabClientId } from '../utils/tabClientId';

const clientId = getTabClientId();

const socket = ref<WebSocket | null>(null);
const isConnected = ref(false);
const reconnectAttempts = ref(0);
const listeners = new Map<string, Set<Function>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manuallyClosed = false;
let isConnecting = false;

const maxAttempts = 10;
const baseDelay = 1000;
const maxDelay = 30000;

function emit(event: string, data?: any) {
  listeners.get(event)?.forEach((callback) => callback(data));
}

function connect() {
  if (isConnecting || socket.value?.readyState === WebSocket.OPEN || socket.value?.readyState === WebSocket.CONNECTING) {
    return;
  }

  manuallyClosed = false;
  isConnecting = true;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.host}/ws/chat?clientId=${clientId}`;
  const ws = new WebSocket(wsUrl);
  socket.value = ws;

  ws.onopen = () => {
    console.log('WebSocket connected');
    isConnecting = false;
    isConnected.value = true;
    reconnectAttempts.value = 0;
    emit('connected');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      emit(data.type, data);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  };

  ws.onclose = () => {
    if (socket.value === ws) {
      socket.value = null;
    }
    isConnecting = false;
    console.log('WebSocket disconnected');
    isConnected.value = false;
    emit('disconnected');
    if (!manuallyClosed) {
      scheduleReconnect();
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  if (reconnectAttempts.value >= maxAttempts) {
    console.error('Max reconnect attempts reached');
    return;
  }

  const delay = Math.min(
    baseDelay * Math.pow(2, reconnectAttempts.value),
    maxDelay
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempts.value++;
    connect();
  }, delay);
}

function send(data: any): boolean {
  if (socket.value?.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket not connected; message not sent');
    return false;
  }
  socket.value.send(JSON.stringify(data));
  return true;
}

function on(event: string, callback: Function) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(callback);

  return () => {
    listeners.get(event)?.delete(callback);
  };
}

function close() {
  manuallyClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket.value?.close();
  socket.value = null;
}

export function useWebSocket(options: { autoConnect?: boolean } = {}) {
  if (options.autoConnect !== false) connect();

  onUnmounted(() => {
    // Keep the singleton chat socket alive across route/component changes.
    // Closing it from one component would disconnect other active consumers
    // that share the same tab/clientId.
  });

  return {
    socket,
    isConnected,
    connect,
    send,
    on,
    close,
    clientId,
  };
}
