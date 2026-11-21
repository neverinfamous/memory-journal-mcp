// @ts-nocheck
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { match, P } from 'ts-pattern';
import {
  VALID_CATEGORIES,
  TYPE_TO_CATEGORY,
  capitalizeCategory,
} from './commit-journal.js';

export const VALIDATION_STATES = ['passed', 'none', 'failed'] as const;
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

export const CONVENTIONAL_COMMIT_REGEX = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

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

export function fatalError(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    let msg = error.message;
    if ('stderr' in error && error.stderr !== null && error.stderr !== undefined) {
      msg += '\nSTDERR:\n' + String(error.stderr);
    }
    return msg;
  }
  return String(error);
}

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
  if (typeof val === 'string' && val.trim() === '') return Number.NaN;
  return Number(val);
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

function normalizeCommitMsg(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const normalized = val.replace(/\r\n/g, '\n');
  let firstLine = normalized.trim().split('\n')[0];
  let corrected = false;

  const strictMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
  if (strictMatch) {
    const [, type, scope, bang, subject] = strictMatch;
    if (type !== type.toLowerCase()) {
      firstLine = `${type.toLowerCase()}${scope ? `(${scope})` : ''}${bang || ''}: ${subject}`;
      corrected = true;
    }
  } else {
    const spaceMatch = firstLine.match(SPACE_CONVENTIONAL_RE);
    if (spaceMatch && VALID_COMMIT_TYPES.has(spaceMatch[1].toLowerCase())) {
      const [, type, scope, bang, subject] = spaceMatch;
      firstLine = `${type.toLowerCase()}${scope ? `(${scope})` : ''}${bang || ''}: ${subject}`;
      corrected = true;
    } else {
      firstLine = matchKeywordPrefix(firstLine);
      corrected = true;
    }
  }

  if (corrected) {
    console.warn(`⚠️ AUTONOMOUS HEALING: Auto-corrected commit message to conventional format: "${firstLine}"`);
    const lines = normalized.trim().split('\n');
    lines[0] = firstLine;
    return lines.join('\n');
  }
  return normalized;
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
      const aliased = RELATION_TYPE_ALIASES[rawRel];
      if (aliased !== undefined) {
        console.warn(`⚠️ AUTONOMOUS HEALING: Normalized --relate type '${rawRel}' to '${aliased}'.`);
      }
      const relationType = aliased ?? rawRel;
      const parsedId = CANONICAL_POSITIVE_INT_RE.test(idStr) ? Number(idStr) : Number.NaN;
      const targetId = Number.isSafeInteger(parsedId) && String(parsedId) === idStr ? parsedId : idStr;
      specs.push({ targetId, relationType });
    }
  }
  return specs.length > 0 ? specs : undefined;
}

