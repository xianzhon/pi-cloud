interface MimePart {
  contentType: string;
  contentLocation?: string;
  contentId?: string;
  charset?: string;
  bytes: Uint8Array;
}

interface ParsedContentType {
  mimeType: string;
  parameters: Map<string, string>;
}

export function renderMhtmlDocument(source: string): string | undefined {
  const parts = parseEntity(source);
  const htmlPart = parts.find(part => part.contentType === 'text/html');
  if (!htmlPart) return undefined;

  const resources = new Map<string, MimePart>();
  const registerResource = (location: string, part: MimePart): void => {
    resources.set(location, part);
    resources.set(location.toLowerCase(), part);
  };
  for (const part of parts) {
    if (part.contentId) registerResource(`cid:${stripAngles(part.contentId).toLowerCase()}`, part);
    if (part.contentLocation) {
      registerResource(part.contentLocation, part);
      const absoluteLocation = resolveUrl(part.contentLocation, htmlPart.contentLocation);
      if (absoluteLocation) registerResource(absoluteLocation, part);
    }
  }

  const dataUrls = new Map<MimePart, string>();
  const resourceUrl = (reference: string, base?: string, resolving = new Set<MimePart>()): string | undefined => {
    const { path, suffix } = splitUrlSuffix(reference.trim());
    const key = path.toLowerCase().startsWith('cid:')
      ? `cid:${stripAngles(path.slice(4)).toLowerCase()}`
      : path;
    const absoluteKey = resolveUrl(key, base);
    const lookupKeys = [key, absoluteKey, key.split('?')[0], absoluteKey?.split('?')[0]]
      .filter((value): value is string => Boolean(value));
    const resolved = lookupKeys
      .map(value => resources.get(value) || resources.get(value.toLowerCase()))
      .find((part): part is MimePart => Boolean(part));
    if (!resolved || resolved === htmlPart || resolving.has(resolved)) return undefined;

    const cached = dataUrls.get(resolved);
    if (cached) return cached + suffix;

    let bytes = resolved.bytes;
    if (resolved.contentType === 'text/css') {
      const nextResolving = new Set(resolving).add(resolved);
      const css = rewriteCssUrls(decodeText(bytes, resolved.charset), url => resourceUrl(url, resolved.contentLocation || base));
      bytes = new TextEncoder().encode(css);
    }

    const dataUrl = `data:${safeMimeType(resolved.contentType)};base64,${bytesToBase64(bytes)}`;
    dataUrls.set(resolved, dataUrl);
    return dataUrl + suffix;
  };

  const html = decodeText(htmlPart.bytes, htmlPart.charset);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const rewriteAttribute = (element: Element, attribute: string): void => {
    const value = element.getAttribute(attribute);
    if (!value) return;
    const replacement = resourceUrl(value, htmlPart.contentLocation);
    if (replacement) element.setAttribute(attribute, replacement);
    else if (isRemoteUrl(value)) element.removeAttribute(attribute);
  };

  document.querySelectorAll('[src]').forEach(element => rewriteAttribute(element, 'src'));
  document.querySelectorAll('[poster]').forEach(element => rewriteAttribute(element, 'poster'));
  document.querySelectorAll('[srcset]').forEach(element => {
    const srcset = element.getAttribute('srcset');
    if (!srcset) return;
    const candidates = srcset.split(',').map(candidate => {
      const [url, ...descriptor] = candidate.trim().split(/\s+/);
      const replacement = resourceUrl(url, htmlPart.contentLocation);
      return replacement || !isRemoteUrl(url) ? [replacement || url, ...descriptor].join(' ') : '';
    }).filter(Boolean);
    if (candidates.length) element.setAttribute('srcset', candidates.join(', '));
    else element.removeAttribute('srcset');
  });
  document.querySelectorAll('link[href]').forEach(element => {
    rewriteAttribute(element, 'href');
    if (!element.getAttribute('href')) element.remove();
  });
  document.querySelectorAll('meta[http-equiv]').forEach(element => {
    if (element.getAttribute('http-equiv')?.toLowerCase() === 'refresh') element.remove();
  });
  document.querySelectorAll('[background]').forEach(element => rewriteAttribute(element, 'background'));
  document.querySelectorAll('[style]').forEach(element => {
    const style = element.getAttribute('style');
    if (!style) return;
    element.setAttribute('style', rewriteCssUrls(style, url => resourceUrl(url, htmlPart.contentLocation)));
  });
  document.querySelectorAll('style').forEach(element => {
    element.textContent = rewriteCssUrls(element.textContent || '', url => resourceUrl(url, htmlPart.contentLocation));
  });

  const doctype = /^\s*<!doctype\s+html[^>]*>/i.test(html) ? '<!DOCTYPE html>' : '';
  return `${doctype}${document.documentElement.outerHTML}`;
}

