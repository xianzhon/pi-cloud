import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateMemoryGoldenSet } from './evaluate.js';

describe('memory golden evaluation', () => {
  it('meets recall retention, precision, token, and extraction-gate acceptance thresholds', () => {
    const report = evaluateMemoryGoldenSet();

    expect(report.fixtureVersion).toBe('memory-golden-v1');
    expect(report.representativeTraceIncluded).toBe(false);
    expect(report.representativeTracePassed).toBe(false);
    expect(report.deploymentAcceptancePassed).toBe(false);
    expect(report.metrics.recallRetention).toBeGreaterThanOrEqual(0.95);
    expect(report.metrics.medianTokenReduction).toBeGreaterThanOrEqual(0.6);
    expect(report.metrics.transientGateAvoidance).toBeGreaterThanOrEqual(0.5);
    expect(report.metrics.proposedPrecision).toBeGreaterThanOrEqual(report.metrics.baselinePrecision);
    expect(report.metrics.proposedIrrelevantInjectionRate)
      .toBeLessThanOrEqual(report.metrics.baselineIrrelevantInjectionRate);
    expect(report.passed).toBe(true);
  });

  it('requires a nonempty representative sample that passes independently', () => {
    const directory = mkdtempSync(join(tmpdir(), 'memory-eval-'));
    const emptyPath = join(directory, 'empty.json');
    writeFileSync(emptyPath, JSON.stringify({ version: 'empty', recall: [], extraction: [] }));

    expect(() => evaluateMemoryGoldenSet(emptyPath)).toThrow(/nonempty recall and extraction/i);

    const passingSample = new URL('./fixtures/v1.json', import.meta.url);
    const report = evaluateMemoryGoldenSet(passingSample.pathname);
    expect(report.representativeTraceIncluded).toBe(true);
    expect(report.representativeTracePassed).toBe(true);
    expect(report.deploymentAcceptancePassed).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });
});
