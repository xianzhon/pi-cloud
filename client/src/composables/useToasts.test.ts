import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from './useToasts';

const toastController = useToasts();

describe('useToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastController.clearToasts();
  });

  afterEach(() => {
    toastController.clearToasts();
    vi.useRealTimers();
  });

  it('shows and automatically dismisses notifications', () => {
    toastController.showToast('Saved', 'success', 1_000);

    expect(toastController.toasts.value).toEqual([
      expect.objectContaining({ message: 'Saved', type: 'success' }),
    ]);

    vi.advanceTimersByTime(1_000);
    expect(toastController.toasts.value).toEqual([]);
  });

  it('allows notifications to be dismissed immediately', () => {
    const id = toastController.showToast('Something failed', 'error');

    toastController.dismissToast(id);

    expect(toastController.toasts.value).toEqual([]);
  });
});
