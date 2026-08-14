import { describe, expect, it } from 'vitest';
import { ADAPTIVE_MEMORY_POLICY, LEGACY_MEMORY_POLICY, loadMemoryEfficiencyPolicy } from './policy.js';

describe('memory efficiency policy', () => {
  it('defaults to the adaptive lexical policy', () => {
    expect(loadMemoryEfficiencyPolicy({})).toBe(ADAPTIVE_MEMORY_POLICY);
  });

  it('allows rolling back to the legacy policy', () => {
    expect(loadMemoryEfficiencyPolicy({ PI_WEBUI_MEMORY_POLICY: LEGACY_MEMORY_POLICY })).toBe(LEGACY_MEMORY_POLICY);
  });

  it('rejects unknown policy names', () => {
    expect(() => loadMemoryEfficiencyPolicy({ PI_WEBUI_MEMORY_POLICY: 'experimental' })).toThrow(/PI_WEBUI_MEMORY_POLICY/);
  });
});
