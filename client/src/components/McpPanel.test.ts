import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpPanel from './McpPanel.vue';

enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());
const inventory = { servers: [{ name: 'docs', source: '/profile/mcp.json', editable: true, transport: 'stdio', config: { command: 'node', args: ['server.js'] }, cachedAt: 10, secretFields: ['env'], tools: [{ name: 'read-doc', description: 'Read docs', exposure: 'proxy', profileEnabled: true, sessionEnabled: true, enabled: true }, { name: 'delete_doc', description: 'Delete', exposure: 'direct', profileEnabled: false, sessionEnabled: true, enabled: false }] }] };
describe('MCP browser configuration', () => {
  it('restricts session tools without allowing profile-disabled tools or server edits', async () => {
    const calls: { url: string; body?: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), body: options?.body && JSON.parse(options.body) });
      return new Response(JSON.stringify(inventory));
    }));
    const wrapper = mount(McpPanel, { props: { sessionId: 'session-1', clientId: 'client-1' } });
    await flushPromises();
    expect(wrapper.text()).toContain('read-doc');
    expect(wrapper.find('[data-tool="delete_doc"] input').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="add-mcp-server"]').exists()).toBe(false);
    await wrapper.find('[data-tool="read-doc"] input').setValue(false); await flushPromises();
    expect(calls.find(c => c.body)?.body).toEqual({ clientId: 'client-1', changes: [{ server: 'docs', tool: 'read-doc', enabled: false }] });
    expect(calls.find(c => c.body)?.url).toBe('/api/sessions/session-1/mcp');
  });
  it('adds an HTTP server and ignores stale inventory when switching profiles', async () => {
    let stale: ((value: Response) => void) | undefined;
    const requests: { url: string; body?: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const path = String(url); requests.push({ url: path, body: options?.body && JSON.parse(options.body) });
      if (path === '/api/sessions/agent-profiles') return new Response(JSON.stringify({ profiles: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }));
      if (path.includes('/one/mcp')) return new Promise<Response>(resolve => { stale = resolve; });
      return new Response(JSON.stringify({ servers: [] }));
    }));
    const wrapper = mount(McpPanel); await flushPromises();
    await wrapper.find('select').setValue('two'); await flushPromises();
    stale?.(new Response(JSON.stringify(inventory))); await flushPromises();
    expect(wrapper.text()).not.toContain('read-doc');
    await wrapper.find('[data-testid="add-mcp-server"]').trigger('click');
    await wrapper.find('[name="mcp-server-name"]').setValue('remote');
    await wrapper.find('[name="mcp-server-config"]').setValue(JSON.stringify({ url: 'https://example.com/mcp' }));
    await wrapper.find('form').trigger('submit'); await flushPromises();
    expect(requests.find(r => r.body?.config)).toEqual({ url: '/api/sessions/agent-profiles/two/mcp/servers/remote', body: { config: { url: 'https://example.com/mcp' } } });
  });
});
