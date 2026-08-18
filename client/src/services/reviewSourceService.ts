import type { ReviewSessionListItem, ReviewSessionTranscript, ReviewSource, ReviewSourceType } from '../types/reviewSource';

export async function listReviewSources(): Promise<ReviewSource[]> {
  const response = await fetch('/api/review-sources');
  const data = await response.json() as { sources?: ReviewSource[] };
  return data.sources || [];
}

export async function listReviewSourceTypes(): Promise<ReviewSourceType[]> {
  const response = await fetch('/api/review-sources/types');
  if (!response.ok) throw new Error('Failed to load review source types');
  const data = await response.json() as { types?: ReviewSourceType[] };
  return data.types || [];
}

export async function createReviewSource(request: { type: string; label: string; dataPath: string }): Promise<ReviewSource> {
  const response = await fetch('/api/review-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Failed to create review source');
  const data = await response.json() as { source: ReviewSource };
  return data.source;
}

export async function deleteReviewSource(id: string): Promise<void> {
  const response = await fetch(`/api/review-sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete review source');
}

export interface ReviewSessionListOptions {
  projectPath?: string;
  offset?: number;
  limit?: number;
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
  const response = await fetch(`/api/review-sources/${encodeURIComponent(sourceId)}/sessions${query}`);
  if (!response.ok) throw new Error('Failed to load review sessions');
  const data = await response.json() as { sessions?: ReviewSessionListItem[] };
  return data.sessions || [];
}

export async function searchReviewSessions(sourceId: string, query: string, options: ReviewSessionListOptions = {}): Promise<ReviewSessionListItem[]> {
  const params = buildSessionListParams(options);
  params.set('q', query);
  const response = await fetch(`/api/review-sources/${encodeURIComponent(sourceId)}/search?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to search review sessions');
  const data = await response.json() as { sessions?: ReviewSessionListItem[] };
  return data.sessions || [];
}

export async function getReviewTranscript(sourceId: string, sessionId: string): Promise<ReviewSessionTranscript> {
  const response = await fetch(`/api/review-sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(sessionId)}/transcript`);
  if (!response.ok) throw new Error('Failed to load transcript');
  const data = await response.json() as { transcript: ReviewSessionTranscript };
  return data.transcript;
}

export async function deleteReviewSession(sourceId: string, sessionId: string): Promise<void> {
  const response = await fetch(`/api/review-sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete session');
}

export async function listReviewSourceProjectPaths(sourceId: string): Promise<string[]> {
  const response = await fetch(`/api/review-sources/${encodeURIComponent(sourceId)}/project-paths`);
  if (!response.ok) throw new Error('Failed to load review source project paths');
  const data = await response.json() as { projectPaths?: string[] };
  return data.projectPaths || [];
}
