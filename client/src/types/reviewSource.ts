export interface ReviewSource {
  id: string;
  type: string;
  label: string;
  dataPath: string;
  createdAt: string;
  updatedAt: string;
  capabilities: {
    canDeleteSource: boolean;
    canDeleteSessions: boolean;
  };
}

export interface ReviewSourceType {
  type: string;
  label: string;
  defaultDataPath: string;
  canDeleteSessions: boolean;
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
    detailOnly?: boolean;
  }>;
  metadata?: Record<string, unknown>;
}

export type ReviewSourceProfile = ReviewSource & { kind: 'review' };
