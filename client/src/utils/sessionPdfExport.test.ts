import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportSessionPdf,
  getPdfExportMessages,
  getSessionPdfFilename,
  hasExportableMessages,
  type ExportMessage,
} from './sessionPdfExport';

const messages: ExportMessage[] = [
  { id: '1', role: 'user', content: 'Hello <world>', timestamp: Date.now() },
  { id: '2', role: 'assistant', content: '**First**', thinking: '**First**', kind: 'thinking' },
  { id: '3', role: 'assistant', content: '**Second**', kind: 'thinking' },
  { id: '4', role: 'assistant', content: '', kind: 'tool_call', toolName: 'read', toolInput: '```ts\nconst x = 1\n```', title: 'Read file' },
  { id: '5', role: 'assistant', content: '', kind: 'tool_result', toolOutput: '\u001b[31mfailed\u001b[0m', status: 'failure' },
  { id: '6', role: 'assistant', content: 'Done', kind: 'status', title: 'Complete' },
];

describe('sessionPdfExport', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  });

  it('filters details and thinking according to export options', () => {
    expect(getPdfExportMessages(messages, false, false).map((message) => message.id)).toEqual(['1', '6']);
    const withoutDetails = getPdfExportMessages(messages, false, true);
    expect(withoutDetails).toHaveLength(3);
    expect(withoutDetails[1].thinking).toContain('First');
    expect(withoutDetails[1].thinking).toContain('Second');
    expect(getPdfExportMessages(messages, true, false).some((message) => message.kind === 'tool_call')).toBe(true);
    expect(getPdfExportMessages(messages, true, true)).toEqual(messages);
  });

  it('detects exportable message bodies for every message kind', () => {
    const options = { messages, includeDetails: true, includeThinking: true };
    expect(hasExportableMessages(options)).toBe(true);
    expect(hasExportableMessages({ ...options, messages: [{ id: 'x', role: 'assistant', content: ' ', kind: 'tool_call' }] })).toBe(false);
    expect(hasExportableMessages({ ...options, messages: [{ id: 'x', role: 'assistant', content: '', thinking: 'thought' }] })).toBe(true);
  });

  it('creates safe timestamped filenames', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4));
    expect(getSessionPdfFilename('  My: Session!?  ')).toBe('my-session-2026-01-02-0304.pdf');
    expect(getSessionPdfFilename('!!!')).toBe('pi-session-transcript-2026-01-02-0304.pdf');
    expect(getSessionPdfFilename()).toBe('pi-session-transcript-2026-01-02-0304.pdf');
  });

  it('renders all message variants into the print frame and cleans it up after printing', async () => {
    vi.useFakeTimers();
    const originalCreateElement = document.createElement.bind(document);
    let printedHtml = '';
    const focus = vi.fn();
    const print = vi.fn();
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'iframe') {
        const printDocument = document.implementation.createHTMLDocument();
        vi.spyOn(printDocument, 'write').mockImplementation((html: string) => { printedHtml = html; });
        Object.defineProperties(element, {
          contentDocument: { configurable: true, value: printDocument },
          contentWindow: { configurable: true, value: { addEventListener: vi.fn(), focus, print } },
        });
      }
      return element;
    }) as typeof document.createElement);

    await exportSessionPdf({
      messages,
      sessionTitle: 'Session & Review',
      projectPath: '/tmp/<repo>',
      includeDetails: true,
      includeThinking: true,
    });

    expect(printedHtml).toContain('session-review-');
    expect(printedHtml).toContain('Session &amp; Review');
    expect(printedHtml).toContain('/tmp/&lt;repo&gt;');
    expect(printedHtml).toContain('Tool call · read');
    expect(printedHtml).toContain('Tool result');
    expect(printedHtml).toContain('pdf-code-block');
    expect(focus).toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
    createElement.mockRestore();
    await vi.runAllTimersAsync();
  });
});
