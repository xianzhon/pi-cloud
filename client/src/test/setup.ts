import { afterEach, beforeEach } from 'vitest';

const unstubbedRequests: string[] = [];

function rejectUnstubbedRequest(input: RequestInfo | URL): Promise<never> {
  const url = input instanceof Request ? input.url : String(input);
  unstubbedRequests.push(url);
  return Promise.reject(new Error(`Unstubbed network request: ${url}`));
}

// Tests must replace fetch explicitly. Tracking rejected calls also fails tests
// whose production error handling would otherwise swallow the rejection.
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: rejectUnstubbedRequest,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    writable: true,
    value: rejectUnstubbedRequest,
  });
}

beforeEach(() => {
  unstubbedRequests.length = 0;
});

afterEach(() => {
  if (unstubbedRequests.length === 0) return;
  throw new Error(
    `Test made unstubbed network requests:\n${unstubbedRequests.map((url) => `- ${url}`).join('\n')}`,
  );
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

// Node 26 defines a configurable global localStorage getter that returns undefined
// unless --localstorage-file is provided. Install deterministic browser storage for
// happy-dom tests instead of depending on that process-level Node option.
const testLocalStorage = createMemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testLocalStorage,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  });
}
