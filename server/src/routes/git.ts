// server/src/routes/git.ts
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { completeSimple, type AssistantMessage, type TextContent } from '@earendil-works/pi-ai/compat';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import type { SessionActivityStore } from '../services/session-activity-store.js';
import { CommitMessagePromptStore, DEFAULT_COMMIT_MESSAGE_PROMPTS, type CommitMessagePrompts } from '../services/commit-message-prompt-store.js';
import type { PiSessionService } from '../services/session-manager.js';
import { resolveAllowedPath } from '../utils/path-security.js';

const execFileAsync = promisify(execFile);
export const MAX_SLASH_COMMAND_OUTPUT_BYTES = 256 * 1024;
const MAX_STATUS_FILES = 1_000;

class OversizedGitOutputError extends Error {
  constructor() {
    super(`The Git output is too large to show safely (limit: ${MAX_SLASH_COMMAND_OUTPUT_BYTES / 1024} KiB). Inspect it with Git in the terminal or another Git client.`);
  }
}

interface GitStatusFile {
  path: string;
  status: string;
}

type GitDiffScope = 'all' | 'staged' | 'unstaged';
type GitSyncCommand = 'push' | 'pull';

function isMaxBufferError(error: unknown) {
  return (error as { code?: string })?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    || (error instanceof Error && error.message.includes('maxBuffer length exceeded'));
}

async function resolveGitCwd(cwd: string | undefined): Promise<string> {
  return resolveAllowedPath(cwd || '.');
}

async function runGit(cwd: string, args: string[], maxBuffer = MAX_SLASH_COMMAND_OUTPUT_BYTES) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer });
    return stdout;
  } catch (error) {
    if (isMaxBufferError(error)) throw new OversizedGitOutputError();
    throw error;
  }
}

async function runGitWithOutput(cwd: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_SLASH_COMMAND_OUTPUT_BYTES,
    });
    return joinGitOutput(stdout, stderr);
  } catch (error) {
    if (isMaxBufferError(error)) throw new OversizedGitOutputError();
    throw error;
  }
}

async function ensureHasCommit(cwd: string) {
  try {
    await runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    throw new Error('No previous commit to amend');
  }
}

type GitChangeType = 'added' | 'modified' | 'deleted';

interface GitChangeRange {
  start: number;
  end: number;
  type: GitChangeType;
}

function parseCount(value: string | undefined) {
  return value === undefined ? 1 : Number(value);
}

function parseStatusFiles(status: string): GitStatusFile[] {
  const lines = status.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  if (lines.length > MAX_STATUS_FILES) throw new OversizedGitOutputError();
  return lines.map((line) => {
    const status = line.slice(0, 2).trim() || line.slice(0, 2);
    const rawPath = line.slice(3);
    const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() || rawPath : rawPath;
    return { path, status };
  });
}

function getStagedStatus(status: string): string {
  return status
    .split('\n')
    .filter((line) => line && line[0] !== ' ' && line[0] !== '?')
    .map((line) => `${line[0]}  ${line.slice(3)}`)
    .join('\n');
}

function describeArea(path: string) {
  const [first, second] = path.split('/');
  if (!second) return first;
  if (first === 'client' || first === 'server') return `${first}/${second}`;
  return first;
}

function joinHumanList(items: string[]) {
  if (items.length <= 1) return items[0] || 'changes';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function proposeCommitMessage(files: GitStatusFile[]) {
  const statuses = files.map((file) => file.status);
  const verb = commitVerbForStatuses(statuses);

  const areas = Array.from(new Set(files.map((file) => describeArea(file.path))));
  const shownAreas = areas.slice(0, 3);
  const suffix = areas.length > shownAreas.length ? ` and ${areas.length - shownAreas.length} more` : '';
  return `${verb} ${joinHumanList(shownAreas)}${suffix}`;
}

function commitVerbForStatuses(statuses: string[]): 'Add' | 'Remove' | 'Update' {
  if (statuses.every((status) => status.includes('D'))) return 'Remove';
  if (statuses.every((status) => status.includes('A') || status.includes('?'))) return 'Add';
  return 'Update';
}

function sanitizeBranchName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[/.-]+$/g, '')
    .replace(/^[/.]+/g, '')
    || 'changes';
}

