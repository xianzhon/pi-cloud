export interface ReviewSource {
  id: string;
  type: string;
  label: string;
  dataPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSessionListItem {
  id: string;
  sourceId: string;
  name?: string;
  path: string;
  cwd?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage?: string;
}

export interface ReviewSessionTranscript {
  messages: Array<{
    role: string;
    content: unknown;
    timestamp?: number;
  }>;
  metadata?: Record<string, unknown>;
}

export type ReviewSourceProfile = ReviewSource & { kind: 'review' };
