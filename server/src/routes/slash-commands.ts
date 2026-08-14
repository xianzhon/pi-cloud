import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DefaultResourceLoader, RpcClient, getAgentDir, getPackageDir, type Skill } from '@earendil-works/pi-coding-agent';
import { sessionService } from '../services/session-manager.js';

type SlashCommandCategory = 'skill' | 'extension' | 'built-in';
type PiCommandSource = 'extension' | 'prompt' | 'skill';
type LoadCommandsContext = { clientId?: string; sessionId?: string };

interface SlashCommandItem {
  id: string;
  label: string;
  insertText: string;
  description: string;
  category: SlashCommandCategory;
  aliases?: string[];
}

interface PiSlashCommand {
  name: string;
  description?: string;
  source: PiCommandSource;
}

const COMMAND_CACHE_TTL_MS = 60_000;
const commandCache = new Map<string, { expiresAt: number; commands: SlashCommandItem[]; promise?: Promise<SlashCommandItem[]> }>();

const builtInCommands: SlashCommandItem[] = [
  {
    id: 'diff',
    label: '/diff',
    insertText: '/diff ',
    description: 'Show current git working tree changes for this session.',
    category: 'built-in',
    aliases: ['changes', 'git diff'],
  },
  {
    id: 'status',
    label: '/status',
    insertText: '/status ',
    description: 'Show git status for this session.',
    category: 'built-in',
    aliases: ['git status', 'working tree'],
  },
  {
    id: 'commit',
    label: '/commit',
    insertText: '/commit ',
    description: 'Preview changed files and commit them after confirmation.',
    category: 'built-in',
    aliases: ['git commit', 'save changes'],
  },
  {
    id: 'amend',
    label: '/amend',
    insertText: '/amend ',
    description: 'Preview changed files and amend the previous commit after confirmation.',
    category: 'built-in',
    aliases: ['git amend', 'amend commit'],
  },
  {
    id: 'pr',
    label: '/pr',
    insertText: '/pr ',
    description: 'Preview, push, and create a GitHub or Gitea pull request from the current branch.',
    category: 'built-in',
    aliases: ['pull request', 'github pr', 'gitea pr'],
  },
  {
    id: 'push',
    label: '/push',
    insertText: '/push ',
    description: 'Run git push for this session.',
    category: 'built-in',
    aliases: ['git push'],
  },
  {
    id: 'pull',
    label: '/pull',
    insertText: '/pull ',
    description: 'Run git pull for this session.',
    category: 'built-in',
    aliases: ['git pull'],
  },
  {
    id: 'branch',
    label: '/branch',
    insertText: '/branch ',
    description: 'Open git branch actions, or create a branch with a name and optional base branch.',
    category: 'built-in',
    aliases: ['git branch', 'checkout branch', 'new branch'],
  },
  {
    id: 'model',
    label: '/model',
    insertText: '/model ',
    description: 'Select the active model for this session.',
    category: 'built-in',
    aliases: ['models', 'change model', 'select model'],
  },
  {
    id: 'skills',
    label: '/skills',
    insertText: '/skills ',
    description: 'Configure enabled or disabled skills for this session.',
    category: 'built-in',
    aliases: ['skill config', 'enable skills', 'disable skills'],
  },
  {
    id: 'tree',
    label: '/tree',
    insertText: '/tree ',
    description: 'Navigate the current session tree and continue from an earlier point.',
    category: 'built-in',
    aliases: ['session tree', 'branch', 'history'],
  },
  {
    id: 'session',
    label: '/session',
    insertText: '/session ',
    description: 'Show current session file, message, token, and cost details.',
    category: 'built-in',
    aliases: ['session info', 'stats', 'tokens', 'cost'],
  },
  {
    id: 'compact',
    label: '/compact',
    insertText: '/compact ',
    description: 'Manually compact the current session, optionally with custom instructions.',
    category: 'built-in',
    aliases: ['compaction', 'summarize context', 'context'],
  },
  {
    id: 'summary',
    label: '/summary',
    insertText: '/summary ',
    description: 'Summarize the current session and copy the summary to the system clipboard.',
    category: 'built-in',
    aliases: ['summarize', 'notes', 'session summary', 'context summary'],
  },
  {
    id: 'changelog',
    label: '/changelog',
    insertText: '/changelog ',
    description: 'Show the changelog for recent Pi WebUI versions.',
    category: 'built-in',
    aliases: ['changes', 'release notes', 'version'],
  },
];

