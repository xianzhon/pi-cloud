import { ref } from 'vue';
import type { ProjectTask } from '../types/projectTask';

export type GitProvider = 'github' | 'gitea';
export interface GitHostingSettingsView { serverUrl: string; tokenConfigured: boolean; proxyUrl?: string; }
export interface GitHostingIssuePreview { provider?: GitProvider; owner: string; repo: string; title: string; body: string; }
export interface GitHostingPrPreview { cwd: string; provider?: GitProvider; owner: string; repo: string; targetBranch: string; sourceBranch: string; generatedBranch: boolean; hasChanges: boolean; files: Array<{ status: string; path: string }>; commitMessage: string; title: string; body: string; stateToken: string; }

const settings = ref<GitHostingSettingsView>({ serverUrl: '', tokenConfigured: false });
const githubSettings = ref<GitHostingSettingsView>({ serverUrl: 'https://github.com', tokenConfigured: false });

type GitSettingsResponse = { settings: GitHostingSettingsView; githubSettings?: GitHostingSettingsView };

export function useGitHosting() {
  async function loadSettings() {
    applySettings(await request<GitSettingsResponse>('/api/git-hosting/settings'));
  }

  async function saveSettings(input: { serverUrl?: string; token?: string }) {
    applySettings(await request<GitSettingsResponse>('/api/git-hosting/settings', 'POST', input));
  }

  async function clearSettings() {
    applySettings(await request<GitSettingsResponse>('/api/git-hosting/settings', 'DELETE'));
  }

  async function testConnection(input?: { serverUrl?: string; token?: string }) {
    return request<{ success: boolean }>('/api/git-hosting/test', 'POST', input || {});
  }

  async function saveGithubSettings(input: { serverUrl?: string; token?: string }) {
    applySettings(await request<GitSettingsResponse>('/api/git-hosting/github/settings', 'POST', input));
  }

  async function clearGithubSettings() {
    applySettings(await request<GitSettingsResponse>('/api/git-hosting/github/settings', 'DELETE'));
  }

  async function testGithubConnection(input?: { serverUrl?: string; token?: string }) {
    return request<{ success: boolean }>('/api/git-hosting/github/test', 'POST', input || {});
  }

  async function saveGithubProxyUrl(proxyUrl: string) {
    applySettings(await request<GitSettingsResponse>('/api/git-hosting/github/proxy', 'POST', { proxyUrl }));
  }

  async function testGithubProxy(proxyUrl?: string) {
    return request<{ ok: boolean }>('/api/git-hosting/github/proxy/test', 'POST', { proxyUrl: proxyUrl ?? githubSettings.value.proxyUrl ?? '' });
  }

  async function previewIssue(taskId: string) {
    return (await request<{ preview: GitHostingIssuePreview }>(`/api/git-hosting/tasks/${encodeURIComponent(taskId)}/issue/preview`, 'POST')).preview;
  }

  async function createIssue(taskId: string, input: GitHostingIssuePreview) {
    return (await request<{ task: ProjectTask }>(`/api/git-hosting/tasks/${encodeURIComponent(taskId)}/issue`, 'POST', input)).task;
  }

  async function generateIssueContent(clientId: string, taskId: string, preview: GitHostingIssuePreview) {
    return (await request<{ content: { title: string; body: string } }>(`/api/git-hosting/tasks/${encodeURIComponent(taskId)}/issue/generate`, 'POST', { clientId, preview })).content;
  }

  async function previewPr(cwd: string, targetBranch: string) {
    return (await request<{ preview: GitHostingPrPreview }>('/api/git-hosting/pr/preview', 'POST', { cwd, targetBranch })).preview;
  }

  async function generatePrContent(clientId: string, preview: GitHostingPrPreview, sessionId?: string) {
    return (await request<{ content: { title: string; body: string } }>('/api/git-hosting/pr/generate', 'POST', { clientId, preview, sessionId })).content;
  }

  async function createPr(input: { preview: GitHostingPrPreview; title: string; body: string; commitMessage: string; sessionId?: string }) {
    return request<{ pullRequest: { number: number; url: string } }>('/api/git-hosting/pr/create', 'POST', input);
  }

  return { settings, githubSettings, loadSettings, saveSettings, clearSettings, testConnection, saveGithubSettings, clearGithubSettings, testGithubConnection, saveGithubProxyUrl, testGithubProxy, previewIssue, createIssue, generateIssueContent, previewPr, generatePrContent, createPr };
}

function applySettings(data: GitSettingsResponse): void {
  settings.value = data.settings;
  if (data.githubSettings) githubSettings.value = data.githubSettings;
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Git hosting request failed (${response.status})`);
  return data as T;
}

