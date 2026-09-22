#!/usr/bin/env node
import {
  changedFilesFromGit,
  checkArchitecture,
  formatReport,
  generateContext,
  updateBaseline,
} from './index.mjs';

const args = process.argv.slice(2);
const command = args[0] ?? 'check';
const cwd = process.cwd();

if (command === 'context') {
  const moduleId = args[1];
  if (!moduleId)
    throw new Error('Usage: pnpm architecture:context <module-id>');
  console.log(await generateContext(cwd, moduleId));
  process.exit(0);
}

const changedFiles = args.includes('--changed')
  ? await changedFilesFromGit(cwd)
  : null;
const result = await checkArchitecture({ cwd, changedFiles });

if (command === 'baseline:update') {
  await updateBaseline(cwd, result.violations);
  console.log(
    `Architecture baseline updated with ${result.violations.length} violations.`,
  );
  process.exit(0);
}

if (command === 'report' && args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatReport(result));
}

if (command === 'check' && result.newViolations.length > 0)
  process.exitCode = 1;