function aliasesForName(name: string) {
  const withoutSkillPrefix = name.startsWith('skill:') ? name.slice('skill:'.length) : name;
  return Array.from(new Set([withoutSkillPrefix, ...withoutSkillPrefix.split('-').filter(Boolean)]));
}

function commandFromSkill(skill: Skill): SlashCommandItem {
  return {
    id: `skill-${skill.name}`,
    label: `skill:${skill.name}`,
    insertText: `/skill:${skill.name} `,
    description: skill.description,
    category: 'skill',
    aliases: aliasesForName(skill.name),
  };
}

function categoryForPiCommand(source: PiCommandSource): SlashCommandCategory {
  if (source === 'skill') return 'skill';
  if (source === 'extension') return 'extension';
  return 'built-in';
}

function idForPiCommand(command: PiSlashCommand) {
  const normalizedName = command.name.startsWith('skill:') ? command.name.slice('skill:'.length) : command.name;
  return `${command.source}-${normalizedName}`;
}

function commandFromPiCommand(command: PiSlashCommand): SlashCommandItem {
  return {
    id: idForPiCommand(command),
    label: command.name,
    insertText: `/${command.name} `,
    description: command.description || `Run /${command.name}`,
    category: categoryForPiCommand(command.source),
    aliases: aliasesForName(command.name),
  };
}

function getCliPath(): string {
  return join(getPackageDir(), 'dist', 'cli.js');
}

async function getContextAgentDir(context?: LoadCommandsContext): Promise<string> {
  if (!context?.clientId) return getAgentDir();
  return sessionService.getClientAgentDirForRoutes(context.clientId);
}

async function loadCanonicalCommandsForAgentDir(agentDir: string): Promise<SlashCommandItem[]> {
  const client = new RpcClient({
    cwd: process.cwd(),
    cliPath: getCliPath(),
    env: { PI_CODING_AGENT_DIR: agentDir },
  });

  try {
    await client.start();
    const commands = (await client.getCommands()) as PiSlashCommand[];
    return commands
      .filter((command) => command.source !== 'extension')
      .map(commandFromPiCommand);
  } finally {
    await client.stop();
  }
}

async function loadSkillCommandsForAgentDir(agentDir: string): Promise<SlashCommandItem[]> {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
  });

  await loader.reload();
  const { skills } = loader.getSkills();
  return skills.map(commandFromSkill);
}

async function loadCachedBaseCommands(agentDir: string): Promise<SlashCommandItem[]> {
  if (process.env.NODE_ENV === 'test') {
    try {
      return await loadCanonicalCommandsForAgentDir(agentDir);
    } catch {
      return loadSkillCommandsForAgentDir(agentDir);
    }
  }

  const now = Date.now();
  const cached = commandCache.get(agentDir);
  if (cached && cached.expiresAt > now) return cached.commands;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    try {
      return await loadCanonicalCommandsForAgentDir(agentDir);
    } catch {
      return loadSkillCommandsForAgentDir(agentDir);
    }
  })();
  commandCache.set(agentDir, { expiresAt: now + COMMAND_CACHE_TTL_MS, commands: cached?.commands || [], promise });

  try {
    const commands = await promise;
    commandCache.set(agentDir, { expiresAt: Date.now() + COMMAND_CACHE_TTL_MS, commands });
    return commands;
  } catch (error) {
    commandCache.delete(agentDir);
    throw error;
  }
}

function mergeCommands(...groups: SlashCommandItem[][]) {
  const byId = new Map<string, SlashCommandItem>();
  for (const group of groups) {
    for (const command of group) {
      byId.set(command.id, command);
    }
  }
  return Array.from(byId.values());
}

async function filterSessionSkillCommands(
  commands: SlashCommandItem[],
  context?: LoadCommandsContext,
): Promise<SlashCommandItem[]> {
  if (!context?.clientId || !context.sessionId) {
    return commands.sort((a, b) => a.label.localeCompare(b.label));
  }

  const allowedSkillNames = new Set(await sessionService.listSessionAvailableSkillNames(context.clientId, context.sessionId));
  return commands
    .filter((command) => command.category !== 'skill' || allowedSkillNames.has(command.label.replace(/^skill:/, '')))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function loadCommands(context?: LoadCommandsContext): Promise<SlashCommandItem[]> {
  const agentDir = await getContextAgentDir(context);
  const commands = mergeCommands(await loadCachedBaseCommands(agentDir), builtInCommands);
  return filterSessionSkillCommands(commands, context);
}

export async function slashCommandRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { clientId, sessionId } = req.query as { clientId?: string; sessionId?: string };
    return { commands: await loadCommands({ clientId, sessionId }) };
  });
}
