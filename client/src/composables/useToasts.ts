import { readonly, ref } from 'vue';

export type ToastType = 'info' | 'success' | 'error';

export interface ToastNotification {
  id: number;
  message: string;
  type: ToastType;
}

const DEFAULT_DURATION_MS = 4_000;
const toasts = ref<ToastNotification[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextToastId = 1;

function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts.value = toasts.value.filter(toast => toast.id !== id);
}

function showToast(message: string, type: ToastType = 'info', duration = DEFAULT_DURATION_MS): number {
  const id = nextToastId++;
  toasts.value.push({ id, message, type });

  if (duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), duration));
  }

  return id;
}

function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.value = [];
}

export function useToasts() {
  return {
    toasts: readonly(toasts),
    showToast,
    dismissToast,
    clearToasts,
  };
}
