export const ADAPTIVE_MEMORY_POLICY = 'adaptive-lexical-v1' as const;
export const LEGACY_MEMORY_POLICY = 'legacy' as const;
export type MemoryEfficiencyPolicy = typeof ADAPTIVE_MEMORY_POLICY | typeof LEGACY_MEMORY_POLICY;

export function loadMemoryEfficiencyPolicy(env: NodeJS.ProcessEnv = process.env): MemoryEfficiencyPolicy {
  const configured = env.PI_CLOUD_MEMORY_POLICY?.trim();
  if (!configured || configured === ADAPTIVE_MEMORY_POLICY) return ADAPTIVE_MEMORY_POLICY;
  if (configured === LEGACY_MEMORY_POLICY) return LEGACY_MEMORY_POLICY;
  throw new Error(`PI_CLOUD_MEMORY_POLICY must be "${LEGACY_MEMORY_POLICY}" or "${ADAPTIVE_MEMORY_POLICY}"`);
}
