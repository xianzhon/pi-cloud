import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ConfirmModal from './ConfirmModal.vue';

const __dirname = dirname(fileURLToPath(import.meta.url));

function mountModal(props: Record<string, unknown> = {}) {
  return mount(ConfirmModal, {
    props: {
      visible: true,
      ...props,
    },
    global: {
      stubs: {
        Teleport: true,
        Transition: false,
      },
    },
  });
}

describe('ConfirmModal styles', () => {
  it('uses the intended desktop modal width for detailed confirmation content', () => {
    const source = readFileSync(join(__dirname, 'ConfirmModal.vue'), 'utf8');

    expect(source).toContain('width: min(540px, calc(100vw - 2rem));');
    expect(source).toContain('background: var(--bg-secondary);');
    expect(source).not.toContain('rgba(22, 22, 30, 0.72)');
  });
});

describe('ConfirmModal behavior', () => {
  it('keeps the dialog open on backdrop clicks by default', async () => {
    const wrapper = mountModal();

    await wrapper.get('.modal-backdrop').trigger('click');
    await wrapper.get('.modal-close').trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('can opt in to cancelling on backdrop clicks', async () => {
    const wrapper = mountModal({ closeOnBackdrop: true });

    await wrapper.get('.modal-backdrop').trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
