import type { ReviewSource, ReviewSessionListItem, ReviewSessionTranscript, ReviewSourceAdapter, ReviewSourceListOptions, ReviewSourceType } from '../types.js';
import { findReviewSourceProvider, reviewSourceProviders, type ReviewSourceProvider } from './review-source-providers.js';
import type { ReviewSourceStore } from './review-source-store.js';

export class ReviewSourceService {
  constructor(
    private store: ReviewSourceStore,
    private providers: ReviewSourceProvider[] = reviewSourceProviders,
  ) {}

  listTypes(): ReviewSourceType[] {
    return this.providers.map(({ type, label, defaultDataPath, canDeleteSessions }) => ({ type, label, defaultDataPath, canDeleteSessions }));
  }

  listSources(): ReviewSource[] {
    return this.store.list().map((source) => this.withCapabilities(source));
  }

  createSource(request: { type: string; label: string; dataPath: string }): ReviewSource {
    if (!findReviewSourceProvider(request.type, this.providers)) {
      throw new Error(`Unsupported review source type: ${request.type}`);
    }
    return this.withCapabilities(this.store.create(request));
  }

  deleteSource(id: string): void {
    this.store.delete(id);
  }

  async listSessions(sourceId: string, options: ReviewSourceListOptions = {}): Promise<ReviewSessionListItem[]> {
    const sessions = await this.getAdapter(sourceId).list(options);
    return sessions.map((session) => ({ ...session, sourceId }));
  }

  async searchSessions(sourceId: string, query: string, options: ReviewSourceListOptions = {}): Promise<ReviewSessionListItem[]> {
    const sessions = await this.getAdapter(sourceId).search(query, options);
    return sessions.map((session) => ({ ...session, sourceId }));
  }

  getTranscript(sourceId: string, sessionId: string): Promise<ReviewSessionTranscript> {
    return this.getAdapter(sourceId).getTranscript(sessionId);
  }

  deleteSession(sourceId: string, sessionId: string): Promise<void> {
    const source = this.store.get(sourceId);
    if (!source) throw new Error(`Review source not found: ${sourceId}`);
    const provider = findReviewSourceProvider(source.type, this.providers);
    if (!provider?.canDeleteSessions) throw new Error(`${provider?.label || source.type} review sessions are read-only`);
    return provider.createAdapter(source.dataPath).delete(sessionId);
  }

  listProjectPaths(sourceId: string): Promise<string[]> {
    return this.getAdapter(sourceId).listProjectPaths();
  }

  private getAdapter(sourceId: string): ReviewSourceAdapter {
    const source = this.store.get(sourceId);
    if (!source) throw new Error(`Review source not found: ${sourceId}`);
    const provider = findReviewSourceProvider(source.type, this.providers);
    if (!provider) throw new Error(`Unsupported review source type: ${source.type}`);
    return provider.createAdapter(source.dataPath);
  }

  private withCapabilities(source: Omit<ReviewSource, 'capabilities'>): ReviewSource {
    const provider = findReviewSourceProvider(source.type, this.providers);
    return {
      ...source,
      capabilities: {
        canDeleteSource: !this.store.isAutoDetected(source.id),
        canDeleteSessions: provider?.canDeleteSessions ?? false,
      },
    };
  }
}