function parseEntity(source: string): MimePart[] {
  const separator = /\r?\n\r?\n/.exec(source);
  if (!separator) return [];

  const headers = parseHeaders(source.slice(0, separator.index));
  const body = source.slice(separator.index + separator[0].length);
  const contentType = parseContentType(headers.get('content-type') || 'text/plain');
  const boundary = contentType.parameters.get('boundary');
  if (contentType.mimeType.startsWith('multipart/') && boundary) {
    return splitMultipart(body, boundary).flatMap(parseEntity);
  }

  return [{
    contentType: contentType.mimeType,
    contentLocation: cleanHeaderValue(headers.get('content-location')),
    contentId: cleanHeaderValue(headers.get('content-id')),
    charset: contentType.parameters.get('charset'),
    bytes: decodeBody(body, headers.get('content-transfer-encoding')),
  }];
}

function parseHeaders(source: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = source.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

function parseContentType(value: string): ParsedContentType {
  const segments = value.split(';');
  const parameters = new Map<string, string>();
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf('=');
    if (equals <= 0) continue;
    const key = segment.slice(0, equals).trim().toLowerCase();
    parameters.set(key, stripQuotes(segment.slice(equals + 1).trim()));
  }
  return { mimeType: segments[0].trim().toLowerCase(), parameters };
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const lines = body.split(/\r?\n/);
  const delimiter = `--${boundary}`;
  let current: string[] | undefined;

  for (const line of lines) {
    const marker = line.trimEnd();
    if (marker === `${delimiter}--`) {
      if (current) parts.push(current.join('\n'));
      break;
    }
    if (marker === delimiter) {
      if (current) parts.push(current.join('\n'));
      current = [];
    } else if (current) {
      current.push(line);
    }
  }
  return parts;
}

function decodeBody(body: string, transferEncoding?: string): Uint8Array {
  const encoding = transferEncoding?.trim().toLowerCase();
  if (encoding === 'base64') {
    try {
      const binary = atob(body.replace(/\s/g, ''));
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
      return new TextEncoder().encode(body);
    }
  }
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return new TextEncoder().encode(body);
}

function decodeQuotedPrintable(value: string): Uint8Array {
  const source = value.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < source.length;) {
    const encoded = source.slice(index, index + 3);
    if (/^=[\da-f]{2}$/i.test(encoded)) {
      bytes.push(Number.parseInt(encoded.slice(1), 16));
      index += 3;
      continue;
    }
    const character = String.fromCodePoint(source.codePointAt(index)!);
    bytes.push(...new TextEncoder().encode(character));
    index += character.length;
  }
  return Uint8Array.from(bytes);
}

function decodeText(bytes: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function isRemoteUrl(url: string): boolean {
  return /^(?:https?:)?\/\//i.test(url.trim());
}

function rewriteCssUrls(css: string, resolve: (url: string) => string | undefined): string {
  return css
    .replace(/@import\s+(?:url\(\s*)?(['"]?)([^'"\s);]+)\1\s*\)?[^;]*;/gi, (match, _quote: string, url: string) => {
      const replacement = resolve(url);
      if (replacement) return match.replace(url, replacement);
      return isRemoteUrl(url) ? '' : match;
    })
    .replace(/url\(\s*(['"]?)([^')]+)\1\s*\)/gi, (match, quote: string, url: string) => {
      const replacement = resolve(url);
      return replacement ? `url(${quote}${replacement}${quote})` : isRemoteUrl(url) ? 'url("data:,")' : match;
    });
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(result);
}

function resolveUrl(reference: string, base?: string): string | undefined {
  if (!base) return undefined;
  try {
    return new URL(reference, base).href;
  } catch {
    return undefined;
  }
}

function splitUrlSuffix(value: string): { path: string; suffix: string } {
  const fragmentIndex = value.indexOf('#');
  const queryIndex = value.indexOf('?');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0];
  if (suffixIndex === undefined) return { path: value, suffix: '' };

  // Query strings are useful for locating an MHTML part, but must not be
  // appended to the generated data URL. Preserve only a fragment.
  return {
    path: fragmentIndex >= 0 ? value.slice(0, fragmentIndex) : value,
    suffix: fragmentIndex >= 0 ? value.slice(fragmentIndex) : '',
  };
}

function cleanHeaderValue(value?: string): string | undefined {
  if (!value) return undefined;
  return stripQuotes(value.trim());
}

function stripAngles(value: string): string {
  return value.replace(/^<|>$/g, '');
}

function stripQuotes(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function safeMimeType(value: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : 'application/octet-stream';
}
