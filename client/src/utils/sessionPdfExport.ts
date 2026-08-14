import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { marked, Renderer } from 'marked';
import { ansiToHtml } from './ansi';

export type ExportMessageKind = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';

export interface ExportMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp?: number;
  kind?: ExportMessageKind;
  status?: 'pending' | 'success' | 'failure' | 'info';
  title?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
}

export interface ExportSessionPdfOptions {
  messages: ExportMessage[];
  sessionTitle?: string;
  projectPath?: string;
  includeDetails: boolean;
  includeThinking: boolean;
}

marked.setOptions({ breaks: true });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]+/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'pi-session-transcript';
}

function exportTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function isSummaryOnlyThinking(message: ExportMessage): boolean {
  if (message.kind !== 'thinking') return false;
  const content = (message.thinking || message.content).trim();
  const summaryOnlyPattern = /\*\*(.+?)\*\*(?:\s*<!--\s*-->)?/g;
  return Boolean(content.match(summaryOnlyPattern)?.length) && !content.replace(summaryOnlyPattern, '').trim();
}

export function getPdfExportMessages(messages: ExportMessage[], includeDetails: boolean, includeThinking: boolean): ExportMessage[] {
  const detailFiltered = includeDetails
    ? messages
    : messages.filter((message) => message.kind !== 'tool_call' && message.kind !== 'tool_result');

  const thinkingFiltered = includeThinking
    ? detailFiltered
    : detailFiltered
      .filter((message) => message.kind !== 'thinking')
      .map((message) => message.thinking ? { ...message, thinking: undefined } : message);

  if (includeDetails || !thinkingFiltered.some(isSummaryOnlyThinking)) return thinkingFiltered;

  return thinkingFiltered.reduce<ExportMessage[]>((visible, message) => {
    const previous = visible.at(-1);
    if (isSummaryOnlyThinking(message) && previous && isSummaryOnlyThinking(previous)) {
      const thinking = `${previous.thinking || previous.content}\n\n${message.thinking || message.content}`;
      visible[visible.length - 1] = { ...previous, content: thinking, thinking };
      return visible;
    }
    visible.push(message);
    return visible;
  }, []);
}

function createMarkdownRenderer() {
  const renderer = new Renderer();
  renderer.code = (code: string, infostring: string | undefined) => {
    const language = (infostring || '').trim().split(/\s+/)[0].toLowerCase();
    const highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : escapeHtml(code);
    const label = language || 'text';
    return `<div class="pdf-code-block"><div class="pdf-code-label">${escapeHtml(label)}</div><pre><code>${highlighted}</code></pre></div>`;
  };
  return renderer;
}

