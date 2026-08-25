import type { ReviewSessionListItem, ReviewSessionTranscript, ReviewSource, ReviewSourceType } from '../types/reviewSource';
import { apiRequest } from './apiClient';

export interface ReviewSourcesResponse {
  sources?: ReviewSource[];
}

export interface ReviewSourceTypesResponse {
  types?: ReviewSourceType[];
}

export interface CreateReviewSourceRequest {
  type: string;
  label: string;
  dataPath: string;
}

export interface CreateReviewSourceResponse {
  source: ReviewSource;
}

export interface ReviewSessionsResponse {
  sessions?: ReviewSessionListItem[];
}

export interface ReviewTranscriptResponse {
  transcript: ReviewSessionTranscript;
}

export interface ReviewSourceProjectPathsResponse {
  projectPaths?: string[];
}

export async function listReviewSources(signal?: AbortSignal): Promise<ReviewSource[]> {
  const data = await apiRequest<ReviewSourcesResponse>('/api/review-sources', { signal });
  return data.sources || [];
}

export async function listReviewSourceTypes(signal?: AbortSignal): Promise<ReviewSourceType[]> {
  const data = await apiRequest<ReviewSourceTypesResponse>('/api/review-sources/types', {
    signal,
    fallbackMessage: 'Failed to load review source types',
  });
  return data.types || [];
}

export async function createReviewSource(request: CreateReviewSourceRequest, signal?: AbortSignal): Promise<ReviewSource> {
  const data = await apiRequest<CreateReviewSourceResponse, CreateReviewSourceRequest>('/api/review-sources', {
    method: 'POST',
    body: request,
    signal,
    fallbackMessage: 'Failed to create review source',
  });
  return data.source;
}

export async function deleteReviewSource(id: string, signal?: AbortSignal): Promise<void> {
  await apiRequest<void>(`/api/review-sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
    fallbackMessage: 'Failed to delete review source',
  });
}

export interface ReviewSessionListOptions {
  projectPath?: string;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}

function buildSessionListParams(options: ReviewSessionListOptions): URLSearchParams {
  const params = new URLSearchParams();
  if (options.projectPath) params.set('projectPath', options.projectPath);
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  return params;
}

export async function listReviewSessions(sourceId: string, options: ReviewSessionListOptions = {}): Promise<ReviewSessionListItem[]> {
  const params = buildSessionListParams(options);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  const data = await apiRequest<ReviewSessionsResponse>(`/api/review-sources/${encodeURIComponent(sourceId)}/sessions${query}`, {
    signal: options.signal,
    fallbackMessage: 'Failed to load review sessions',
  });
  return data.sessions || [];
}

export async function searchReviewSessions(sourceId: string, query: string, options: ReviewSessionListOptions = {}): Promise<ReviewSessionListItem[]> {
  const params = buildSessionListParams(options);
  params.set('q', query);
  const data = await apiRequest<ReviewSessionsResponse>(`/api/review-sources/${encodeURIComponent(sourceId)}/search?${params.toString()}`, {
    signal: options.signal,
    fallbackMessage: 'Failed to search review sessions',
  });
  return data.sessions || [];
}

export async function getReviewTranscript(sourceId: string, sessionId: string, signal?: AbortSignal): Promise<ReviewSessionTranscript> {
  const data = await apiRequest<ReviewTranscriptResponse>(`/api/review-sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(sessionId)}/transcript`, {
    signal,
    fallbackMessage: 'Failed to load transcript',
  });
  return data.transcript;
}

export async function deleteReviewSession(sourceId: string, sessionId: string, signal?: AbortSignal): Promise<void> {
  await apiRequest<void>(`/api/review-sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    signal,
    fallbackMessage: 'Failed to delete session',
  });
}

export async function listReviewSourceProjectPaths(sourceId: string, signal?: AbortSignal): Promise<string[]> {
  const data = await apiRequest<ReviewSourceProjectPathsResponse>(`/api/review-sources/${encodeURIComponent(sourceId)}/project-paths`, {
    signal,
    fallbackMessage: 'Failed to load review source project paths',
  });
  return data.projectPaths || [];
}
