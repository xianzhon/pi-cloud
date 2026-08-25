export interface ApiErrorPayload {
  error?: unknown;
  message?: unknown;
}

export interface ApiRequestOptions<TRequest = never> extends Omit<RequestInit, 'body'> {
  body?: TRequest;
  fallbackMessage?: string | ((status: number) => string);
  handleUnauthorized?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type SessionExpiredHandler = () => void;
const sessionExpiredHandlers = new Set<SessionExpiredHandler>();

export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(handler);
  return () => sessionExpiredHandlers.delete(handler);
}

export function getApiErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallbackMessage;
}

export async function apiRequest<TResponse, TRequest = never>(
  url: string,
  options: ApiRequestOptions<TRequest> = {},
): Promise<TResponse> {
  const { body, fallbackMessage, handleUnauthorized = true, headers, ...init } = options;
  const requestInit = Object.fromEntries(
    Object.entries(init).filter(([, value]) => value !== undefined),
  ) as RequestInit;

  if (body !== undefined) {
    if (headers === undefined) {
      requestInit.headers = { 'Content-Type': 'application/json' };
    } else {
      const requestHeaders = new Headers(headers);
      if (!requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json');
      requestInit.headers = requestHeaders;
    }
    requestInit.body = JSON.stringify(body);
  } else if (headers !== undefined) {
    requestInit.headers = headers;
  }

  const response = Object.keys(requestInit).length > 0
    ? await fetch(url, requestInit)
    : await fetch(url);
  const payload = await parseJson(response);

  if (response.status === 401 && handleUnauthorized) {
    for (const handler of sessionExpiredHandlers) handler();
  }

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(payload)
        || (typeof fallbackMessage === 'function' ? fallbackMessage(response.status) : fallbackMessage)
        || `Request failed (${response.status})`,
      response.status,
      payload,
    );
  }

  return payload as TResponse;
}

async function parseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { error, message } = payload as ApiErrorPayload;
  if (typeof error === 'string' && error) return error;
  if (typeof message === 'string' && message) return message;
  return undefined;
}
