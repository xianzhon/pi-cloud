import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import ManagedSkillsPanel from './ManagedSkillsPanel.vue';

const content = '---\nname: example\ndescription: Example\n---\n# Example';
afterEach(() => vi.unstubAllGlobals());

it('edits a shared skill and reports changes to the existing picker', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: 'example', content }] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ name: 'example' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: 'example', content }] }) });
  vi.stubGlobal('fetch', fetch);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('.skill-row button').trigger('click');
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(content);
  await wrapper.find('textarea').setValue(`${content}\nUpdate`);
  await wrapper.findAll('form')[0].trigger('submit');
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith('/api/sessions/managed-skills/example', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ content: `${content}\nUpdate` }) }));
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('shows clone failures without claiming success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'GitHub clone failed: repository unavailable' }) }));
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('input[type="url"]').setValue('https://github.com/owner/repo');
  await wrapper.findAll('form')[1].trigger('submit');
  await flushPromises();
  expect(wrapper.find('[role="alert"]').text()).toContain('repository unavailable');
  expect(wrapper.emitted('changed')).toBeUndefined();
});
