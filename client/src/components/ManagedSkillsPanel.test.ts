import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import ManagedSkillsPanel from './ManagedSkillsPanel.vue';
import ConfirmModal from './ConfirmModal.vue';

const content = '---\nname: example\ndescription: Example\n---\n# Example';
afterEach(() => vi.unstubAllGlobals());

it('shows editing guidance above and GitHub guidance beside the clone URL', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ skills: [] }) }));
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  expect(wrapper.find('.managed-skills > .skill-description').text()).toContain('Edit SKILL.md here; other files in cloned skills are preserved.');
  const cloneForm = wrapper.find('.skill-clone');
  expect(cloneForm.find('.skill-description').text()).toContain('Review GitHub skills before using them.');
  expect(cloneForm.find('.skill-description').text()).not.toContain('Edit SKILL.md');
  expect(cloneForm.find('.skill-description').text()).toContain('/tree/branch/path');
  expect(cloneForm.find('.skill-clone-row + .skill-description').exists()).toBe(true);
});

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

it('shows and edits a nested skill using its relative path', async () => {
  const nested = 'repo/collection/example';
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: nested, content }] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ name: nested }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: nested, content }] }) });
  vi.stubGlobal('fetch', fetch);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  expect(wrapper.find('.skill-row strong').text()).toBe(nested);
  await wrapper.find('.skill-row button[aria-label="Edit"]').trigger('click');
  await wrapper.find('textarea').setValue(`${content}\nUpdated`);
  await wrapper.find('.skill-editor').trigger('submit');
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith('/api/sessions/managed-skills/repo%2Fcollection%2Fexample', expect.objectContaining({ method: 'PUT' }));
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('confirms before deleting a shared skill and reports a successful change', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [{ name: 'example', content }] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ name: 'example' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) });
  vi.stubGlobal('fetch', fetch);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('.skill-row button[aria-label="Delete"]').trigger('click');
  expect(wrapper.getComponent(ConfirmModal).props('visible')).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  wrapper.getComponent(ConfirmModal).vm.$emit('cancel');
  await wrapper.vm.$nextTick();
  expect(wrapper.getComponent(ConfirmModal).props('visible')).toBe(false);
  await wrapper.find('.skill-row button[aria-label="Delete"]').trigger('click');
  wrapper.getComponent(ConfirmModal).vm.$emit('confirm');
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith('/api/sessions/managed-skills/example', expect.objectContaining({ method: 'DELETE' }));
  expect(wrapper.findAll('.skill-row')).toHaveLength(0);
  expect(wrapper.emitted('changed')).toHaveLength(1);
});

it('shows a spinner while cloning and hides it after completion', async () => {
  let finishClone!: (response: unknown) => void;
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    .mockImplementationOnce(() => new Promise((resolve) => { finishClone = resolve; }))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) });
  vi.stubGlobal('fetch', fetch);
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('input[type="url"]').setValue('https://github.com/owner/repo');
  await wrapper.find('.skill-clone').trigger('submit');
  const button = wrapper.find('.skill-clone-row button');
  expect(button.attributes('aria-busy')).toBe('true');
  expect(button.attributes('disabled')).toBeDefined();
  expect(button.find('.skill-clone-spinner').exists()).toBe(true);
  finishClone({ ok: true, status: 200, json: async () => ({ name: 'repo' }) });
  await flushPromises();
  expect(button.attributes('aria-busy')).toBe('false');
  expect(button.find('.skill-clone-spinner').exists()).toBe(false);
});

it('shows clone failures without claiming success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ skills: [] }) })
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'GitHub clone failed: repository unavailable' }) }));
  const wrapper = mount(ManagedSkillsPanel);
  await flushPromises();
  await wrapper.find('input[type="url"]').setValue('https://github.com/owner/repo');
  await wrapper.findAll('form')[1].trigger('submit');
  await flushPromises();
  expect(wrapper.find('.skill-clone-row + [role="alert"]').text()).toContain('repository unavailable');
  expect(wrapper.find('.managed-skills > [role="alert"]').exists()).toBe(false);
  expect(wrapper.emitted('changed')).toBeUndefined();
});
