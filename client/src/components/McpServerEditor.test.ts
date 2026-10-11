import { mount, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, expect, it } from 'vitest';
import McpServerEditor from './McpServerEditor.vue';

enableAutoUnmount(afterEach);
function editor(server?: { name: string; config: Record<string, unknown>; secretFields?: string[] }) {
  return mount(McpServerEditor, { props: { server, busy: false, error: '' }, global: { stubs: { Teleport: true } } });
}
it('edits connection fields while preserving advanced options and omitting hidden credentials', async () => {
  const wrapper = editor({ name: 'docs', config: { command: 'node', args: ['file with spaces.js'], directTools: true }, secretFields: ['env'] });
  expect(wrapper.find('[name=mcp-server-name]').attributes('disabled')).toBeDefined();
  await wrapper.find('[name=mcp-command]').setValue('bun');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('save')?.[0]).toEqual(['docs', { command: 'bun', args: ['file with spaces.js'], directTools: true }]);
});
it('switches transports without submitting conflicting connection fields', async () => {
  const wrapper = editor({ name: 'docs', config: { command: 'node', args: ['server.js'] } });
  await wrapper.findAll('.connection-options button')[1].trigger('click');
  await wrapper.find('[name=mcp-url]').setValue('https://example.com/mcp');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('save')?.[0]).toEqual(['docs', { url: 'https://example.com/mcp' }]);
});
it('keeps invalid JSON and URL errors inline without closing', async () => {
  const wrapper = editor();
  await wrapper.find('[name=mcp-server-name]').setValue('remote');
  await wrapper.findAll('.connection-options button')[1].trigger('click');
  await wrapper.find('[name=mcp-url]').setValue('file:///tmp/server');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.find('[role=alert]').exists()).toBe(true);
  expect(wrapper.emitted('save')).toBeUndefined();
  await wrapper.find('[name=mcp-url]').setValue('https://example.com/mcp');
  await wrapper.find('[name=mcp-server-config]').setValue('[]');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('save')).toBeUndefined();
  await wrapper.find('[name=mcp-server-config]').setValue('{}');
  await wrapper.find('form').trigger('submit');
  expect(wrapper.emitted('save')).toHaveLength(1);
});
it('prevents submission and dismissal while saving', async () => {
  const wrapper = editor({ name: 'docs', config: { command: 'node' } });
  await wrapper.setProps({ busy: true });
  await wrapper.find('form').trigger('submit');
  await wrapper.find('.mcp-editor-backdrop').trigger('keydown', { key: 'Escape' });
  expect(wrapper.emitted('save')).toBeUndefined();
  expect(wrapper.emitted('close')).toBeUndefined();
});
