// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/theme-bootstrap.js', import.meta.url), 'utf8');

describe('theme bootstrap', () => {
  it('loads synchronously from the same origin without inline scripts', () => {
    expect(html).toContain('<script src="/theme-bootstrap.js"></script>');
    expect(html).not.toMatch(/<script\b[^>]*>\s*[^\s<]/);
    expect(html.indexOf('/theme-bootstrap.js')).toBeLessThan(html.indexOf('<body>'));
  });

  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    [null, false, 'light'],
    ['invalid', true, 'dark'],
  ])('applies preference %s with system dark=%s', (preference, dark, expected) => {
    const root = { setAttribute: vi.fn(), style: { colorScheme: '' } };
    runInNewContext(script, {
      document: { documentElement: root },
      localStorage: { getItem: () => preference },
      window: { matchMedia: () => ({ matches: dark }) },
    });
    expect(root.setAttribute).toHaveBeenCalledWith('data-theme', expected);
    expect(root.style.colorScheme).toBe(expected);
  });

  it('falls back to dark when storage is unavailable', () => {
    const root = { setAttribute: vi.fn(), style: { colorScheme: '' } };
    runInNewContext(script, {
      document: { documentElement: root },
      localStorage: { getItem() { throw new Error('Storage blocked'); } },
    });
    expect(root.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(root.style.colorScheme).toBe('dark');
  });
});
