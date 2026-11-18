/**
 * The `--questions-file` reader. It checks the file's shape only, so a typo
 * names its place before any request is sent. The flow rules (sequence 1..N,
 * intro first, forward-only branches, options per question type) stay with
 * the API, which names the failing path.
 */
import { readFileSync } from 'node:fs';
import type { SurveyQuestionInput } from '@political-comms/sdk';

const QUESTION_KEYS = new Set([
  'sequence', 'question_type', 'question_text', 'message_type', 'media_ids', 'response_options',
  'no_match_sequence', 'is_required',
]);
const OPTION_KEYS = new Set(['value', 'label', 'next_sequence']);
const QUESTION_TYPES = ['intro', 'multiple_choice', 'open_ended', 'outro'];

const isInt = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isText = (value: unknown) => typeof value === 'string' && value.length > 0;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function unknownKeys(value: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function optionProblem(option: unknown): string | undefined {
  if (!isObject(option)) return 'must be an object';
  const extra = unknownKeys(option, OPTION_KEYS);
  if (extra.length > 0) return `has unknown keys: ${extra.join(', ')}`;
  if (!isInt(option.value, 1, 9)) return 'value must be an integer 1-9';
  if (!isText(option.label)) return 'label must be a non-empty string';
  if (option.next_sequence !== undefined && !isInt(option.next_sequence, 1, 32)) {
    return 'next_sequence must be an integer 1-32';
  }
  return undefined;
}

function questionProblem(q: Record<string, unknown>): string | undefined {
  const extra = unknownKeys(q, QUESTION_KEYS);
  if (extra.length > 0) return `has unknown keys: ${extra.join(', ')}`;
  if (!isInt(q.sequence, 1, 32)) return 'sequence must be an integer 1-32';
  if (!QUESTION_TYPES.includes(q.question_type as string)) {
    return `question_type must be one of ${QUESTION_TYPES.join(', ')}`;
  }
  if (!isText(q.question_text)) return 'question_text must be a non-empty string';
  if (q.message_type !== undefined && q.message_type !== 'sms' && q.message_type !== 'mms') {
    return 'message_type must be sms or mms';
  }
  if (q.media_ids !== undefined && !(Array.isArray(q.media_ids) && q.media_ids.every(isText))) {
    return 'media_ids must be an array of media ids';
  }
  if (q.no_match_sequence != null && !isInt(q.no_match_sequence, 1, 32)) {
    return 'no_match_sequence must be an integer 1-32';
  }
  if (q.is_required !== undefined && typeof q.is_required !== 'boolean') return 'is_required must be true or false';
  return undefined;
}

function optionsProblem(options: unknown): string | undefined {
  if (options == null) return undefined;
  if (!Array.isArray(options) || options.length < 2 || options.length > 9) {
    return 'response_options must be an array of 2-9 options';
  }
  for (const [index, option] of options.entries()) {
    const problem = optionProblem(option);
    if (problem) return `response_options[${index}] ${problem}`;
  }
  return undefined;
}

/** Reads a JSON array of survey questions, the API's `questions` field as is. */
export function readQuestionsFile(path: string): SurveyQuestionInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`--questions-file ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 32) {
    throw new Error(`--questions-file ${path} must hold a JSON array of 2-32 questions`);
  }
  for (const [index, question] of parsed.entries()) {
    const problem = isObject(question)
      ? (questionProblem(question) ?? optionsProblem(question.response_options))
      : 'must be an object';
    if (problem) throw new Error(`--questions-file ${path}: question [${index}] ${problem}`);
  }
  return parsed as SurveyQuestionInput[];
}