function parseBranchName(name: string | undefined, files: GitStatusFile[]) {
  const requestedName = name?.trim();
  if (requestedName) return requestedName;
  if (!files.length) throw new Error('No git changes to suggest a branch name from');
  return sanitizeBranchName(proposeCommitMessage(files));
}

function textFromAssistantMessage(message: AssistantMessage) {
  return message.content
    .filter((item): item is TextContent => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function joinGitOutput(...parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean).join('\n\n');
}

async function getCombinedDiff(cwd: string, args: string[], maxBytes = MAX_SLASH_COMMAND_OUTPUT_BYTES) {
  const unstaged = await runGit(cwd, ['diff', ...args], maxBytes);
  const remainingBytes = maxBytes - Buffer.byteLength(unstaged);
  // Reserve the separator inserted by joinGitOutput when both scopes have content.
  if (remainingBytes <= 2) {
    const hasStagedChanges = await runGit(cwd, ['diff', '--cached', '--quiet']).then(() => false, () => true);
    if (hasStagedChanges) throw new OversizedGitOutputError();
    return unstaged;
  }
  const staged = await runGit(cwd, ['diff', '--cached', ...args], remainingBytes - 2);
  return joinGitOutput(unstaged, staged);
}

function parseDiffScope(scope: string | undefined): GitDiffScope {
  if (!scope || scope === 'all') return 'all';
  if (scope === 'staged' || scope === 'unstaged') return scope;
  throw new Error('Invalid diff scope. Use all, staged, or unstaged.');
}

function parseCommit(commit: string) {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error('Invalid commit ID.');
  return commit;
}

function getDiff(cwd: string, args: string[], scope: GitDiffScope, maxBytes = MAX_SLASH_COMMAND_OUTPUT_BYTES) {
  if (scope === 'staged') return runGit(cwd, ['diff', '--cached', ...args], maxBytes);
  if (scope === 'unstaged') return runGit(cwd, ['diff', ...args], maxBytes);
  return getCombinedDiff(cwd, args, maxBytes);
}

function branchPrompt(status: string, diff: string) {
  return `Generate one concise git branch name for these working tree changes.

Rules:
- Output only the branch name, with no markdown, quotes, explanation, or code block.
- Use lowercase words separated by hyphens or slashes.
- Prefer a useful prefix like feature/, fix/, refactor/, docs/, test/, or chore/ when it fits.
- Keep it under 60 characters.

Git status:
${status.trim() || '(empty)'}

Git diff:
${diff.trim() || '(empty)'}`;
}

function aiGenerationSessionId(prefix: string, cwd: string) {
  return `${prefix}:${createHash('sha256').update(cwd).digest('hex').slice(0, 32)}`;
}

function commitMessagePrompt(instructions: string, status: string, diff: string) {
  return `${instructions.trim()}

Git status:
--- BEGIN GIT STATUS ---
${status.trim() || '(empty)'}
--- END GIT STATUS ---

Git diff:
--- BEGIN GIT DIFF ---
${diff.trim() || '(empty)'}
--- END GIT DIFF ---`;
}

async function completeWithClientModel(sessionService: PiSessionService, clientId: string, unavailableMessage: string, request: Parameters<typeof completeSimple>[1], options: { maxTokens: number; sessionId: string; operation: string }) {
  const agentDir = await sessionService.getClientAgentDirForRoutes(clientId);
  return sessionService.runForegroundWithClientProfileProxy(clientId, async () => {
    const profile = await sessionService.getClientAgentProfile(clientId);
    const registry = ModelRegistry.create(
      AuthStorage.create(join(agentDir, 'auth.json')),
      join(agentDir, 'models.json'),
    );
    registry.refresh();
    const configuredModel = profile.automationProvider && profile.automationModel
      ? registry.find(profile.automationProvider, profile.automationModel)
      : undefined;
    const model = configuredModel || registry.getAvailable()[0];
    if (!model) throw new Error(unavailableMessage);
    console.info('[ai-automation] request', {
      operation: options.operation,
      clientId,
      profileId: profile.id,
      provider: model.provider,
      modelId: model.id,
      modelSource: configuredModel ? 'profile-automation' : 'first-available',
      sessionId: options.sessionId,
    });

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error);

    return completeSimple(model, request, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      maxTokens: options.maxTokens,
      sessionId: options.sessionId,
    });
  });
}

