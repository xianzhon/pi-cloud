import type { PiSessionService } from './services/session-manager.js';
import type { TerminalManager } from './services/terminal-manager.js';
import type { WorktreeManager } from './services/worktree-manager.js';
import type { WorktreeMetadataStore } from './services/worktree-metadata-store.js';

/** Services whose mutable state belongs to one Fastify application instance. */
export interface AppServices {
  sessions: PiSessionService;
  terminals: TerminalManager;
  worktrees: WorktreeManager;
  worktreeMetadata: WorktreeMetadataStore;
}
