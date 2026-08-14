import { createHash } from 'node:crypto';

export const MAX_MEMORY_CONTENT_LENGTH = 2_000;
export const MAX_MEMORY_TAGS = 10;
export const MAX_MEMORY_TAG_LENGTH = 32;

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s,;]{8,}/i,
];

export function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ');
}

export function normalizeMemoryTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
    .slice(0, MAX_MEMORY_TAGS)
    .map((tag) => tag.slice(0, MAX_MEMORY_TAG_LENGTH));
}

export function hashMemoryContent(content: string): string {
  return createHash('sha256').update(normalizeMemoryContent(content).toLowerCase()).digest('hex');
}

export function assertMemoryContent(content: string): string {
  const normalized = normalizeMemoryContent(content);
  if (!normalized) throw new Error('Memory content is required');
  if (normalized.length > MAX_MEMORY_CONTENT_LENGTH) throw new Error('Memory content is too long');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new Error('Memory content appears to contain a secret or credential');
  }
  return normalized;
}
