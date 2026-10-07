import { defineTool, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { ProjectTaskStore } from '../services/project-task-store.js';

interface TaskInboxDependencies {
  profileId: string;
  store: Pick<ProjectTaskStore, 'create'>;
  listModels(): Promise<Array<{ provider: string; id: string; current?: boolean }>>;
}

export function createTaskInboxExtension(dependencies: TaskInboxDependencies): InlineExtension {
  return {
    name: 'pi-cloud-task-inbox',
    factory(pi) {
      pi.registerTool(defineTool({
        name: 'create_task',
        label: 'Create inbox task',
        description: 'Save a new waiting task in the Task Inbox for the current project, without starting it or changing this session. Use when the user asks to save or create a task. Discuss vague requirements and clarify important unknowns with the user first. Summarize the agreed scope, context, constraints, and acceptance criteria in a self-contained prompt; do not invent requirements. Tasks use this profile’s default model and all skills, not this session’s model or skill overrides.',
        parameters: Type.Object({
          title: Type.String({ description: 'Concise, specific task title', minLength: 1 }),
          prompt: Type.String({ description: 'Self-contained instructions for the future coding session based on the discussion', minLength: 1 }),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
          signal?.throwIfAborted();
          const models = await dependencies.listModels();
          const model = models.find((item) => item.current) || models[0];
          if (!model) throw new Error('No available model configured for task creation');
          signal?.throwIfAborted();
          // Persist the same launch snapshot as the task editor, without inheriting session overrides.
          const task = dependencies.store.create({
            projectPath: ctx.cwd,
            title: params.title,
            prompt: params.prompt,
            notes: '',
            agentProfileId: dependencies.profileId,
            modelProvider: model.provider,
            modelId: model.id,
            skillMode: 'all',
            skills: [],
            presetId: null,
            worktree: { mode: 'none' },
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({ task }) }],
            details: { task },
          };
        },
      }));
    },
  };
}