// [BOUNDARY]: Strict Zod CLI schema boundary. [INVARIANT]: All inputs must be coerced and validated here. Do NOT implement manual validation downstream.
export const cliSchema = z.object({
  msg: z.preprocess(
    normalizeCommitMsg,
    z.string({ message: 'Missing Commit Message! You must provide a commit message using `--msg "..."` or as the first positional argument.' })
      .refine((val) => val.trim().split('\n')[0].length <= 200, { message: 'Too big: expected commit subject (first line) to be <=200 characters' })
      .refine((val) => {
        const firstLine = val.trim().split('\n')[0];
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
  significance: z.string().max(100).optional(),
  category: z.preprocess(
    (val) => {
      if (typeof val !== 'string') return val;
      const cap = capitalizeCategory(val);
      if ((VALID_CATEGORIES as readonly string[]).includes(cap)) return cap;

      const mapped = TYPE_TO_CATEGORY[val.toLowerCase()];
      if (mapped !== undefined) {
        console.warn(`⚠️ AUTONOMOUS HEALING: Invalid category '${val}' mapped to '${mapped}'.`);
        return mapped;
      }
      return val;
    },
    z.enum(VALID_CATEGORIES)
  ).optional(),
  cwd: z.string().max(4096).optional(),
  add: z.array(z.string().max(4096)).optional(),
  journal: z.boolean().default(false),
  'journal-project': z.preprocess(
    parseCanonicalPositiveInt,
    z.number().int().positive().refine((n) => Number.isSafeInteger(n), { message: 'Project number must be a safe positive integer.' }).optional()
  ),
  'session-id': z.string().trim().min(1).max(256).optional(),
  tags: z.preprocess((val) => {
    if (val === undefined) return undefined;
    const rawItems = Array.isArray(val) ? val : [val];
    const normalized: string[] = [];
    for (const item of rawItems) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
      for (const token of inner.split(',')) {
        const clean = token.trim().replace(/^['"]|['"]$/g, '').trim();
        if (clean.length > 0) normalized.push(clean);
      }
    }
    return normalized.length > 0 ? normalized : undefined;
  }, z.array(z.string().min(1).max(128)).optional()),
  relate: z.preprocess(
    normalizeRelateSpecs,
    z.array(z.object({
      targetId: z.number().int().positive().refine((n) => Number.isSafeInteger(n), { message: 'Entry ID must be a safe positive integer.' }),
      relationType: z.enum(CANONICAL_RELATION_TYPES),
    })).optional()
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

function showHelpAndExit(): never {
  console.log(`Usage: bun commit.ts [commit message] [options]

Options:
  --msg, -m <string>     Conventional commit message (alias: --message; or provide as first positional argument)
  --history <string>     History narrative. Prefix with 'Category: ' to explicitly set category.
  --history-file <path>  Path to a file containing the history narrative (prevents shell escaping issues).
  --no-history           Skip history entry for trivial changes.
  --impact <number>      Impact score (0.0 to 1.0).
  --trust <number>       Trust score (0.0 to 1.0) (deprecated, prefer --confidence).
  --confidence <number>  Confidence score (0.0 to 1.0).
  --validation <string>  Validation status ('passed', 'none', 'failed').
  --significance <string> Significance type (e.g. 'milestone', 'security', 'breakthrough').
  --category <string>    Explicit category override (e.g. 'Added', 'Fixed').
  --add <path>           Explicitly stage these files before committing. Can be used multiple times (or provide as additional positional arguments).
  --cwd <path>           Explicit working directory for the git command.
  --journal              Automatically create a memory journal entry for this commit (auto-populates file anchors).
  --journal-project <id> Specify the project ID for the journal entry (auto-resolved from projectRegistry if omitted).
  --session-id <id>      Conversation/session ID to attach to the automated journal entry.
  --tags <tag>           Add tag(s) to the automated journal entry (alias: --tag; repeatable or comma-separated).
  --relate <id[:type]>   Link commit journal entry to an existing entry (e.g. '14653:evolves_from'; repeatable/comma-separated; aliases resolves/depends_on/relates_to supported).
  --no-auto-link         Disable frontmatter auto_link: true heuristic linking in the automated journal entry.
  --dry-run-links        Forward --dry-run-links to memory-journal-mcp entry create (preview suggested_links without persisting).
  --help                 Show this help message.
  
🤖 AI AGENT INSTRUCTIONS:
- MULTI-LINE HISTORY: ALWAYS write history to your conversation scratch dir (e.g. \`<scratch_dir>/hist.txt\`) and use \`--history-file <path>\` instead of \`--history\` to prevent shell escaping failures.
- MESSAGE FORMAT: The commit message (\`--msg\` or first positional argument) MUST strictly follow conventional commits: \`type(scope): subject\`.
- REQUIRED FLAGS: You MUST provide \`--impact\`, \`--confidence\`, and \`--validation\`.
- STAGING: Stage ONLY explicit modified files using \`--add <path>\` (or additional positional arguments) to keep commits atomic; avoid wildcard \`--add .\`.
- EXAMPLE: bun commit.ts "fix(cli): resolve option errors" --history-file "<scratch_dir>/hist.txt" --impact 0.6 --confidence 1.0 --validation passed --add "src/index.ts"`);
  process.exit(0);
}

function normalizeNegativeAndBulletArgs(rawArgs: string[]): void {
  for (let i = 0; i < rawArgs.length - 1; i++) {
    const currentArg = rawArgs[i];
    const nextArg = rawArgs[i + 1];
    const isNegativeNumericValue = nextArg.startsWith('-') && !Number.isNaN(Number(nextArg));
    const isMarkdownBulletHistoryOrMsg =
      (currentArg === '--history' || currentArg === '--msg' || currentArg === '--message') &&
      /^-\s/.test(nextArg);
    if (
      currentArg.startsWith('--') &&
      !currentArg.includes('=') &&
      (isNegativeNumericValue || isMarkdownBulletHistoryOrMsg)
    ) {
      rawArgs[i] = `${currentArg}=${nextArg}`;
      rawArgs.splice(i + 1, 1);
      i--;
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
  const hasMessageFlag = !!(values.msg || values.message);
  const mergedValues = { ...values };

  if (values.msg && values.message) {
    console.warn("⚠️ AUTONOMOUS HEALING: Multiple commit messages provided via --msg and --message aliases. Using --msg.");
  }
  if (mergedValues.message) {
    mergedValues.msg = mergedValues.msg || mergedValues.message;
    delete mergedValues.message;
  }
  if (mergedValues.tag !== undefined) {
    mergedValues.tags = [...(mergedValues.tags ?? []), ...mergedValues.tag];
    delete mergedValues.tag;
  }
  if (mergedValues.trust !== undefined && mergedValues.confidence === undefined) {
    console.warn("⚠️ AUTONOMOUS HEALING: Deprecated --trust flag used. Mapping to --confidence.");
    mergedValues.confidence = mergedValues.trust;
  }
  if (positionals.length > 0) {
    if (hasMessageFlag) {
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

export function formatZodValidationIssue(
  err: z.ZodIssue,
  mergedValues: ReturnType<typeof mergeAliasFlagsAndPositionals>
): string {
  return match(err)
    .with({ code: 'too_small', origin: 'string' }, (e) => `Too small: expected string length to be ${e.inclusive ? '>=' : '>'}${e.minimum}`)
    .with({ code: 'too_small', origin: 'array' }, (e) => `Too small: expected array length to be ${e.inclusive ? '>=' : '>'}${e.minimum}`)
    .with({ code: 'too_small', origin: P.union('number', 'int') }, (e) => `Too small: expected number to be ${e.inclusive ? '>=' : '>'}${e.minimum}`)
    .with({ code: 'too_big', origin: 'string' }, (e) => `Too big: expected string length to be ${e.inclusive ? '<=' : '<'}${e.maximum}`)
    .with({ code: 'too_big', origin: 'array' }, (e) => `Too big: expected array length to be ${e.inclusive ? '<=' : '<'}${e.maximum}`)
    .with({ code: 'too_big', origin: P.union('number', 'int') }, (e) => `Too big: expected number to be ${e.inclusive ? '<=' : '<'}${e.maximum}`)
    .with({ code: 'unrecognized_keys' }, (e) => `Unrecognized keys: ${e.keys.join(', ')}`)
    .with({ code: P.string, path: ['validation'] }, () => {
      const states = VALIDATION_STATES.map((v) => `'--validation ${v}'`).join(', ');
      if (mergedValues.validation === undefined) {
        return `Missing required flag. You MUST append one of: ${states} to your command.`;
      }
      return `Invalid validation status '${mergedValues.validation}'. You MUST append one of: ${states} to your command.`;
    })
    .with(
      { code: P.string, path: ['category'] },
      () => `Invalid explicit category '${mergedValues.category}'. Must be one of: ${VALID_CATEGORIES.join(', ')}`
    )
    .with(
      { code: 'invalid_type', path: ['relate', P.number, 'targetId'] },
      () => 'Invalid entry ID in --relate. Expected a positive integer entry ID (e.g. 14653:evolves_from).'
    )
    .with(
      { code: 'invalid_type', received: P.union('nan', 'NaN') },
      (e) => `Invalid data type for --${String(e.path[0])}. Expected a number, but received a non-numeric value.`
    )
    .with({ code: 'invalid_type', path: ['impact'] }, () => `Missing required flag. You MUST append an impact score (e.g. '--impact 0.5').`)
    .with({ code: 'invalid_type', path: ['confidence'] }, () => `Missing required flag. You MUST append a confidence score (e.g. '--confidence 1.0').`)
    .with({ code: 'invalid_type' }, () => `Missing required flag.`)
    .otherwise((e) => e.message);
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
