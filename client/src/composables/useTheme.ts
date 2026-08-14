import { computed, onScopeDispose, ref, watch } from 'vue';
import { usePreferences } from './usePreferences';

export type ResolvedTheme = 'dark' | 'light';

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f0f14' : '#ffffff');
}

export function useTheme() {
  const { theme, setTheme } = usePreferences();
  const systemTheme = ref<ResolvedTheme>(resolveSystemTheme());
  const resolvedTheme = computed<ResolvedTheme>(() => theme.value === 'system' ? systemTheme.value : theme.value);

  const media = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;

  function updateSystemTheme(): void {
    systemTheme.value = resolveSystemTheme();
  }

  media?.addEventListener('change', updateSystemTheme);
  onScopeDispose(() => media?.removeEventListener('change', updateSystemTheme));

  watch(resolvedTheme, applyTheme, { immediate: true });

  return {
    theme,
    setTheme,
    resolvedTheme,
  };
}
