import { apiRequest } from './apiClient';

type JsonRecord = Record<string, any>;

function queryString(values: Record<string, string | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== false && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

function requestJson(url: string): Promise<JsonRecord> {
  return apiRequest<JsonRecord>(url);
}

function postJson<TRequest extends Record<string, unknown>>(url: string, body: TRequest): Promise<JsonRecord> {
  return apiRequest<JsonRecord, TRequest>(url, {
    method: 'POST',
    body,
  });
}

export function createGitOperations() {
  return {
    getDiff(options: { cwd: string; commit?: string; scope?: string; path?: string }) {
      return requestJson(`/api/git/diff?${queryString(options)}`);
    },
    getStatus(options: { cwd: string; message?: string; stagedOnly?: boolean }) {
      return requestJson(`/api/git/status?${queryString(options)}`);
    },
    sync(command: 'push' | 'pull', cwd: string) {
      return postJson(`/api/git/${command}`, { cwd });
    },
    getBranches(cwd: string) {
      return requestJson(`/api/git/branches?${queryString({ cwd })}`);
    },
    generateBranchName(options: { cwd: string; clientId: string }) {
      return requestJson(`/api/git/branch-name?${queryString(options)}`);
    },
    createBranch(options: { cwd: string; name: string; baseBranch?: string }) {
      return postJson('/api/git/branch', options);
    },
    switchBranch(options: { cwd: string; name: string; pull: boolean; deleteOriginal: boolean; sessionId?: string }) {
      return postJson('/api/git/switch-branch', options);
    },
    getAmendStatus(options: { cwd: string; message?: string }) {
      return requestJson(`/api/git/amend-status?${queryString(options)}`);
    },
    generateCommitMessage(options: { cwd: string; clientId: string; stagedOnly?: boolean }) {
      return requestJson(`/api/git/commit-message?${queryString(options)}`);
    },
    saveCommit(mode: 'commit' | 'amend', options: { cwd: string; message: string; sessionId?: string; stagedOnly?: boolean }) {
      const { stagedOnly, ...body } = options;
      return postJson(mode === 'amend' ? '/api/git/amend' : '/api/git/commit', {
        ...body,
        ...(stagedOnly ? { stagedOnly: true } : {}),
      });
    },
  };
}
