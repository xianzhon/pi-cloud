import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpPanel from './McpPanel.vue';
import CustomSelect from './CustomSelect.vue';
import McpServerEditor from './McpServerEditor.vue';

enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());
const inventory = { servers: [{ name: 'docs', source: '/profile/mcp.json', editable: true, enabled: true, profileEnabled: true, transport: 'stdio', config: { command: 'node', args: ['server.js'] }, cachedAt: 10, secretFields: ['env'], tools: [{ name: 'read-doc', description: 'Read docs' }, { name: 'delete_doc', description: 'Delete' }] }] };
describe('MCP browser configuration', () => {
  it('shows collapsed read-only tools and toggles whole servers in sessions', async () => {
    const calls: { url: string; body?: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      calls.push({ url: String(url), body: options?.body && JSON.parse(options.body) });
      return new Response(JSON.stringify(inventory));
    }));
    const wrapper = mount(McpPanel, { props: { sessionId: 'session-1', clientId: 'client-1' } });
    await flushPromises();
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
    expect(wrapper.findAll('[data-tool]')).toHaveLength(2);
    expect(wrapper.find('input[type=checkbox]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="add-mcp-server"]').exists()).toBe(false);
    await wrapper.find('[role=switch]').trigger('click'); await flushPromises();
    expect(calls.find(c => c.body)).toEqual({ url: '/api/sessions/session-1/mcp', body: { clientId: 'client-1', changes: [{ server: 'docs', enabled: false }] } });
  });
  it('does not allow session re-enabling a profile-disabled server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ servers: [{ ...inventory.servers[0], enabled: false, profileEnabled: false }] }))));
    const wrapper = mount(McpPanel, { props: { sessionId: 's1', clientId: 'c1' } });
    await flushPromises();
    expect(wrapper.find('[role=switch]').attributes('disabled')).toBeDefined();
  });
  it('uses custom profile selection, ignores stale inventory and adds an HTTP server in a modal', async () => {
    let stale: ((value: Response) => void) | undefined;
    const requests: { url: string; body?: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const path = String(url); requests.push({ url: path, body: options?.body && JSON.parse(options.body) });
      if (path === '/api/sessions/agent-profiles') return new Response(JSON.stringify({ profiles: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }));
      if (path.includes('/one/mcp')) return new Promise<Response>(resolve => { stale = resolve; });
      return new Response(JSON.stringify({ servers: [] }));
    }));
    const wrapper = mount(McpPanel, { global: { stubs: { Teleport: true } } }); await flushPromises();
    expect(wrapper.find('select').exists()).toBe(false);
    wrapper.findComponent(CustomSelect).vm.$emit('update:modelValue', 'two'); await flushPromises();
    stale?.(new Response(JSON.stringify(inventory))); await flushPromises();
    expect(wrapper.find('[data-tool]').exists()).toBe(false);
    await wrapper.find('[data-testid="add-mcp-server"]').trigger('click');
    expect(wrapper.find('[role=dialog]').exists()).toBe(true);
    await wrapper.find('[name="mcp-server-name"]').setValue('remote');
    const editor = wrapper.findComponent(McpServerEditor);
    await editor.findAll('.connection-options button')[1].trigger('click');
    await wrapper.find('[name="mcp-url"]').setValue('https://example.com/mcp');
    await wrapper.find('form').trigger('submit'); await flushPromises();
    expect(requests.find(r => r.body?.config)).toEqual({ url: '/api/sessions/agent-profiles/two/mcp/servers/remote', body: { config: { url: 'https://example.com/mcp' } } });
    expect(wrapper.find('[role=dialog]').exists()).toBe(false);
  });
  it('sends profile server changes without enumerating tools', async () => {
    const fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('agent-profiles') ? { profiles: [{ id: 'one' }] } : inventory)));
    vi.stubGlobal('fetch', fetch);
    const wrapper = mount(McpPanel); await flushPromises();
    await wrapper.find('[role=switch]').trigger('click'); await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith('/api/sessions/agent-profiles/one/mcp/servers', expect.objectContaining({ body: JSON.stringify({ changes: [{ server: 'docs', enabled: false }] }) }));
  });
});
