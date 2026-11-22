// @ts-nocheck
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { match } from 'ts-pattern';
import {
  VALID_CATEGORIES,
  TYPE_TO_CATEGORY,
  capitalizeCategory,
  isValidCategory,
} from './commit-journal.js';
import {
  VALIDATION_STATES,
  fatalError,
  getErrorMessage,
  showHelpAndExit,
  formatZodValidationIssue,
} from './commit-cli-help.js';

export { VALIDATION_STATES, fatalError, getErrorMessage, formatZodValidationIssue };

export const CANONICAL_RELATION_TYPES = [
  'evolves_from',
  'references',
  'implements',
  'clarifies',
  'response_to',
  'blocked_by',
  'resolved',
  'caused',
] as const;

const RELATION_TYPE_ALIASES: Record<string, (typeof CANONICAL_RELATION_TYPES)[number]> = {
  resolves: 'resolved',
  depends_on: 'blocked_by',
  relates_to: 'references',
};

export const CONVENTIONAL_COMMIT_REGEX = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s+(\S.*)$/;

const CLI_OPTIONS = {
  msg: { type: 'string', short: 'm' },
  message: { type: 'string' },
  history: { type: 'string' },
  'history-file': { type: 'string' },
  'no-history': { type: 'boolean' },
  help: { type: 'boolean' },
  impact: { type: 'string' },
  trust: { type: 'string' },
  confidence: { type: 'string' },
  validation: { type: 'string' },
  significance: { type: 'string' },
  category: { type: 'string' },
  cwd: { type: 'string' },
  add: { type: 'string', multiple: true },
  journal: { type: 'boolean' },
  'journal-project': { type: 'string' },
  'session-id': { type: 'string' },
  tags: { type: 'string', multiple: true },
  tag: { type: 'string', multiple: true },
  relate: { type: 'string', multiple: true },
  'no-auto-link': { type: 'boolean' },
  'dry-run-links': { type: 'boolean' },
} as const;

const STRING_CLI_FLAGS: ReadonlySet<string> = new Set(
  Object.entries(CLI_OPTIONS)
    .filter(([, opt]) => opt.type === 'string')
    .map(([key]) => key)
);

const VALID_COMMIT_TYPES: ReadonlySet<string> = new Set([
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert',
]);

const VALIDATION_PASSED_ALIASES: ReadonlySet<string> = new Set(['pass', 'yes', 'true', 'ok', 'passed']);
const VALIDATION_FAILED_ALIASES: ReadonlySet<string> = new Set(['fail', 'no', 'false', 'error', 'failed']);
const VALIDATION_NONE_ALIASES: ReadonlySet<string> = new Set(['skip', 'skipped', 'not-run', 'na', 'n_a', 'none']);

const KEYWORD_RULES: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: 'fix', re: /^fix\b\s*/i },
  { type: 'fix', re: /^resolve\b\s*/i },
  { type: 'fix', re: /^patch\b\s*/i },
  { type: 'feat', re: /^add\b\s*/i },
  { type: 'feat', re: /^implement\b\s*/i },
  { type: 'feat', re: /^introduce\b\s*/i },
  { type: 'docs', re: /^doc\b\s*/i },
  { type: 'docs', re: /^readme\b\s*/i },
  { type: 'test', re: /^test\b\s*/i },
  { type: 'test', re: /^spec\b\s*/i },
  { type: 'refactor', re: /^refactor\b\s*/i },
  { type: 'refactor', re: /^restructure\b\s*/i },
];

const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;
const CANONICAL_DECIMAL_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const SPACE_CONVENTIONAL_RE = /^([A-Za-z0-9_-]+)(?:\s*\(\s*([^)]+?)\s*\))?\s*(!)?[\s:]+(.+)$/;

function parseCanonicalPositiveInt(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val >= 1 ? val : Number.NaN;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!CANONICAL_POSITIVE_INT_RE.test(trimmed)) return Number.NaN;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function parseStrictScoreNumber(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : Number.NaN;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!CANONICAL_DECIMAL_RE.test(trimmed)) return Number.NaN;
    return Number(trimmed);
  }
  return Number.NaN;
}

function matchKeywordPrefix(firstLine: string): string {
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(firstLine)) {
      const replaced = firstLine.replace(rule.re, '');
      const stripped = replaced.length > 0 ? replaced.charAt(0).toLowerCase() + replaced.slice(1) : firstLine;
      return `${rule.type}: ${stripped}`;
    }
  }
  return `chore: ${firstLine}`;
}

