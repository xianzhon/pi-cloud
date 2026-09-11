import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionTreeModal from './SessionTreeModal.vue';

const tree = [{
  entry: { id: 'hidden-root', parentId: null, type: 'session' },
  children: [{
    entry: { id: 'user-1', parentId: 'hidden-root', type: 'message', message: { role: 'user', content: 'Start here' } },
    children: [
      { entry: { id: 'hidden', parentId: 'user-1', type: 'model_change', provider: 'p', modelId: 'm' }, children: [
        { entry: { id: 'assistant-1', parentId: 'hidden', type: 'message', message: { role: 'assistant', content: [{ text: 'First answer' }] } }, children: [] },
      ] },
      { entry: { id: 'user-2', parentId: 'user-1', type: 'message', message: { role: 'user', content: [{ content: 'Try again' }] } }, children: [] },
    ],
  }],
}];

async function settle() {
  await flushPromises();
}

describe('SessionTreeModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads visible messages, selects the leaf, collapses branches, and navigates', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree, leafId: 'assistant-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ editorText: 'continue' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SessionTreeModal, { props: { sessionId: 's1', clientId: 'c1' }, attachTo: document.body });
    await settle();

    expect(document.body.textContent).toContain('Start here');
    expect(document.body.textContent).toContain('First answer');
    expect(document.body.textContent).toContain('Try again');
    expect(document.body.textContent).not.toContain('model_change');
    expect(document.body.querySelectorAll('.tree-row')).toHaveLength(3);

    const toggle = document.body.querySelector('.tree-branch-toggle') as HTMLButtonElement;
    toggle.click();
    await settle();
    expect(document.body.querySelectorAll('.tree-row')).toHaveLength(1);
    toggle.click();
    await settle();

    const rows = document.body.querySelectorAll<HTMLElement>('.tree-row');
    rows[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.click();
    (document.body.querySelector('.primary-btn') as HTMLButtonElement).click();
    await settle();

    expect(fetchMock).toHaveBeenLastCalledWith('/api/sessions/s1/tree/navigate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ clientId: 'c1', targetId: 'user-2', summarize: true }),
    }));
    expect(wrapper.emitted('navigated')).toEqual([[{ editorText: 'continue' }]]);
    wrapper.unmount();
  });

  it('shows load errors, oversized responses, empty trees, and reloads for a new session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'broken' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ oversized: true, message: 'too large' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: [], leafId: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SessionTreeModal, { props: { sessionId: 'bad', clientId: 'c1' }, attachTo: document.body });
    await settle();
    expect(document.body.textContent).toContain('broken');

    await wrapper.setProps({ sessionId: 'large' });
    await settle();
    expect(document.body.textContent).toContain('too large');
    await wrapper.setProps({ sessionId: 'empty' });
    await settle();
    expect(document.body.textContent).toContain('No session entries yet');
    wrapper.unmount();
  });

  it('keeps the modal open for cancelled navigation and reports navigation failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree, leafId: 'missing' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cancelled: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'cannot navigate' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SessionTreeModal, { props: { sessionId: 's1', clientId: 'c1' }, attachTo: document.body });
    await settle();
    expect(document.body.querySelector('.tree-row')?.classList.contains('selected')).toBe(true);

    (document.body.querySelector('.primary-btn') as HTMLButtonElement).click();
    await settle();
    expect(wrapper.emitted('navigated')).toBeUndefined();
    (document.body.querySelector('.primary-btn') as HTMLButtonElement).click();
    await settle();
    expect(document.body.textContent).toContain('cannot navigate');
    wrapper.unmount();
  });
});
