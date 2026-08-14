const LAUNCH_RESOURCE_TTL_MS = 60 * 60 * 1000;

type CacheEntry<T> = {
  value?: T;
  expiresAt: number;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function launchCacheKey(parts: Array<string | number | undefined | null>): string {
  return parts.map((part) => encodeURIComponent(String(part ?? ''))).join(':');
}

export async function cachedLaunchResource<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;

  if (existing?.value !== undefined && existing.expiresAt > now) {
    return existing.value;
  }

  if (existing?.promise) {
    return existing.promise;
  }

  const promise = loader().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + LAUNCH_RESOURCE_TTL_MS });
    return value;
  }).finally(() => {
    const entry = cache.get(key);
    if (entry?.promise === promise) {
      delete entry.promise;
    }
  });

  cache.set(key, { value: existing?.value, expiresAt: existing?.expiresAt ?? 0, promise });
  return promise;
}

export function invalidateLaunchResourceCache(key?: string): void {
  if (!key) {
    cache.clear();
    return;
  }

  cache.delete(key);
}