const EMPTY_CONVENTIONAL_SUBJECT_RE = /^[a-zA-Z0-9_-]+(?:\([^)]*\))?!?:$/;

function normalizeCommitMsg(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const normalized = val.replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  const lines = trimmed.split('\n');
  let firstLine = (lines[0] ?? '').trim();
  if (firstLine.length === 0) return '';
  if (EMPTY_CONVENTIONAL_SUBJECT_RE.test(firstLine)) return trimmed;
  let corrected = false;

  const strictMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
  if (strictMatch) {
    const [, type, scope, bang, subject] = strictMatch;
    if (type !== type.toLowerCase()) {
      firstLine = `${type.toLowerCase()}${scope ? `(${scope})` : ''}${bang ?? ''}: ${subject}`;
      corrected = true;
    }
  } else {
    const spaceMatch = firstLine.match(SPACE_CONVENTIONAL_RE);
    if (spaceMatch && VALID_COMMIT_TYPES.has(spaceMatch[1].toLowerCase())) {
      const [, type, scope, bang, subject] = spaceMatch;
      firstLine = `${type.toLowerCase()}${scope ? `(${scope})` : ''}${bang ?? ''}: ${subject}`;
      corrected = true;
    } else {
      firstLine = matchKeywordPrefix(firstLine);
      corrected = true;
    }
  }

  if (corrected) {
    console.warn(`⚠️ AUTONOMOUS HEALING: Auto-corrected commit message to conventional format: "${firstLine}"`);
    lines[0] = firstLine;
    return lines.join('\n');
  }
  return trimmed;
}

function normalizeRelateSpecs(val: unknown): unknown {
  if (val === undefined) return undefined;
  const rawItems = Array.isArray(val) ? val : [val];
  const specs: unknown[] = [];
  for (const item of rawItems) {
    if (typeof item !== 'string') {
      specs.push(item);
      continue;
    }
    for (const token of item.split(',')) {
      const clean = token.trim();
      if (clean.length === 0) continue;
      const colonIdx = clean.indexOf(':');
      const idStr = colonIdx === -1 ? clean : clean.slice(0, colonIdx).trim();
      const rawRel = (colonIdx === -1 ? 'references' : clean.slice(colonIdx + 1).trim()).toLowerCase();
      const aliased = Object.hasOwn(RELATION_TYPE_ALIASES, rawRel) ? RELATION_TYPE_ALIASES[rawRel] : undefined;
      if (aliased !== undefined) {
        console.warn(`⚠️ AUTONOMOUS HEALING: Normalized --relate type '${rawRel}' to '${aliased}'.`);
      }
      const relationType = aliased ?? rawRel;
      const parsedId = CANONICAL_POSITIVE_INT_RE.test(idStr) ? Number(idStr) : Number.NaN;
      const targetId = Number.isSafeInteger(parsedId) && String(parsedId) === idStr ? parsedId : idStr;
      specs.push({ targetId, relationType });
    }
  }
  return specs;
}

