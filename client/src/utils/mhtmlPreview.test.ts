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
});
