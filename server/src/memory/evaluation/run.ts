import { evaluateMemoryGoldenSet } from './evaluate.js';

const representativeTracePath = process.argv[2] || process.env.PI_WEBUI_MEMORY_TRACE_FIXTURES;
const report = evaluateMemoryGoldenSet(representativeTracePath);
console.log(JSON.stringify(report, null, 2));
if (!report.passed || (representativeTracePath && !report.deploymentAcceptancePassed)) process.exitCode = 1;