async function generateBranchNameWithAi(sessionService: PiSessionService, clientId: string, cwd: string, status: string, diff: string) {
  const response = await completeWithClientModel(sessionService, clientId, 'No available AI model configured for branch naming', {
    systemPrompt: 'You create safe, concise git branch names from code changes.',
    messages: [{ role: 'user', content: branchPrompt(status, diff), timestamp: Date.now() }],
    tools: [],
  }, {
    maxTokens: 32,
    operation: 'git-branch-name',
    sessionId: aiGenerationSessionId('branch-name', cwd),
  });

  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage || 'AI branch naming failed');
  }

  const name = sanitizeBranchName(textFromAssistantMessage(response).split(/\s+/)[0] || '');
  if (!name) throw new Error('AI did not return a branch name');
  return name;
}

async function generateCommitMessageWithAi(sessionService: PiSessionService, clientId: string, cwd: string, status: string, diff: string, prompts: CommitMessagePrompts) {
  const response = await completeWithClientModel(sessionService, clientId, 'No available AI model configured for commit message generation', {
    systemPrompt: prompts.systemPrompt,
    messages: [{ role: 'user', content: commitMessagePrompt(prompts.userPrompt, status, diff), timestamp: Date.now() }],
    tools: [],
  }, {
    maxTokens: 220,
    operation: 'git-commit-message',
    sessionId: aiGenerationSessionId('commit-message', cwd),
  });

  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage || 'AI commit message generation failed');
  }

  const message = textFromAssistantMessage(response).replace(/^```(?:text)?/i, '').replace(/```$/i, '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (!message) throw new Error('AI did not return a commit message');
  return message;
}

function parseChangedRanges(diff: string): Record<string, GitChangeRange[]> {
  const changes: Record<string, GitChangeRange[]> = {};
  let currentFile = '';

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim();
      currentFile = path.startsWith('b/') ? path.slice(2) : '';
      if (currentFile && !changes[currentFile]) changes[currentFile] = [];
      continue;
    }

    if (!currentFile) continue;

    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk) continue;

    const oldCount = parseCount(hunk[2]);
    const newStart = Number(hunk[3]);
    const newCount = parseCount(hunk[4]);

    if (newCount === 0) {
      changes[currentFile].push({
        start: Math.max(1, newStart),
        end: Math.max(1, newStart),
        type: 'deleted',
      });
      continue;
    }

    changes[currentFile].push({
      start: newStart,
      end: newStart + newCount - 1,
      type: oldCount === 0 ? 'added' : 'modified',
    });
  }

  return changes;
}

export interface GitRouteOptions {
  activityStore?: Pick<SessionActivityStore, 'recordCommit' | 'recordBranchDeleted'>;
  commitMessagePrompts?: Pick<CommitMessagePromptStore, 'get' | 'save'>;
}

function recordCommitActivity(options: GitRouteOptions, input: Parameters<SessionActivityStore['recordCommit']>[0]) {
  try {
    options.activityStore?.recordCommit(input);
  } catch (error) {
    console.warn('Failed to record session commit activity:', error);
  }
}

function recordBranchDeletedActivity(options: GitRouteOptions, input: Parameters<SessionActivityStore['recordBranchDeleted']>[0]) {
  try {
    options.activityStore?.recordBranchDeleted(input);
  } catch (error) {
    console.warn('Failed to record session branch deletion activity:', error);
  }
}

