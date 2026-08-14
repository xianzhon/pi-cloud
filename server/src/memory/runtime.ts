import { EventEmitter } from 'node:events';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { AgentProfile } from '../types.js';
import type { PiuiDatabase } from '../db/database.js';
import { runWithAgentDirAndProxyEnv } from '../services/profile-proxy.js';
import { expandHomePath } from '../utils/paths.js';
import { MemoryExtractionCoordinator } from './coordinator.js';
import { createMemoryExtension } from './extension.js';
import { MemoryExtractor } from './extractor.js';
import { loadMemoryEfficiencyPolicy, type MemoryEfficiencyPolicy } from './policy.js';
import { MemoryProjectResolver, type WorktreeLookup } from './project-resolver.js';
import { MemoryService } from './service.js';
import { MemoryStore } from './store.js';
import type { MemoryRecallEvent, MemoryUpdatedEvent } from './types.js';

export const MEMORY_UPDATED_EVENT = 'memory-updated';
export const MEMORY_RECALL_EVENT = 'memory-recall';

export interface CreateMemoryRuntimeOptions {
  db: PiuiDatabase;
  worktrees: WorktreeLookup;
  resolveProfile(profileId: string): Promise<AgentProfile | undefined>;
  resolveProxyEnv?: (agentDir: string) => Record<string, string>;
  events?: EventEmitter;
  policy?: MemoryEfficiencyPolicy;
}

export class MemoryRuntime {
  constructor(
    readonly store: MemoryStore,
    readonly service: MemoryService,
    readonly coordinator: MemoryExtractionCoordinator,
    private readonly events: EventEmitter,
  ) {}

  start(): void {
    this.coordinator.start();
  }

  async stop(): Promise<void> {
    await this.coordinator.stop();
    this.events.removeAllListeners(MEMORY_UPDATED_EVENT);
    this.events.removeAllListeners(MEMORY_RECALL_EVENT);
  }

  createExtension(input: { profileId: string; cwd: string }): InlineExtension {
    return createMemoryExtension({
      profileId: input.profileId,
      service: this.service,
      enqueueAutomatic: (run) => this.coordinator.enqueue(run),
      isAutoExtractionEnabled: () => this.store.isAutoExtractionEnabled(),
      onRecall: (event) => this.events.emit(MEMORY_RECALL_EVENT, event),
    });
  }

  withForeground<T>(profileId: string, work: () => Promise<T>): Promise<T> {
    return this.coordinator.withForeground(profileId, work);
  }

  onUpdated(listener: (event: MemoryUpdatedEvent) => void): () => void {
    this.events.on(MEMORY_UPDATED_EVENT, listener);
    return () => this.events.off(MEMORY_UPDATED_EVENT, listener);
  }

  onRecall(listener: (event: MemoryRecallEvent) => void): () => void {
    this.events.on(MEMORY_RECALL_EVENT, listener);
    return () => this.events.off(MEMORY_RECALL_EVENT, listener);
  }

  deleteProfile(profileId: string): void {
    this.store.deleteProfile(profileId);
  }

  async relocateProject(projectId: string, newPath: string): Promise<void> {
    const absolutePath = resolve(expandHomePath(newPath));
    const canonicalPath = await realpath(absolutePath).catch(() => absolutePath);
    this.store.relocateProject(projectId, canonicalPath);
  }
}

export function createMemoryRuntime(options: CreateMemoryRuntimeOptions): MemoryRuntime {
  const policy = options.policy ?? loadMemoryEfficiencyPolicy();
  const store = new MemoryStore(options.db);
  const projects = new MemoryProjectResolver(store, options.worktrees);
  const service = new MemoryService(store, projects, policy);
  const events = options.events ?? new EventEmitter();
  const extractor = new MemoryExtractor({
    store,
    resolveProfile: options.resolveProfile,
    policy,
    runWithProxy: async (agentDir, work) => {
      const proxyEnv = options.resolveProxyEnv?.(agentDir) || {};
      return runWithAgentDirAndProxyEnv(agentDir, proxyEnv, work);
    },
  });
  const coordinator = new MemoryExtractionCoordinator({
    store,
    extractor,
    emit: (event) => events.emit(MEMORY_UPDATED_EVENT, event),
  });
  return new MemoryRuntime(store, service, coordinator, events);
}
