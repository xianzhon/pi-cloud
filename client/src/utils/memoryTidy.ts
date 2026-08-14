import type { MemoryRecord } from '../types/memory';

export type MemoryTidyReason = 'exact_duplicate' | 'near_duplicate' | 'stale_contradiction';

export interface MemoryTidySuggestion {
  id: string;
  reason: MemoryTidyReason;
  archive: MemoryRecord;
  keep: MemoryRecord;
  explanation: string;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'that', 'this', 'with']);

export function findMemoryTidySuggestions(memories: MemoryRecord[]): MemoryTidySuggestion[] {
  const active = memories.filter((memory) => memory.status === 'active');
  const suggestions = new Map<string, MemoryTidySuggestion>();

  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex];
      const right = active[rightIndex];
      if (!sameLedger(left, right) || suggestions.has(left.id) || suggestions.has(right.id)) continue;

      const exact = normalizeExact(left.content) === normalizeExact(right.content);
      if (exact || isNearDuplicate(left.content, right.content)) {
        const { keep, archive } = pickKeepAndArchive(left, right);
        suggestions.set(archive.id, {
          id: `${exact ? 'exact' : 'near'}:${archive.id}:${keep.id}`,
          reason: exact ? 'exact_duplicate' : 'near_duplicate',
          archive,
          keep,
          explanation: exact
            ? 'Same memory text after case and spacing normalization.'
            : 'Very similar wording in the same scope and category.',
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const stalePair = findStaleContradiction(active[leftIndex], active[rightIndex]);
      if (!stalePair || suggestions.has(stalePair.archive.id)) continue;
      suggestions.set(stalePair.archive.id, {
        id: `stale:${stalePair.archive.id}:${stalePair.keep.id}`,
        reason: 'stale_contradiction',
        archive: stalePair.archive,
        keep: stalePair.keep,
        explanation: 'A newer implemented/available memory appears to supersede an older “no way/currently no” memory.',
      });
    }
  }

  return Array.from(suggestions.values())
    .sort((left, right) => reasonRank(left.reason) - reasonRank(right.reason)
      || right.archive.updatedAt.localeCompare(left.archive.updatedAt));
}

function sameLedger(left: MemoryRecord, right: MemoryRecord): boolean {
  return left.scope === right.scope
    && left.projectId === right.projectId
    && left.category === right.category;
}

function pickKeepAndArchive(left: MemoryRecord, right: MemoryRecord): { keep: MemoryRecord; archive: MemoryRecord } {
  const newer = right.updatedAt.localeCompare(left.updatedAt) >= 0 ? right : left;
  const older = newer.id === left.id ? right : left;
  if (newer.content.length !== older.content.length) {
    const longer = newer.content.length > older.content.length ? newer : older;
    const shorter = longer.id === left.id ? right : left;
    return { keep: longer, archive: shorter };
  }
  return { keep: newer, archive: older };
}

function normalizeExact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeLoose(value: string): string[] {
  return normalizeExact(value)
    .replace(/[`'"“”‘’.,:;!?()[\]{}/-]/g, ' ')
    .split(/\s+/)
    .map(stemToken)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('er')) return token.slice(0, -2);
  return token;
}

function isNearDuplicate(left: string, right: string): boolean {
  const leftText = normalizeLoose(left).join(' ');
  const rightText = normalizeLoose(right).join(' ');
  if (!leftText || !rightText) return false;
  if (leftText.includes(rightText) || rightText.includes(leftText)) return true;

  const leftTokens = new Set(leftText.split(' '));
  const rightTokens = new Set(rightText.split(' '));
  const shared = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && shared / union >= 0.86;
}

function findStaleContradiction(left: MemoryRecord, right: MemoryRecord): { keep: MemoryRecord; archive: MemoryRecord } | null {
  if (!sameLedger(left, right)) return null;
  const leftUnavailable = unavailableSubject(left.content);
  const rightUnavailable = unavailableSubject(right.content);
  const leftImplemented = implementedSubject(left.content);
  const rightImplemented = implementedSubject(right.content);

  if (leftUnavailable && rightImplemented && isAtLeastAsNew(right, left) && sameSubject(leftUnavailable, rightImplemented)) {
    return { keep: right, archive: left };
  }
  if (rightUnavailable && leftImplemented && isAtLeastAsNew(left, right) && sameSubject(rightUnavailable, leftImplemented)) {
    return { keep: left, archive: right };
  }
  return null;
}

function unavailableSubject(content: string): string | null {
  const match = normalizeExact(content).match(/(?:there is currently no way to|there is no way to|currently no way to|no way to) (.+?)(?:\.|$)/);
  return match?.[1] ?? null;
}

function implementedSubject(content: string): string | null {
  const normalized = normalizeExact(content);
  const implemented = normalized.match(/(.+?) (?:is|are) implemented(?:\.|$)/);
  if (implemented) return implemented[1];
  const available = normalized.match(/(.+?) (?:is|are) (?:now )?available(?:\.|$)/);
  return available?.[1] ?? null;
}

function isAtLeastAsNew(candidate: MemoryRecord, stale: MemoryRecord): boolean {
  return candidate.updatedAt.localeCompare(stale.updatedAt) >= 0;
}

function sameSubject(left: string, right: string): boolean {
  const leftTokens = new Set(normalizeLoose(left));
  const rightTokens = new Set(normalizeLoose(right));
  if (!leftTokens.size || !rightTokens.size) return false;
  const shared = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

function reasonRank(reason: MemoryTidyReason): number {
  switch (reason) {
    case 'exact_duplicate':
      return 0;
    case 'stale_contradiction':
      return 1;
    case 'near_duplicate':
      return 2;
  }
}
