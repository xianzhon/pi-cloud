# Profile proxy locking and AI request concurrency

## Problem

Pi Cloud can run AI requests for different browser tabs and profiles in the same Node.js server process. Some requests, such as chat streaming and AI automation actions like task polish, need the active Pi profile's proxy settings.

The current proxy integration has to touch process-global state:

- `process.env` proxy variables such as `ALL_PROXY`, `HTTP_PROXY`, and `HTTPS_PROXY`
- undici's global dispatcher via `setGlobalDispatcher(new EnvHttpProxyAgent())`
- `PI_CODING_AGENT_DIR`, so SDK code resolves the correct profile directory

Because these values are shared by the whole Node process, two requests with different profile/proxy environments cannot safely run through this global setup at the same time. Without coordination, one request could change or restore the global proxy state while another streaming request is still using it.

## Current behavior and limitation

`server/src/services/profile-proxy.ts` allows requests with the **same effective environment** to overlap.

The effective environment key includes:

- agent directory / profile directory
- managed proxy env values

Current behavior:

- Same profile + same proxy settings: requests can run concurrently.
- Different profile or different proxy settings: requests are still serialized.

This avoids blocking for the common case where multiple tabs use the same profile, while preserving correctness for different proxy environments.

## Why different profiles can still block each other

If Profile A has no proxy and Profile B has a proxy, they still require different global `process.env` and undici dispatcher state. Since those are process-wide, allowing both to run concurrently could cause proxy leakage or incorrect routing.

Example unsafe interleaving without a lock:

```text
Request A starts with proxy=http://proxy-a
Request B starts with no proxy and clears proxy env
Request A is still streaming
Request A's later network calls may now use the wrong proxy state
```

So the remaining lock is intentional: it protects correctness when global network state differs.

## Future improvement: per-request proxy configuration

The long-term solution is to avoid mutating global state for AI requests.

Instead of temporarily changing `process.env` and the global dispatcher around `completeSimple` / streaming calls, the server should pass proxy configuration directly into the request path, for example:

```ts
await completeSimple(model, context, {
  apiKey,
  headers,
  env,
  maxTokens,
  sessionId,
  dispatcher: proxyDispatcherForThisProfile,
});
```

or via an injected `fetch` implementation:

```ts
await completeSimple(model, context, {
  ...options,
  fetch: fetchWithProxyForThisProfile,
});
```

With per-request proxy handling, each request owns its network configuration and different profiles can run concurrently without a global lock.

## Tradeoffs for per-request proxy configuration

### Benefits

- Different profiles can stream concurrently without blocking each other.
- No proxy/env leakage between requests.
- Better fit for multi-tab and multi-profile server behavior.
- Less reliance on fragile global mutation.

### Costs and risks

- Requires support in `@earendil-works/pi-ai` / provider code for per-request dispatcher, fetch, or equivalent proxy options.
- Each provider must be checked because some may call `fetch` directly while others may use third-party SDKs.
- Providers that cannot accept per-request networking config may still need a serialized global-state fallback.
- More type and test coverage is required across streaming and non-streaming AI calls.

## Recommended migration path

1. Investigate whether `pi-ai` already supports per-request `dispatcher`, custom `fetch`, or provider-specific HTTP agents.
2. If supported, pass the profile-specific dispatcher/fetch from Pi Cloud instead of using global env mutation.
3. If not supported, extend the AI/provider layer with a small per-request network option.
4. Migrate the most-used providers first.
5. Keep the current global-lock path as a fallback for providers that cannot yet use per-request proxy configuration.
