import type { ExtractionSource } from './extraction-format.js';

export type ExtractionGateReasonCode =
  | 'empty'
  | 'acknowledgement'
  | 'transient-task'
  | 'tool-only'
  | 'durable-language'
  | 'correction'
  | 'confirmed-decision'
  | 'confirmed-outcome'
  | 'gate-error'
  | 'explicit-import'
  | 'ambiguous';

export interface ExtractionGateResult {
  decision: 'extract' | 'skip';
  reasonCode: ExtractionGateReasonCode;
}

const DURABLE_LANGUAGE = /\b(?:remember|always|never|from now on|for future|future tasks?|preference|rule)\b|(?:记住|以后|始终|永远|从现在|未来任务|长期|每次都)/iu;
const CORRECTION_LANGUAGE = /\b(?:correction|actually|instead|previously incorrect|no longer)\b|(?:更正|纠正|改为|不再|之前错误)/iu;
const DECISION_LANGUAGE = /\b(?:we decided|decision|must|shall|will use|adopted|required|constraint)\b|(?:决定|必须|采用|约定|要求|限制)/iu;
const CONFIRMED_OUTCOME = /\b(?:implemented|completed|fixed|verified|confirmed|resolved|root cause|pitfall|uses?|is located|are stored)\b|(?:已实现|已完成|已修复|验证|确认|解决|根因|陷阱|使用|位于)/iu;
const ACKNOWLEDGEMENT = /^(?:(?:ok(?:ay)?|thanks?|thank you|got it|sounds good|continue|done|好的?|谢谢|明白了?|收到|继续)[,，、.!！。\s]*)+$/iu;
const TRANSIENT_TASK = /^(?:no need to|don['’]?t|do not|just|only|please|can you|could you|不用|不要|只要|直接|请)(?:[\s\S]{0,240})(?:implement|write|fix|review|explain|summarize|plan|code|实现|编写|修复|审查|解释|总结|计划|代码)/iu;

export function evaluateDurableSignal(source: ExtractionSource): ExtractionGateResult {
  const meaningful = source.evidence.filter((record) => record.text.trim());
  if (meaningful.length === 0) return { decision: 'skip', reasonCode: 'empty' };

  const textual = meaningful.filter((record) => record.role !== 'tool');
  if (textual.length === 0) return { decision: 'skip', reasonCode: 'tool-only' };

  const combined = textual.map((record) => record.text).join('\n');
  if (DURABLE_LANGUAGE.test(combined)) return { decision: 'extract', reasonCode: 'durable-language' };
  if (CORRECTION_LANGUAGE.test(combined)) return { decision: 'extract', reasonCode: 'correction' };
  if (DECISION_LANGUAGE.test(combined)) return { decision: 'extract', reasonCode: 'confirmed-decision' };
  if (textual.some((record) => record.role === 'assistant' && CONFIRMED_OUTCOME.test(record.text))) {
    return { decision: 'extract', reasonCode: 'confirmed-outcome' };
  }
  if (textual.every((record) => ACKNOWLEDGEMENT.test(record.text.trim()))) {
    return { decision: 'skip', reasonCode: 'acknowledgement' };
  }
  if (textual.every((record) => record.role === 'user' && TRANSIENT_TASK.test(record.text.trim()))) {
    return { decision: 'skip', reasonCode: 'transient-task' };
  }
  return { decision: 'extract', reasonCode: 'ambiguous' };
}
