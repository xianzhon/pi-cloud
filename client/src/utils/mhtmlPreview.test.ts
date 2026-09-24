import { describe, expect, it } from 'vitest';
import { renderMhtmlDocument } from './mhtmlPreview';

describe('renderMhtmlDocument', () => {
  it('resolves archived resources with URL suffixes and mixed-case locations', () => {
    const boundary = '----mhtml-test----';
    const source = [
      'MIME-Version: 1.0',
      `Content-Type: multipart/related; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Location: https://example.test/index.html',
      '',
      '<!doctype html><img src="IMAGE.PNG?cache=1#preview">',
      `--${boundary}`,
      'Content-Type: image/png',
      'Content-Location: https://example.test/IMAGE.PNG',
      'Content-Transfer-Encoding: base64',
      '',
      'AQID',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const html = renderMhtmlDocument(source);

    expect(html).toContain('src="data:image/png;base64,AQID#preview"');
  });

  it('does not leave remote resources in the preview while preserving navigation links', () => {
    const boundary = '----mhtml-test----';
    const source = [
      'MIME-Version: 1.0',
      `Content-Type: multipart/related; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Location: https://example.test/page',
      '',
      '<link rel="preconnect" href="https://cdn.test"><link rel="stylesheet" href="https://example.test/site.css">',
      '<meta http-equiv="refresh" content="0;url=https://cdn.test/elsewhere">',
      '<img src="https://cdn.test/missing.png" srcset="https://cdn.test/missing-2.png 2x">',
      '<div style="background: url(https://cdn.test/missing.png)"></div>',
      '<a href="https://example.test/next">Next</a>',
      `--${boundary}`,
      'Content-Type: text/css',
      'Content-Location: https://example.test/site.css',
      '',
      '@import "https://cdn.test/other.css"; @font-face { src: url("https://cdn.test/font.woff2"); }',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const html = renderMhtmlDocument(source)!;

    expect(html).toContain('href="https://example.test/next"');
    expect(html).toContain('href="data:text/css;base64,');
    expect(html).not.toContain('https://cdn.test');
    expect(html).not.toContain('srcset=');
    expect(html).toContain('url(&quot;data:,&quot;)');
  });
});