export async function gitRoutes(app: FastifyInstance, options: GitRouteOptions = {}) {
  app.get('/commit-message-prompts', async (req) => {
    const { cwd } = req.query as { cwd?: string };
    const resolvedCwd = await resolveGitCwd(cwd);
    return options.commitMessagePrompts?.get(resolvedCwd) || {
      global: {},
      project: {},
      effective: DEFAULT_COMMIT_MESSAGE_PROMPTS,
    };
  });

  app.put('/commit-message-prompts', async (req, reply) => {
    const body = (req.body || {}) as { cwd?: string; scope?: unknown; userPrompt?: unknown };
    if (body.scope !== 'global' && body.scope !== 'project') {
      return reply.status(400).send({ error: 'scope must be global or project' });
    }
    if (body.userPrompt === undefined) {
      return reply.status(400).send({ error: 'userPrompt must be provided' });
    }
    if (typeof body.userPrompt !== 'string') {
      return reply.status(400).send({ error: 'userPrompt must be a string' });
    }

    const resolvedCwd = await resolveGitCwd(body.cwd);
    return options.commitMessagePrompts?.save(body.scope, resolvedCwd, {
      userPrompt: body.userPrompt,
    }) || { global: {}, project: {}, effective: DEFAULT_COMMIT_MESSAGE_PROMPTS };
  });

  app.get('/status', async (req, reply) => {
    const { cwd, message, stagedOnly } = req.query as { cwd?: string; message?: string; stagedOnly?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    try {
      const [workingTreeStatus, output] = await Promise.all([
        runGit(resolvedCwd, ['status', '--porcelain']),
        runGit(resolvedCwd, ['status', '--short', '--branch']),
      ]);
      const files = parseStatusFiles(stagedOnly === 'true' ? getStagedStatus(workingTreeStatus) : workingTreeStatus);
      return {
        cwd: resolvedCwd,
        files,
        message: message?.trim() || (files.length ? proposeCommitMessage(files) : ''),
        output,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to run git status';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.get('/branches', async (req, reply) => {
    const { cwd } = req.query as { cwd?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    try {
      const [branchesOutput, current] = await Promise.all([
        runGit(resolvedCwd, ['branch', '--format=%(refname:short)']),
        runGit(resolvedCwd, ['branch', '--show-current']),
      ]);
      return {
        cwd: resolvedCwd,
        current: current.trim(),
        branches: branchesOutput.split('\n').map((branch) => branch.trim()).filter(Boolean),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to list git branches';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.get('/branch-name', async (req, reply) => {
    const { cwd, clientId } = req.query as { cwd?: string; clientId?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      const [status, diff] = await Promise.all([
        runGit(resolvedCwd, ['status', '--porcelain']),
        getCombinedDiff(resolvedCwd, ['--stat']),
      ]);
      const files = parseStatusFiles(status);
      if (!files.length) {
        return reply.status(400).send({ error: 'No git changes to suggest a branch name from' });
      }

      const name = await generateBranchNameWithAi(app.services.sessions, clientId, resolvedCwd, status, diff);
      return { cwd: resolvedCwd, name, files };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate git branch name';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.get('/commit-message', async (req, reply) => {
    const { cwd, clientId, stagedOnly } = req.query as { cwd?: string; clientId?: string; stagedOnly?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    if (!clientId) {
      return reply.status(400).send({ error: 'clientId is required' });
    }

    try {
      const onlyStaged = stagedOnly === 'true';
      const [workingTreeStatus, diff] = await Promise.all([
        runGit(resolvedCwd, ['status', '--porcelain']),
        onlyStaged ? runGit(resolvedCwd, ['diff', '--cached']) : getCombinedDiff(resolvedCwd, []),
      ]);
      const status = onlyStaged ? getStagedStatus(workingTreeStatus) : workingTreeStatus;
      const files = parseStatusFiles(status);
      if (!files.length) {
        return reply.status(400).send({ error: 'No git changes to generate a commit message from' });
      }

      const prompts = options.commitMessagePrompts?.get(resolvedCwd).effective || DEFAULT_COMMIT_MESSAGE_PROMPTS;
      const message = await generateCommitMessageWithAi(app.services.sessions, clientId, resolvedCwd, status, diff, prompts);
      return { cwd: resolvedCwd, message, files };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate commit message';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.post('/branch', async (req, reply) => {
    const body = (req.body || {}) as { cwd?: string; name?: string; baseBranch?: string };
    const resolvedCwd = await resolveGitCwd(body.cwd);

    try {
      const status = await runGit(resolvedCwd, ['status', '--porcelain']);
      const files = parseStatusFiles(status);
      const name = parseBranchName(body.name, files);
      const args = ['checkout', '-b', name];
      const baseBranch = body.baseBranch?.trim();
      if (baseBranch) args.push(baseBranch);
      const output = await runGit(resolvedCwd, args);
      return {
        cwd: resolvedCwd,
        name,
        baseBranch: baseBranch || undefined,
        files,
        output,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create git branch';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.post('/switch-branch', async (req, reply) => {
    const body = (req.body || {}) as { cwd?: string; name?: string; pull?: boolean; deleteOriginal?: boolean; sessionId?: string };
    const resolvedCwd = await resolveGitCwd(body.cwd);
    const name = body.name?.trim();

    if (!name) {
      return reply.status(400).send({ error: 'Branch name is required' });
    }

    try {
      const originalBranch = (await runGit(resolvedCwd, ['branch', '--show-current'])).trim();
      const originalCommit = originalBranch ? (await runGit(resolvedCwd, ['rev-parse', originalBranch])).trim() : '';
      const checkoutOutput = await runGit(resolvedCwd, ['checkout', name]);
      const pullOutput = body.pull ? await runGit(resolvedCwd, ['pull', '--ff-only']) : '';
      const shouldDeleteOriginal = body.deleteOriginal !== false && Boolean(originalBranch) && originalBranch !== name;
      const deleteOutput = shouldDeleteOriginal ? await runGit(resolvedCwd, ['branch', '-D', '--', originalBranch]) : '';

      if (shouldDeleteOriginal) {
        recordBranchDeletedActivity(options, {
          sessionId: body.sessionId,
          cwd: resolvedCwd,
          branch: originalBranch,
          commit: originalCommit,
        });
      }

      return {
        cwd: resolvedCwd,
        name,
        pulled: Boolean(body.pull),
        deletedBranch: shouldDeleteOriginal ? { name: originalBranch, commit: originalCommit } : undefined,
        output: joinGitOutput(checkoutOutput, pullOutput, deleteOutput),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to switch git branch';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  for (const command of ['push', 'pull'] satisfies GitSyncCommand[]) {
    app.post(`/${command}`, async (req, reply) => {
      const body = (req.body || {}) as { cwd?: string };
      const resolvedCwd = await resolveGitCwd(body.cwd);

      try {
        const output = await runGitWithOutput(resolvedCwd, [command]);
        return { cwd: resolvedCwd, output };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `Failed to run git ${command}`;
        return reply.status(400).send({ error: errorMessage });
      }
    });
  }

  app.post('/commit', async (req, reply) => {
    const body = (req.body || {}) as { cwd?: string; message?: string; sessionId?: string; stagedOnly?: boolean };
    const resolvedCwd = await resolveGitCwd(body.cwd);
    const message = body.message?.trim();

    if (!message) {
      return reply.status(400).send({ error: 'Commit message is required' });
    }

    try {
      const onlyStaged = body.stagedOnly === true;
      if (!onlyStaged) await runGit(resolvedCwd, ['add', '-A']);
      const workingTreeStatus = await runGit(resolvedCwd, ['status', '--porcelain']);
      const files = parseStatusFiles(onlyStaged ? getStagedStatus(workingTreeStatus) : workingTreeStatus);
      if (!files.length) {
        return reply.status(400).send({ error: 'No changes to commit' });
      }

      const output = await runGit(resolvedCwd, ['commit', '-m', message]);
      const commit = (await runGit(resolvedCwd, ['rev-parse', 'HEAD'])).trim();
      recordCommitActivity(options, { sessionId: body.sessionId, cwd: resolvedCwd, message, commit, files, mode: 'commit' });
      return {
        cwd: resolvedCwd,
        message,
        files,
        commit,
        output,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to run git commit';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.get('/amend-status', async (req, reply) => {
    const { cwd, message } = req.query as { cwd?: string; message?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    try {
      await ensureHasCommit(resolvedCwd);
      const [status, previousMessage] = await Promise.all([
        runGit(resolvedCwd, ['status', '--porcelain']),
        runGit(resolvedCwd, ['log', '-1', '--pretty=%B']),
      ]);
      return {
        cwd: resolvedCwd,
        files: parseStatusFiles(status),
        message: message?.trim() || previousMessage.trim(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to prepare git amend';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.post('/amend', async (req, reply) => {
    const body = (req.body || {}) as { cwd?: string; message?: string; sessionId?: string };
    const resolvedCwd = await resolveGitCwd(body.cwd);
    const message = body.message?.trim();

    if (!message) {
      return reply.status(400).send({ error: 'Commit message is required' });
    }

    try {
      await ensureHasCommit(resolvedCwd);
      await runGit(resolvedCwd, ['add', '-A']);
      const status = await runGit(resolvedCwd, ['status', '--porcelain']);
      const files = parseStatusFiles(status);
      const output = await runGit(resolvedCwd, ['commit', '--amend', '--allow-empty', '-m', message]);
      const commit = (await runGit(resolvedCwd, ['rev-parse', 'HEAD'])).trim();
      recordCommitActivity(options, { sessionId: body.sessionId, cwd: resolvedCwd, message, commit, files, mode: 'amend' });
      return {
        cwd: resolvedCwd,
        message,
        files,
        commit,
        output,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to run git amend';
      return reply.status(400).send({ error: errorMessage });
    }
  });

  app.get('/changes', async (req, reply) => {
    const { cwd } = req.query as { cwd?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    try {
      const diff = await getCombinedDiff(resolvedCwd, ['--unified=0']);
      return {
        cwd: resolvedCwd,
        changes: parseChangedRanges(diff),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run git diff';
      return reply.status(400).send({ error: message });
    }
  });

  app.get('/diff', async (req, reply) => {
    const { cwd, scope: rawScope, commit: rawCommit } = req.query as { cwd?: string; scope?: string; commit?: string };
    const resolvedCwd = await resolveGitCwd(cwd);

    try {
      const commit = rawCommit ? parseCommit(rawCommit) : undefined;
      // Generate the expensive payload first with a cumulative byte budget. Do not
      // start additional Git work when the diff is already too large to display.
      if (commit) {
        const diff = await runGit(resolvedCwd, ['show', '--format=', '--patch', commit]);
        const remainingBytes = MAX_SLASH_COMMAND_OUTPUT_BYTES - Buffer.byteLength(diff);
        const stat = remainingBytes > 0
          ? await runGit(resolvedCwd, ['show', '--format=', '--stat', commit], remainingBytes)
          : '';
        return { cwd: resolvedCwd, scope: `commit-${commit}`, commit, stat, diff };
      }

      const scope = parseDiffScope(rawScope);
      const diff = await getDiff(resolvedCwd, [], scope);
      const remainingBytes = MAX_SLASH_COMMAND_OUTPUT_BYTES - Buffer.byteLength(diff);
      const stat = remainingBytes > 0 ? await getDiff(resolvedCwd, ['--stat'], scope, remainingBytes) : '';
      return { cwd: resolvedCwd, scope, stat, diff };
    } catch (error) {
      if (error instanceof OversizedGitOutputError) {
        return {
          cwd: resolvedCwd,
          scope: rawCommit ? `commit-${rawCommit}` : rawScope || 'all',
          oversized: true,
          maxBytes: MAX_SLASH_COMMAND_OUTPUT_BYTES,
          message: error.message,
        };
      }
      const message = error instanceof Error ? error.message : 'Failed to run git diff';
      return reply.status(400).send({ error: message });
    }
  });
}
