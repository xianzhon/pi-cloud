import { describe, expect, it, vi } from 'vitest';
import { createPreloadErrorHandler } from './preloadErrorRecovery';

describe('createPreloadErrorHandler', () => {
  it('suppresses a failed lazy import and reloads the page once', () => {
    const reload = vi.fn();
    const handlePreloadError = createPreloadErrorHandler(reload);
    const firstError = new Event('vite:preloadError', { cancelable: true });
    const secondError = new Event('vite:preloadError', { cancelable: true });

    handlePreloadError(firstError);
    handlePreloadError(secondError);

    expect(firstError.defaultPrevented).toBe(true);
    expect(secondError.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
