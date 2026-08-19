import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPiuiDatabase, type PiuiDatabase } from '../db/database.js';
import { LEGACY_MEMORY_POLICY } from './policy.js';
import { MemoryProjectResolver } from './project-resolver.js';
import { MemoryService } from './service.js';
import { MemoryStore } from './store.js';
import type { MemoryContext } from './types.js';

describe('MemoryService', () => {
  let db: PiuiDatabase;
  let store: MemoryStore;
  let service: MemoryService;
  let resolver: MemoryProjectResolver;
  let context: MemoryContext;

  beforeEach(() => {
    db = openPiuiDatabase(':memory:');
    store = new MemoryStore(db);
    resolver = new MemoryProjectResolver(store, { get: () => null });
    service = new MemoryService(store, resolver);
    const project = store.getOrCreateProject('default', '/repo/app');
    context = { profileId: 'default', project };
  });

  afterEach(() => {
    db.close();
  });

  it('defaults explicit saves to active project memory', () => {
    const memory = service.save(context, {
      category: 'decision',
      content: 'Use SQLite FTS5',
      tags: ['sqlite'],
    });

    expect(memory).toMatchObject({
      profileId: 'default',
      projectId: context.project.id,
      scope: 'project',
      status: 'active',
      source: 'explicit',
    });
  });

  it('creates explicit global memory without a project id', () => {
    const memory = service.save(context, {
      scope: 'global',
      category: 'preference',
      content: 'Prefer concise responses',
    });

    expect(memory).toMatchObject({ scope: 'global', status: 'active', source: 'explicit' });
    expect(memory.projectId).toBeUndefined();
  });

  it('allows manual UI source but rejects automatic source through explicit save policy', () => {
    expect(service.save(context, {
      category: 'fact',
      content: 'The UI uses Vue',
    }, 'manual_ui').source).toBe('manual_ui');

    expect(() => service.save(context, {
      scope: 'global',
      category: 'preference',
      content: 'Prefer dark mode',
    }, 'automatic' as any)).toThrow(/explicit save source/i);
  });

  it('rejects secrets before mutating the store', () => {
    expect(() => service.save(context, {
      category: 'fact',
      content: `API_KEY=${'sk-' + 'a'.repeat(32)}`,
    })).toThrow(/secret|credential/i);
    expect(service.list(context, {}).total).toBe(0);
  });

  it('uses replacements for content edits and in-place updates for pinning', () => {
    const original = service.save(context, { category: 'fact', content: 'Use path IDs' });
    const pinned = service.update(context, original.id, original.revision, { pinned: true });
    const replacement = service.update(context, pinned.id, pinned.revision, {
      category: 'decision',
      content: 'Use stable project IDs',
      tags: ['project'],
    });

    expect(pinned).toMatchObject({ id: original.id, revision: 2, pinned: true });
    expect(replacement).toMatchObject({ supersedesId: original.id, status: 'active' });
    expect(store.getMemory(original.id)?.status).toBe('archived');
  });

  it('restores and deletes accessible memories', () => {
    const memory = service.save(context, { category: 'fact', content: 'Restore this memory' });
    const archived = service.forget(context, memory.id, memory.revision);

    const restored = service.restore(context, archived.id, archived.revision);
    expect(restored).toMatchObject({ status: 'active', revision: 3 });

    service.delete(context, restored.id, restored.revision);
    expect(store.getMemory(restored.id)).toBeNull();
  });

  it('rejects update, forget, restore, and delete outside the effective context', () => {
    const otherProject = store.getOrCreateProject('default', '/repo/other');
    const other = store.createMemory({
      profileId: 'default', projectId: otherProject.id, scope: 'project', category: 'fact',
      content: 'Other project fact', tags: [], pinned: false, status: 'active', source: 'manual_ui',
    });

    expect(() => service.update(context, other.id, other.revision, { pinned: true })).toThrow(/not found/i);
    expect(() => service.forget(context, other.id, other.revision)).toThrow(/not found/i);
    expect(() => service.restore(context, other.id, other.revision)).toThrow(/not found/i);
    expect(() => service.delete(context, other.id, other.revision)).toThrow(/not found/i);
  });

  it('searches and lists only the effective profile/project scope', () => {
    const projectMemory = service.save(context, { category: 'pitfall', content: 'Keyboard lists clamp selection', tags: ['keyboard'] });
    const globalMemory = service.save(context, { scope: 'global', category: 'preference', content: 'Prefer keyboard navigation' });

    expect(service.search(context, 'keyboard').map((memory) => memory.id)).toEqual([projectMemory.id, globalMemory.id]);
    expect(service.list(context, { scope: 'project' }).items).toEqual([projectMemory]);
  });

  it('reports when combined pinned memory exceeds the recall budget', () => {
    for (let index = 0; index < 5; index += 1) {
      service.save(context, {
        category: 'rule',
        content: `${index} ${'x'.repeat(1_850)}`,
        pinned: true,
        pinnedApplicability: 'always',
      });
    }

    expect(service.counts(context).pinnedOverflow).toBe(true);
  });

  it('approves and rejects only accessible pending records', () => {
    const pending = store.createMemory({
      profileId: 'default', scope: 'global', category: 'preference', content: 'Prefer short updates', tags: [],
      pinned: false, status: 'pending', source: 'automatic',
    });
    const approved = service.approve(context, pending.id, pending.revision, { content: 'Prefer concise updates' });
    expect(approved).toMatchObject({ status: 'active', content: 'Prefer concise updates' });

    const rejected = store.createMemory({
      profileId: 'default', scope: 'global', category: 'preference', content: 'Prefer verbose updates', tags: [],
      pinned: false, status: 'pending', source: 'automatic',
    });
    expect(service.reject(context, rejected.id, rejected.revision).status).toBe('archived');
  });

  it('returns a recall trace with selected memory reasons and token count', () => {
    const pinned = service.save(context, {
      category: 'rule',
      content: 'Keep changes surgical',
      pinned: true,
      pinnedApplicability: 'always',
    });
    const relevant = service.save(context, {
      category: 'fact',
      content: 'Keyboard menus clamp at visible bounds',
      tags: ['keyboard'],
    });

    const result = service.buildRecall(context, 'How should keyboard menus move?');

    expect(result.prompt).toContain('Keep changes surgical');
    expect(result.prompt).toContain('Keyboard menus clamp at visible bounds');
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.tokenCount).toBeLessThanOrEqual(800);
    expect(result.diagnostics).toMatchObject({
      budgetCeiling: 800,
      countingMethod: 'local-unicode-v1',
      rankingPolicyVersion: 'adaptive-lexical-v1',
      promptFormatVersion: 'memory-prompt-v2',
    });
    expect(result.memories).toEqual([
      expect.objectContaining({ id: pinned.id, reason: 'pinned', category: 'rule', scope: 'project' }),
      expect.objectContaining({ id: relevant.id, reason: 'query-match', category: 'fact', scope: 'project' }),
    ]);
    expect(store.getMemory(pinned.id)?.useCount).toBe(1);
    expect(store.getMemory(relevant.id)?.useCount).toBe(1);
  });

  it('applies matched pinned memories only when relevant while retaining always compatibility', () => {
    const always = service.save(context, {
      category: 'rule',
      content: 'Keep changes surgical',
      pinned: true,
      pinnedApplicability: 'always',
    });
    const matched = service.save(context, {
      category: 'preference',
      content: 'Use arrow keys for keyboard menus',
      pinned: true,
      pinnedApplicability: 'matched',
    });

    const keyboard = service.buildRecall(context, 'How should keyboard menus navigate?');
    const unrelated = service.buildRecall(context, 'Summarize the deployment architecture');
    const acknowledgement = service.buildRecall(context, 'Thanks');

    expect(keyboard.memories.map((memory) => memory.id)).toEqual([always.id, matched.id]);
    expect(unrelated.memories.map((memory) => memory.id)).toEqual([always.id]);
    expect(acknowledgement.memories.map((memory) => memory.id)).toEqual([always.id]);
    expect(acknowledgement.diagnostics?.skipReason).toBeUndefined();
    expect(unrelated.prompt).not.toContain(matched.content);
  });

  it('returns zero injection for an irrelevant pool and recalls mixed Chinese code terms', () => {
    service.save(context, {
      category: 'fact',
      content: 'The release checklist is stored in docs/release.md',
      tags: ['release'],
    });
    const chinese = service.save(context, {
      category: 'pitfall',
      content: 'ERR_TIMEOUT 的错误处理位于 server/src/api/errors.ts',
      tags: ['错误处理'],
    });

    const irrelevant = service.buildRecall(context, 'What is the weather forecast tomorrow?');
    const relevant = service.buildRecall(context, '请修复 server/src/api/errors.ts 的 ERR_TIMEOUT 错误处理');

    expect(irrelevant).toMatchObject({ prompt: '', memories: [], tokenCount: 0 });
    expect(irrelevant.diagnostics).toMatchObject({ budgetCeiling: 0, skipReason: 'no-confident-match' });
    expect(relevant.memories.map((memory) => memory.id)).toContain(chinese.id);
  });

  it('uses the explicit-inspection budget and records content-free recall telemetry', () => {
    service.save(context, { category: 'fact', content: 'The server uses Fastify' });

    const result = service.buildRecall(context, 'What do you remember about this project?');

    expect(result.diagnostics?.budgetCeiling).toBe(2_500);
    const event = db.prepare('SELECT * FROM memory_recall_events ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
    expect(event.ranking_policy_version).toBe('adaptive-lexical-v1');
    expect(event).not.toHaveProperty('prompt');
    expect(JSON.stringify(event)).not.toContain('What do you remember');
    expect(JSON.stringify(event)).not.toContain('The server uses Fastify');
  });

  it('keeps technical questions that mention memory on lexical recall', () => {
    const relevant = service.save(context, {
      category: 'fact',
      content: 'The memory recall candidate limit is 24 records.',
      tags: ['recall', 'limit'],
    });
    const unrelated = service.save(context, {
      category: 'fact',
      content: 'WeChat images are decrypted before MIME validation.',
      tags: ['wechat', 'images'],
    });

    const result = service.buildRecall(context, 'is there a count limit of the recalled memory?');
    const memoryIds = new Set(result.memories.map((memory) => memory.id));

    expect(result.diagnostics?.budgetCeiling).toBe(800);
    expect(memoryIds).toContain(relevant.id);
    expect(memoryIds).not.toContain(unrelated.id);
  });

  it('can roll recall back to the legacy policy with the shared switch', () => {
    const legacyService = new MemoryService(store, resolver, LEGACY_MEMORY_POLICY);
    const matched = legacyService.save(context, {
      category: 'preference', content: 'Prefer Vue composition APIs', pinned: true,
      pinnedApplicability: 'matched',
    });

    const result = legacyService.buildRecall(context, 'Thanks');

    expect(result.prompt).toContain(matched.id);
    expect(result.memories.map((memory) => memory.id)).toEqual([matched.id]);
    expect(result.diagnostics).toMatchObject({
      rankingPolicyVersion: 'legacy', promptFormatVersion: 'memory-prompt-v1',
    });
  });

  it('builds bounded recall from pinned and relevant active memory', () => {
    const pinned = service.save(context, {
      category: 'rule',
      content: 'Keep changes surgical',
      pinned: true,
      pinnedApplicability: 'always',
    });
    const facts = Array.from({ length: 10 }, (_, index) => service.save(context, {
      category: 'fact',
      content: `Keyboard fact ${index}`,
      tags: ['keyboard'],
    }));
    store.createMemory({
      profileId: 'default', projectId: context.project.id, scope: 'project', category: 'fact',
      content: 'Pending keyboard fact', tags: ['keyboard'], pinned: false, status: 'pending', source: 'automatic',
    });
    store.createMemory({
      profileId: 'default', projectId: context.project.id, scope: 'project', category: 'fact',
      content: 'Archived keyboard fact', tags: ['keyboard'], pinned: false, status: 'archived', source: 'manual_ui',
    });
    const usedSpy = vi.spyOn(store, 'markUsed');

    const prompt = service.buildRecallPrompt(context, 'How should keyboard navigation work?');

    expect(prompt).toContain(pinned.content);
    expect(prompt).not.toContain('Pending keyboard fact');
    expect(prompt).not.toContain('Archived keyboard fact');
    expect(prompt).toContain('- [rule] Keep changes surgical');
    expect(prompt).not.toContain('Pending keyboard fact');
    expect(prompt).not.toContain('Archived keyboard fact');
    expect(service.buildRecall(context, 'How should keyboard navigation work?').tokenCount).toBeLessThanOrEqual(1_500);
    expect(usedSpy).toHaveBeenCalledWith(expect.arrayContaining([pinned.id]));
    expect(facts.some((fact) => (store.getMemory(fact.id)?.useCount || 0) > 0)).toBe(true);
  });
});
