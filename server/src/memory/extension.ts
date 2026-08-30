import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionContext, InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { ADAPTIVE_MEMORY_POLICY } from './policy.js';
import {
  MEMORY_PROMPT_FORMAT_VERSION,
  RECALL_POLICY_VERSION,
  TOKEN_ESTIMATOR_VERSION,
} from './recall.js';
import { MemoryService } from './service.js';
import type { EnqueueExtractionRunInput, MemoryCategory, MemoryContext, MemoryPatch, MemoryPinnedApplicability, MemoryRecallEvent, MemoryScope } from './types.js';

const MemoryParameters = Type.Object({
  operation: StringEnum(['save', 'search', 'update', 'forget'] as const),
  id: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  scope: Type.Optional(StringEnum(['project', 'global'] as const)),
  category: Type.Optional(StringEnum(['rule', 'preference', 'decision', 'fact', 'pitfall'] as const)),
  tags: Type.Optional(Type.Array(Type.String())),
  pinned: Type.Optional(Type.Boolean()),
  pinnedApplicability: Type.Optional(StringEnum(['always', 'matched'] as const)),
  expectedRevision: Type.Optional(Type.Number()),
});

interface MemoryExtensionDependencies {
  profileId: string;
  service: MemoryService;
  enqueueAutomatic(input: EnqueueExtractionRunInput): Promise<unknown> | unknown;
  isAutoExtractionEnabled?(): boolean;
  onRecall?(event: MemoryRecallEvent): void;
}

