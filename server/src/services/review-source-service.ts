import type { ReviewSource, ReviewSessionListItem, ReviewSessionTranscript, ReviewSourceAdapter, ReviewSourceListOptions } from '../types.js';
import { DevinReviewSourceAdapter } from './review-source-adapters/devin-adapter.js';
import type { ReviewSourceStore } from './review-source-store.js';

export class ReviewSourceService {
  constructor(private store: ReviewSourceStore) {}

  listSources(): ReviewSource[] {
    return this.store.list();
  }

  createSource(request: { type: string; label: string; dataPath: string }): ReviewSource {
    return this.store.create(request);
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
    return this.getAdapter(sourceId).delete(sessionId);
  }

  listProjectPaths(sourceId: string): Promise<string[]> {
    return this.getAdapter(sourceId).listProjectPaths();
  }

  private getAdapter(sourceId: string): ReviewSourceAdapter {
    const source = this.store.get(sourceId);
    if (!source) throw new Error(`Review source not found: ${sourceId}`);
    if (source.type === 'devin') return new DevinReviewSourceAdapter(source.dataPath);
    throw new Error(`Unsupported review source type: ${source.type}`);
  }
}
