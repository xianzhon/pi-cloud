import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import RoutinesPanel from './RoutinesPanel.vue';
const api = vi.hoisted(() => vi.fn());
vi.mock('../services/apiClient', () => ({ apiRequest: api }));
afterEach(() => vi.clearAllMocks());
it('creates a disabled routine and displays its execution history', async () => {
  i18n.global.locale.value = 'en';
  let saved: any;
  api.mockImplementation(async (url: string, options?: any) => {
    if (url === '/api/routines' && options?.method === 'POST') {
      saved = options.body;
      return { routine: { ...saved, id: 'r1' } };
    }
    if (url === '/api/routines')
      return { routines: [], latestRuns: [], serverTimeZone: 'Asia/Shanghai' };
    if (url.startsWith('/api/routines/runs'))
      return {
        runs: [
          {
            id: 'run1',
            snapshot: { name: 'Check CI' },
            status: 'failed',
            queuedAt: '2026-01-01T00:00:00Z',
            error: 'provider offline',
            summary: '',
            delivery: { status: 'failed', error: 'webhook offline' },
          },
        ],
      };
    if (url === '/api/sessions/agent-profiles')
      return { profiles: [{ id: 'default', label: 'Default' }] };
    if (url.endsWith('/models'))
      return { models: [{ provider: 'p', id: 'm' }] };
    if (url.endsWith('/notification-channels')) return { channels: [] };
    if (url === '/api/sessions/project-path') return { projectPath: '/tmp' };
    throw new Error(url);
  });
  const w = mount(RoutinesPanel);
  await flushPromises();
  expect(w.text()).toContain('provider offline');
  expect(w.text()).toContain('Asia/Shanghai');
  await w.get('[data-test="add"]').trigger('click');
  await flushPromises();
  await w.get('[data-test="name"]').setValue('Check CI');
  await w.get('[data-test="prompt"]').setValue('Check the latest CI');
  await w.get('form').trigger('submit');
  await flushPromises();
  expect(saved.enabled).toBe(false);
  expect(saved.projectPath).toBe('/tmp');
  expect(saved.prompt).toBe('Check the latest CI');
  w.unmount();
});

it('keeps active routine controls disabled when its latest run is outside the history page', async () => {
  i18n.global.locale.value = 'en';
  const routine = {
    id: 'r1',
    name: 'Check CI',
    enabled: true,
    projectPath: '/tmp',
    schedule: { kind: 'daily', time: '08:00' },
    nextRunAt: null,
  };
  api.mockImplementation(async (url: string) => {
    if (url === '/api/routines')
      return {
        routines: [routine],
        latestRuns: [{ id: 'active', routineId: 'r1', status: 'running' }],
        serverTimeZone: 'Asia/Shanghai',
      };
    if (url.startsWith('/api/routines/runs')) return { runs: [] };
    if (url === '/api/sessions/agent-profiles')
      return { profiles: [{ id: 'default' }] };
    if (url.endsWith('/notification-channels')) return { channels: [] };
    if (url === '/api/sessions/project-path') return { projectPath: '/tmp' };
    throw new Error(url);
  });
  const w = mount(RoutinesPanel);
  await flushPromises();
  const buttons = w.get('.routine-card').findAll('button');
  expect(
    buttons.find((b) => b.text() === 'Run now')!.attributes('disabled'),
  ).toBeDefined();
  expect(
    buttons.find((b) => b.text() === 'Delete')!.attributes('disabled'),
  ).toBeDefined();
  expect(w.get('.routine-card').text()).toContain('Last result: Running');
  w.unmount();
});

it('ignores an older history-page response when the user advances again', async () => {
  i18n.global.locale.value = 'en';
  let resolvePage!: (value: unknown) => void;
  const records = (name: string) =>
    Array.from({ length: 20 }, (_, i) => ({
      id: name + i,
      snapshot: { name },
      status: 'succeeded',
      queuedAt: '2026-01-01T00:00:00Z',
      summary: '',
    }));
  api.mockImplementation(async (url: string) => {
    if (url === '/api/routines')
      return { routines: [], latestRuns: [], serverTimeZone: 'UTC' };
    if (url.includes('/runs?offset=0')) return { runs: records('Initial') };
    if (url.includes('/runs?offset=20'))
      return new Promise((resolve) => {
        resolvePage = resolve;
      });
    if (url.includes('/runs?offset=40'))
      return { runs: records('Newest page') };
    if (url === '/api/sessions/agent-profiles') return { profiles: [] };
    if (url.endsWith('/notification-channels')) return { channels: [] };
    if (url === '/api/sessions/project-path') return { projectPath: '/tmp' };
    throw new Error(url);
  });
  const w = mount(RoutinesPanel);
  await flushPromises();
  await w.get('.pagination').findAll('button')[1].trigger('click');
  await w.get('.pagination').findAll('button')[1].trigger('click');
  resolvePage({ runs: records('Stale page') });
  await flushPromises();
  try {
    expect(w.text()).toContain('Newest page');
    expect(w.text()).not.toContain('Stale page');
  } finally {
    w.unmount();
  }
});