export function createMemoryExtension(dependencies: MemoryExtensionDependencies): InlineExtension {
  return {
    name: 'pi-cloud-memory',
    factory(pi) {
      let baselineLeafId: string | null = null;

      pi.on('session_start', (_event, ctx) => {
        baselineLeafId = ctx.sessionManager.getLeafId();
      });

      pi.on('session_tree', (event) => {
        baselineLeafId = event.newLeafId;
      });

      pi.on('before_agent_start', async (event, ctx) => {
        let context: MemoryContext | undefined;
        try {
          context = await resolveMemoryContext(dependencies, ctx);
          const recall = dependencies.service.buildRecall(context, event.prompt);
          emitRecallSafely(dependencies, {
            ...recall,
            profileId: dependencies.profileId,
            projectId: context.project.id,
            sessionId: ctx.sessionManager.getSessionId(),
            prompt: event.prompt,
            injected: Boolean(recall.prompt),
            createdAt: new Date().toISOString(),
          });
          if (!recall.prompt) return;
          return { systemPrompt: `${event.systemPrompt}\n\n${recall.prompt}` };
        } catch (error) {
          console.warn('[memory] recall failed:', errorName(error));
          if (context) {
            emitRecallSafely(dependencies, {
              profileId: dependencies.profileId,
              projectId: context.project.id,
              sessionId: ctx.sessionManager.getSessionId(),
              prompt: event.prompt,
              injected: false,
              memories: [],
              tokenCount: 0,
              diagnostics: {
                candidateIds: [],
                rejectedBelowThresholdIds: [],
                redundancyRejectedIds: [],
                selected: [],
                budgetCeiling: 0,
                usedTokens: 0,
                overflow: false,
                countingMethod: dependencies.service.policy === ADAPTIVE_MEMORY_POLICY
                  ? TOKEN_ESTIMATOR_VERSION
                  : 'legacy-length-div4',
                rankingPolicyVersion: dependencies.service.policy === ADAPTIVE_MEMORY_POLICY
                  ? RECALL_POLICY_VERSION
                  : 'legacy',
                promptFormatVersion: dependencies.service.policy === ADAPTIVE_MEMORY_POLICY
                  ? MEMORY_PROMPT_FORMAT_VERSION
                  : 'memory-prompt-v1',
                skipReason: 'recall-error',
              },
              createdAt: new Date().toISOString(),
            });
          }
          return;
        }
      });

      pi.on('agent_settled', async (_event, ctx) => {
        const endingLeafId = ctx.sessionManager.getLeafId();
        if (dependencies.isAutoExtractionEnabled?.() === false) {
          baselineLeafId = endingLeafId;
          return;
        }
        const sessionPath = ctx.sessionManager.getSessionFile();
        if (!endingLeafId || !sessionPath || endingLeafId === baselineLeafId) return;

        try {
          const context = await resolveMemoryContext(dependencies, ctx);
          await dependencies.enqueueAutomatic({
            profileId: dependencies.profileId,
            projectId: context.project.id,
            sourceSessionId: ctx.sessionManager.getSessionId(),
            sourceSessionPath: sessionPath,
            sourceKind: 'automatic',
            startingLeafId: baselineLeafId ?? undefined,
            endingLeafId,
            modelProvider: ctx.model?.provider,
            modelId: ctx.model?.id,
          });
          baselineLeafId = endingLeafId;
        } catch (error) {
          console.warn('[memory] extraction enqueue failed:', error instanceof Error ? error.message : error);
        }
      });

      pi.registerTool({
        name: 'memory',
        label: 'Memory',
        description: 'Search durable WebUI memory or explicitly save, update, and forget project/profile memories at the user\'s request.',
        promptSnippet: 'Search or explicitly mutate durable project/profile memory',
        promptGuidelines: [
          'Use memory mutations only when the user explicitly asks to remember, update, or forget something; background extraction handles ordinary automatic learning.',
          'Use memory search when the user asks what is remembered or when recalled context needs verification.',
        ],
        parameters: MemoryParameters,
        executionMode: 'sequential',
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const context = await resolveMemoryContext(dependencies, ctx);
          switch (params.operation) {
            case 'save': {
              if (!params.content || !params.category) throw new Error('Memory save requires content and category');
              const memory = dependencies.service.save(context, {
                content: params.content,
                category: params.category as MemoryCategory,
                scope: params.scope as MemoryScope | undefined,
                tags: params.tags,
                pinned: params.pinned,
                pinnedApplicability: params.pinnedApplicability as MemoryPinnedApplicability | undefined,
              });
              return textResult(`Saved ${memory.scope} memory ${memory.id}: ${memory.content}`, { memory });
            }
            case 'search': {
              if (!params.query) throw new Error('Memory search requires query');
              const memories = dependencies.service.search(
                context,
                params.query,
                params.scope as MemoryScope | undefined,
              );
              const text = memories.length
                ? memories.map((memory) => `${memory.id} [${memory.scope}/${memory.category}] ${memory.content}`).join('\n')
                : 'No matching memories found.';
              return textResult(text, { memories });
            }
            case 'update': {
              if (!params.id || params.expectedRevision === undefined) {
                throw new Error('Memory update requires id and expected revision');
              }
              const patch: MemoryPatch = {};
              if (params.content !== undefined) patch.content = params.content;
              if (params.category !== undefined) patch.category = params.category as MemoryCategory;
              if (params.tags !== undefined) patch.tags = params.tags;
              if (params.pinned !== undefined) patch.pinned = params.pinned;
              if (params.pinnedApplicability !== undefined) {
                patch.pinnedApplicability = params.pinnedApplicability as MemoryPinnedApplicability;
              }
              if (Object.keys(patch).length === 0) throw new Error('Memory update requires a change');
              const memory = dependencies.service.update(context, params.id, params.expectedRevision, patch);
              return textResult(`Updated memory ${memory.id}: ${memory.content}`, { memory });
            }
            case 'forget': {
              if (!params.id || params.expectedRevision === undefined) {
                throw new Error('Memory forget requires id and expected revision');
              }
              const memory = dependencies.service.forget(context, params.id, params.expectedRevision);
              return textResult(`Forgot memory ${memory.id}.`, { memory });
            }
          }
        },
      });
    },
  };
}

async function resolveMemoryContext(dependencies: MemoryExtensionDependencies, ctx: ExtensionContext) {
  return dependencies.service.resolveContext({
    profileId: dependencies.profileId,
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager.getSessionId(),
    sessionPath: ctx.sessionManager.getSessionFile(),
  });
}

function textResult(text: string, details: unknown) {
  return { content: [{ type: 'text' as const, text }], details };
}

function emitRecallSafely(dependencies: MemoryExtensionDependencies, event: MemoryRecallEvent): void {
  try {
    dependencies.onRecall?.(event);
  } catch (error) {
    console.warn('[memory] recall event failed:', errorName(error));
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
