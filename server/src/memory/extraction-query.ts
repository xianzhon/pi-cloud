import type { ExtractionSource } from './extraction-format.js';
import { toFtsQuery } from './recall.js';

const MAX_EXTRACTION_SEARCHES = 6;

export function buildExtractionQueries(source: ExtractionSource): string[] {
  const inputs: string[] = [];
  for (const evidence of source.evidence) {
    if (evidence.path) inputs.push(evidence.path);
    if (evidence.symbol) inputs.push(evidence.symbol);
    if (evidence.command) inputs.push(evidence.command);
    inputs.push(...Array.from(evidence.text.matchAll(/["“”]([^"“”]{2,120})["“”]/gu), (match) => match[1]));
  }
  for (const evidence of source.evidence) inputs.push(evidence.text);

  const queries: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const query = toFtsQuery(input);
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
    if (queries.length >= MAX_EXTRACTION_SEARCHES) break;
  }
  return queries;
}
