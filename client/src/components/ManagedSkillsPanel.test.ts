import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import ManagedSkillsPanel from './ManagedSkillsPanel.vue';

const content = '---\nname: example\ndescription: Example\n---\n# Example';
afterEach(() => vi.unstubAllGlobals());

it('inserts a valid sample skill and keeps its YAML name in sync until edited', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ name: 'my-skill' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) });
  vi.stubGlobal('fetch', fetch);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('.skill-sample-btn').trigger('click');
  expect((wrapper.find('input').element as HTMLInputElement).value).toBe('example');
  await wrapper.find('input').setValue('my-skill');
  const sample = (wrapper.find('textarea').element as HTMLTextAreaElement).value;
  expect(sample).toMatch(/^---\nname: my-skill\ndescription: .+\n---\n/);
  expect(sample).toContain('## Instructions');
  await wrapper.findAll('form')[0].trigger('submit');
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith('/api/sessions/managed-skills', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'my-skill', content: sample }) }));
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('does not overwrite customized sample content when the name changes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ skills: [] }) }));
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('.skill-sample-btn').trigger('click');
  await wrapper.find('textarea').setValue('Custom content');
  await wrapper.find('input').setValue('other-skill');
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('Custom content');
});

it('edits a shared skill and reports changes to the existing picker', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: 'example', content }] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ name: 'example' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: 'example', content }] }) });
  vi.stubGlobal('fetch', fetch);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  expect(wrapper.find('.skill-row button[aria-label="Edit"] svg').exists()).toBe(true);
  expect(wrapper.find('.skill-row button[aria-label="Delete"] svg').exists()).toBe(true);
  await wrapper.find('.skill-row button[aria-label="Edit"]').trigger('click');
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(content);
  await wrapper.find('textarea').setValue(`${content}\nUpdate`);
  await wrapper.findAll('form')[0].trigger('submit');
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith('/api/sessions/managed-skills/example', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ content: `${content}\nUpdate` }) }));
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('confirms before deleting a shared skill and reports a successful change', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: 'example', content }] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ name: 'example' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) });
  vi.stubGlobal('fetch', fetch);
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('.skill-row button[aria-label="Delete"]').trigger('click');
  expect(fetch).toHaveBeenCalledTimes(1);
  await wrapper.find('.skill-row button[aria-label="Delete"]').trigger('click');
  await flushPromises();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('example'));
  expect(fetch).toHaveBeenCalledWith('/api/sessions/managed-skills/example', expect.objectContaining({ method: 'DELETE' }));
  expect(wrapper.findAll('.skill-row')).toHaveLength(0);
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
