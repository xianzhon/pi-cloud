import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ReviewSourceAdapter, ReviewSourceType } from '../types.js';
import { ClaudeCodeReviewSourceAdapter } from './review-source-adapters/claude-code-adapter.js';
import { DevinReviewSourceAdapter } from './review-source-adapters/devin-adapter.js';

export interface ReviewSourceProvider extends ReviewSourceType {
  isAvailable(dataPath: string): boolean;
  createAdapter(dataPath: string): ReviewSourceAdapter;
}

export const reviewSourceProviders: ReviewSourceProvider[] = [
  {
    type: 'devin',
    label: 'Devin',
    defaultDataPath: path.join(os.homedir(), '.local', 'share', 'devin', 'cli'),
    canDeleteSessions: true,
    isAvailable: (dataPath) => fs.existsSync(path.join(dataPath, 'sessions.db')),
    createAdapter: (dataPath) => new DevinReviewSourceAdapter(dataPath),
  },
  {
    type: 'claude-code',
    label: 'Claude Code',
    defaultDataPath: path.join(os.homedir(), '.claude', 'projects'),
    canDeleteSessions: false,
    isAvailable: (dataPath) => fs.existsSync(dataPath) && fs.statSync(dataPath).isDirectory(),
    createAdapter: (dataPath) => new ClaudeCodeReviewSourceAdapter(dataPath),
  },
];

export function findReviewSourceProvider(type: string, providers = reviewSourceProviders): ReviewSourceProvider | undefined {
  return providers.find((provider) => provider.type === type);
}