function renderMarkdown(content: string): string {
  const html = marked.parse(ansiToHtml(content), { renderer: createMarkdownRenderer() }) as string;
  return DOMPurify.sanitize(html);
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

function roleLabel(message: ExportMessage): string {
  if (message.kind && message.kind !== 'text') {
    if (message.kind === 'tool_call' || message.kind === 'tool_result') {
      const label = message.kind === 'tool_call' ? 'Tool call' : 'Tool result';
      return `${label}${message.toolName ? ` · ${message.toolName}` : ''}`;
    }
    return message.title || message.kind.replace(/_/g, ' ');
  }
  return message.role === 'user' ? 'User' : 'Assistant';
}

function messageBody(message: ExportMessage): string {
  if (message.kind === 'tool_call') return message.toolInput || message.content;
  if (message.kind === 'tool_result') return message.toolOutput || message.content;
  if (message.kind === 'thinking') return message.thinking || message.content;
  return [message.thinking, message.content].filter((value): value is string => Boolean(value?.trim())).join('\n\n');
}

function renderMessage(message: ExportMessage): string {
  const kindClass = message.kind && message.kind !== 'text' ? ` detail ${message.kind}` : '';
  const timestamp = formatDate(message.timestamp);
  const title = message.title && message.title !== roleLabel(message) ? `<span class="pdf-message-title">${escapeHtml(message.title)}</span>` : '';
  return `
    <article class="pdf-message ${message.role}${kindClass}">
      <header class="pdf-message-header">
        <span class="pdf-role">${escapeHtml(roleLabel(message))}</span>
        ${title}
        ${timestamp ? `<time>${escapeHtml(timestamp)}</time>` : ''}
      </header>
      <div class="pdf-message-content">${renderMarkdown(messageBody(message))}</div>
    </article>
  `;
}

function buildExportHtml(options: ExportSessionPdfOptions, exportDate: Date): string {
  const title = options.sessionTitle?.trim() || 'Session Transcript';
  const exportedAt = exportDate.toLocaleString();
  const messages = getPdfExportMessages(options.messages, options.includeDetails, options.includeThinking);
  return `
    <section class="pdf-export-root">
      <header class="pdf-document-header">
        <p class="pdf-eyebrow">Pi WebUI transcript</p>
        <h1>${escapeHtml(title)}</h1>
        <dl>
          <div><dt>Exported</dt><dd>${escapeHtml(exportedAt)}</dd></div>
          ${options.projectPath ? `<div><dt>Project</dt><dd>${escapeHtml(options.projectPath)}</dd></div>` : ''}
          <div><dt>Details</dt><dd>${options.includeDetails ? 'Included' : 'Hidden'}</dd></div>
          <div><dt>Thinking</dt><dd>${options.includeThinking ? 'Included' : 'Hidden'}</dd></div>
        </dl>
      </header>
      <main>${messages.map(renderMessage).join('')}</main>
    </section>
  `;
}

function exportStyles(): string {
  return `
    @page {
      size: letter;
      margin: 0.65in 0.6in 0.8in;
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        color: #64748b;
        font-family: Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 10px;
      }
    }
    html, body {
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
      font-family: Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .pdf-export-container {
      width: 816px;
      min-height: 1056px;
      margin: 0 auto;
      background: #f8fafc;
      color: #0f172a;
    }
    .pdf-export-root {
      box-sizing: border-box;
      width: 816px;
      padding: 48px 54px;
      background: #f8fafc;
    }
    .pdf-document-header {
      margin-bottom: 28px;
      padding-bottom: 18px;
      border-bottom: 2px solid #e2e8f0;
    }
    .pdf-eyebrow {
      margin: 0 0 8px;
      color: #2563eb;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .pdf-document-header h1 {
      margin: 0 0 16px;
      color: #0f172a;
      font-size: 28px;
      line-height: 1.2;
    }
    .pdf-document-header dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 18px;
      margin: 0;
      color: #475569;
      font-size: 12px;
    }
    .pdf-document-header dt {
      display: inline;
      margin-right: 6px;
      color: #64748b;
      font-weight: 700;
    }
    .pdf-document-header dd {
      display: inline;
      margin: 0;
      overflow-wrap: anywhere;
    }
    .pdf-message {
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 0 0 16px;
      padding: 16px 18px;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    .pdf-message.user { background: #eff6ff; border-color: #bfdbfe; }
    .pdf-message.detail { background: #f8fafc; border-style: dashed; box-shadow: none; }
    .pdf-message.tool_call { border-color: #fde68a; background: #fffbeb; }
    .pdf-message.tool_result.status-failure, .pdf-message.tool_result { border-color: #e2e8f0; }
    .pdf-message-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 10px;
      color: #64748b;
      font-size: 11px;
    }
    .pdf-role {
      color: #1d4ed8;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .pdf-message.assistant .pdf-role { color: #334155; }
    .pdf-message.detail .pdf-role { color: #7c3aed; }
    .pdf-message-title { font-weight: 700; }
    .pdf-message-header time { margin-left: auto; }
    .pdf-message-content {
      color: #111827;
      font-size: 13px;
      line-height: 1.58;
      overflow-wrap: anywhere;
    }
    .pdf-message-content > :first-child { margin-top: 0; }
    .pdf-message-content > :last-child { margin-bottom: 0; }
    .pdf-message-content p { margin: 0 0 10px; }
    .pdf-message-content ul, .pdf-message-content ol { padding-left: 22px; }
    .pdf-message-content blockquote {
      margin: 12px 0;
      padding-left: 12px;
      border-left: 3px solid #cbd5e1;
      color: #475569;
    }
    .pdf-message-content code:not(pre code) {
      padding: 1px 5px;
      border-radius: 5px;
      background: #e2e8f0;
      color: #0f172a;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace;
      font-size: 0.92em;
    }
    .pdf-code-block {
      overflow: hidden;
      margin: 12px 0;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      background: #0f172a;
      color: #e2e8f0;
    }
    .pdf-code-label {
      padding: 6px 10px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.16);
      color: #94a3b8;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pdf-code-block pre {
      margin: 0;
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", monospace;
      font-size: 11px;
      line-height: 1.55;
    }
    .pdf-message-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 12px;
    }
    .pdf-message-content th, .pdf-message-content td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
    }
    .pdf-message-content th { background: #e2e8f0; }
    @media print {
      html, body {
        background: #ffffff;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .pdf-export-container {
        width: auto;
        min-height: 0;
        margin: 0;
        background: #ffffff;
      }
      .pdf-export-root {
        width: auto;
        padding: 0;
        background: #ffffff;
      }
      .pdf-message {
        break-inside: auto;
        page-break-inside: auto;
        border-radius: 10px;
        box-shadow: none;
      }
      .pdf-code-block {
        break-inside: auto;
        page-break-inside: auto;
        overflow: visible;
      }
    }
  `;
}

function buildPrintDocument(options: ExportSessionPdfOptions, exportDate: Date): string {
  const title = getSessionPdfFilename(options.sessionTitle);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>${exportStyles()}</style>
  </head>
  <body>
    <div class="pdf-export-container">${buildExportHtml(options, exportDate)}</div>
  </body>
</html>`;
}

export function getSessionPdfFilename(sessionTitle?: string): string {
  return `${sanitizeFilename(sessionTitle || 'pi-session-transcript')}-${exportTimestamp()}.pdf`;
}

export function hasExportableMessages(options: ExportSessionPdfOptions): boolean {
  return getPdfExportMessages(options.messages, options.includeDetails, options.includeThinking)
    .some((message) => messageBody(message).trim());
}

export async function exportSessionPdf(options: ExportSessionPdfOptions): Promise<void> {
  const exportDate = new Date();
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.bottom = '0';
  iframe.style.width = '816px';
  iframe.style.height = '1056px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  const printDocument = iframe.contentDocument;
  if (!printWindow || !printDocument) {
    iframe.remove();
    throw new Error('Could not create PDF print frame.');
  }

  printDocument.open();
  printDocument.write(buildPrintDocument(options, exportDate));
  printDocument.close();

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 0);
  };
  const fallbackCleanup = window.setTimeout(cleanup, 60_000);
  printWindow.addEventListener('afterprint', () => {
    window.clearTimeout(fallbackCleanup);
    cleanup();
  }, { once: true });

  printWindow.focus();
  printWindow.print();
}