// [BOUNDARY]: Strict Zod CLI schema boundary. [INVARIANT]: All inputs must be coerced and validated here. Do NOT implement manual validation downstream.
export const cliSchema = z.object({
  msg: z.preprocess(
    normalizeCommitMsg,
    z.string({ message: 'Missing Commit Message! You must provide a commit message using `--msg "..."` or as the first positional argument.' })
      .refine((val) => val.trim().split('\n')[0].length <= 200, { message: 'Too big: expected commit subject (first line) to be <=200 characters' })
      .refine((val) => {
        const firstLine = (val.trim().split('\n')[0] ?? '').trim();
        return CONVENTIONAL_COMMIT_REGEX.test(firstLine);
      }, { message: "must follow conventional commit format (e.g., 'feat(core): subject' or 'feat!: breaking')." })
  ),
  history: z.string().optional(),
  'history-file': z.string().max(4096).optional(),
  'no-history': z.boolean().default(false),
  help: z.boolean().default(false),
  impact: z.preprocess(parseStrictScoreNumber, z.number().min(0.0).max(1.0)),
  trust: z.preprocess(parseStrictScoreNumber, z.number().min(0.0).max(1.0)).optional(),
  confidence: z.preprocess(parseStrictScoreNumber, z.number().min(0.0).max(1.0)),
  validation: z.preprocess((val) => {
    if (val === undefined) return undefined;
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (VALIDATION_PASSED_ALIASES.has(lower)) {
        if (val !== 'passed') console.warn(`⚠️ AUTONOMOUS HEALING: Normalized validation state '${val}' to 'passed'.`);
        return 'passed';
      }
      if (VALIDATION_FAILED_ALIASES.has(lower)) {
        if (val !== 'failed') console.warn(`⚠️ AUTONOMOUS HEALING: Normalized validation state '${val}' to 'failed'.`);
        return 'failed';
      }
      if (VALIDATION_NONE_ALIASES.has(lower)) {
        if (val !== 'none') console.warn(`⚠️ AUTONOMOUS HEALING: Normalized validation state '${val}' to 'none'.`);
        return 'none';
      }
    }
    return val;
  }, z.enum(VALIDATION_STATES)),
  significance: z.string().trim().min(1, 'Significance cannot be empty.').max(100).refine(
    (s) => !/[\r\n]/.test(s),
    { message: 'Significance must be a single-line value without newlines.' }
  ).optional(),
  category: z.preprocess(
    (val) => {
      if (typeof val !== 'string') return val;
      const cap = capitalizeCategory(val);
      if (isValidCategory(cap)) return cap;

      const lowerVal = val.toLowerCase();
      const mapped = Object.hasOwn(TYPE_TO_CATEGORY, lowerVal) ? TYPE_TO_CATEGORY[lowerVal] : undefined;
      if (mapped !== undefined) {
        console.warn(`⚠️ AUTONOMOUS HEALING: Invalid category '${val}' mapped to '${mapped}'.`);
        return mapped;
      }
      return val;
    },
    z.enum(VALID_CATEGORIES)
  ).optional(),
  cwd: z.string().trim().min(1, 'Directory path for --cwd cannot be empty.').max(4096).optional(),
  add: z.array(
    z.string().max(4096).refine((s) => s.trim().length > 0, {
      message: 'File path for --add cannot be empty.',
    })
  ).optional(),
  journal: z.boolean().default(false),
  'journal-project': z.preprocess(
    parseCanonicalPositiveInt,
    z.number().int().positive().refine((n) => Number.isSafeInteger(n), { message: 'Project number must be a safe positive integer.' }).optional()
  ),
  'session-id': z.string().trim().min(1).max(256).optional(),
  tags: z.preprocess((val) => {
    if (val === undefined) return undefined;
    const rawItems = Array.isArray(val) ? val : [val];
    const normalized: unknown[] = [];
    for (const item of rawItems) {
      if (typeof item !== 'string') {
        normalized.push(item);
        continue;
      }
      const trimmed = item.trim();
      const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
      for (const token of inner.split(',')) {
        const clean = token.trim().replace(/^['"]|['"]$/g, '').trim();
        if (clean.length > 0) normalized.push(clean);
      }
    }
    return normalized;
  }, z.array(z.string().min(1).max(128)).min(1, 'At least one non-empty tag is required for --tags.').optional()),
  relate: z.preprocess(
    normalizeRelateSpecs,
    z.array(z.object({
      targetId: z.number().int().positive().refine((n) => Number.isSafeInteger(n), { message: 'Entry ID must be a safe positive integer.' }),
      relationType: z.enum(CANONICAL_RELATION_TYPES),
    })).min(1, 'At least one valid entry ID is required for --relate.').optional()
  ),
  'no-auto-link': z.boolean().default(false),
  'dry-run-links': z.boolean().default(false),
}).strict().transform((data) => {
  if (data['journal-project'] !== undefined && !data.journal) {
    console.warn("⚠️ AUTONOMOUS HEALING: --journal-project provided without --journal flag. Automatically enabling --journal.");
    data.journal = true;
  }
  return data;
});

export type CliArgs = z.infer<typeof cliSchema>;

function normalizeNegativeAndBulletArgs(rawArgs: string[]): void {
  for (let i = 0; i < rawArgs.length - 1; i++) {
    const currentArg = rawArgs[i];
    if (currentArg === '--') {
      break;
    }
    const nextArg = rawArgs[i + 1];
    const isNegativeNumericValue = nextArg.startsWith('-') && !Number.isNaN(Number(nextArg));
    if (currentArg === '-m' && (/^-\s/.test(nextArg) || isNegativeNumericValue)) {
      rawArgs[i] = `--msg=${nextArg}`;
      rawArgs.splice(i + 1, 1);
      continue;
    }
    if (!currentArg.startsWith('--') || currentArg.includes('=')) {
      continue;
    }
    const isMarkdownBulletHistoryOrMsg =
      (currentArg === '--history' || currentArg === '--msg' || currentArg === '--message') &&
      /^-\s/.test(nextArg);
    const isNegForStringFlag = isNegativeNumericValue && STRING_CLI_FLAGS.has(currentArg.slice(2));
    if (isNegForStringFlag || isMarkdownBulletHistoryOrMsg) {
      rawArgs[i] = `${currentArg}=${nextArg}`;
      rawArgs.splice(i + 1, 1);
    }
  }
}

function parseRawCli(rawArgs: string[]) {
  try {
    return parseArgs({ args: rawArgs, options: CLI_OPTIONS, allowPositionals: true });
  } catch (error: unknown) {
    return match(error)
      .with({ code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' }, (e) => fatalError(`Unknown CLI argument. ${getErrorMessage(e)}`))
      .otherwise((e) => fatalError(`Error parsing CLI arguments: ${getErrorMessage(e)}`));
  }
}

function mergeAliasFlagsAndPositionals(
  values: ReturnType<typeof parseRawCli>['values'],
  positionals: string[]
) {
  const hasMsg = values.msg !== undefined && values.msg.length > 0;
  const hasAliasMessage = values.message !== undefined && values.message.length > 0;
  const hasAnyMessageFlag = values.msg !== undefined || values.message !== undefined;
  const mergedValues = { ...values };

  if (hasMsg && hasAliasMessage) {
    console.warn("⚠️ AUTONOMOUS HEALING: Multiple commit messages provided via --msg and --message aliases. Using --msg.");
  }
  if (mergedValues.message !== undefined) {
    if ((!hasMsg && mergedValues.message.length > 0) || mergedValues.msg === undefined) {
      mergedValues.msg = mergedValues.message;
    }
    delete mergedValues.message;
  }
  if (mergedValues.tag !== undefined) {
    mergedValues.tags = [...(mergedValues.tags ?? []), ...mergedValues.tag];
    delete mergedValues.tag;
  }
  if (mergedValues.trust !== undefined) {
    if (mergedValues.confidence === undefined) {
      console.warn("⚠️ AUTONOMOUS HEALING: Deprecated --trust flag used. Mapping to --confidence.");
      mergedValues.confidence = mergedValues.trust;
    } else {
      console.warn("⚠️ AUTONOMOUS HEALING: Deprecated --trust flag ignored because --confidence was also provided. Using --confidence.");
    }
    delete mergedValues.trust;
  }
  if (positionals.length > 0) {
    if (hasAnyMessageFlag) {
      console.warn("⚠️ AUTONOMOUS HEALING: Extra positional arguments detected alongside --msg. Assuming these are space-separated files for --add.");
      mergedValues.add = [...(mergedValues.add ?? []), ...positionals];
    } else {
      mergedValues.msg = positionals[0];
      if (positionals.length > 1) {
        console.warn("⚠️ AUTONOMOUS HEALING: Multiple positional arguments detected. Assuming the first is the commit message and the rest are space-separated files for --add.");
        mergedValues.add = [...(mergedValues.add ?? []), ...positionals.slice(1)];
      }
    }
  }
  return mergedValues;
}

export function parseArguments(rawArgv?: readonly string[]): CliArgs {
  const rawArgs = [...(rawArgv ?? process.argv.slice(2))];
  normalizeNegativeAndBulletArgs(rawArgs);

  const { values, positionals } = parseRawCli(rawArgs);
  const mergedValues = mergeAliasFlagsAndPositionals(values, positionals);

  if (mergedValues.help) {
    showHelpAndExit();
  }

  const parsed = cliSchema.safeParse(mergedValues);
  if (!parsed.success) {
    if (parsed.error.issues.some((err) => err.path[0] === 'msg' && err.message.includes('Missing Commit Message!'))) {
      fatalError('CRITICAL: Missing Commit Message!');
    }
    console.error("🛠️ AUTONOMOUS HEALING: Invalid CLI arguments provided to commit.ts");
    for (const err of parsed.error.issues) {
      const field = err.path.join('.');
      const prefix = err.path.length > 0 ? `--${field}: ` : '';
      console.error(`- ${prefix}${formatZodValidationIssue(err, mergedValues)}`);
    }
    process.exit(1);
  }

  return parsed.data;
}
