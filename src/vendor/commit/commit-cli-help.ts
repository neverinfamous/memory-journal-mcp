// @ts-nocheck
import { type z } from 'zod';
import { match, P } from 'ts-pattern';
import { VALID_CATEGORIES } from './commit-journal.js';
import { redactSensitiveText } from './commit-security.js';

export const VALIDATION_STATES = ['passed', 'none', 'failed'] as const;
export const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;
const CANONICAL_DECIMAL_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseCanonicalPositiveInt(val: unknown): unknown {
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

export function parseStrictScoreNumber(val: unknown): unknown {
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

export function fatalError(msg: string): never {
  console.error(`❌ ${redactSensitiveText(msg)}`);
  process.exit(1);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    let msg = error.message;
    if ('stderr' in error && error.stderr !== null && error.stderr !== undefined) {
      const rawStderr = error.stderr;
      const stderrText =
        typeof rawStderr === 'string'
          ? rawStderr
          : Buffer.isBuffer(rawStderr)
            ? rawStderr.toString('utf8')
            : typeof rawStderr === 'number' || typeof rawStderr === 'boolean'
              ? String(rawStderr)
              : JSON.stringify(rawStderr);
      msg += '\nSTDERR:\n' + stderrText;
    }
    return redactSensitiveText(msg);
  }
  return redactSensitiveText(String(error));
}

export function showHelpAndExit(): never {
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

export function formatZodValidationIssue(
  err: z.ZodIssue,
  mergedValues: { validation?: string | undefined; category?: string | undefined }
): string {
  return match(err)
    .with({ code: 'too_small', origin: 'string' }, (e) =>
      e.message.startsWith('Too small:')
        ? `Too small: expected string length to be ${e.inclusive ? '>=' : '>'}${e.minimum}`
        : e.message
    )
    .with({ code: 'too_small', origin: 'array' }, (e) =>
      e.message.startsWith('Too small:')
        ? `Too small: expected array length to be ${e.inclusive ? '>=' : '>'}${e.minimum}`
        : e.message
    )
    .with({ code: 'too_small', origin: P.union('number', 'int') }, (e) =>
      e.message.startsWith('Too small:')
        ? `Too small: expected number to be ${e.inclusive ? '>=' : '>'}${e.minimum}`
        : e.message
    )
    .with({ code: 'too_big', origin: 'string' }, (e) =>
      e.message.startsWith('Too big:')
        ? `Too big: expected string length to be ${e.inclusive ? '<=' : '<'}${e.maximum}`
        : e.message
    )
    .with({ code: 'too_big', origin: 'array' }, (e) =>
      e.message.startsWith('Too big:')
        ? `Too big: expected array length to be ${e.inclusive ? '<=' : '<'}${e.maximum}`
        : e.message
    )
    .with({ code: 'too_big', origin: P.union('number', 'int') }, (e) =>
      e.message.startsWith('Too big:')
        ? `Too big: expected number to be ${e.inclusive ? '<=' : '<'}${e.maximum}`
        : e.message
    )
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
      { code: 'invalid_type', message: P.when((m: string) => /received nan\b/i.test(m)) },
      (e) => `Invalid data type for --${String(e.path[0])}. Expected a number, but received a non-numeric value.`
    )
    .with(
      { code: 'invalid_type', path: ['impact'], message: P.when((m: string) => /received undefined\b/i.test(m)) },
      () => `Missing required flag. You MUST append an impact score (e.g. '--impact 0.5').`
    )
    .with(
      { code: 'invalid_type', path: ['confidence'], message: P.when((m: string) => /received undefined\b/i.test(m)) },
      () => `Missing required flag. You MUST append a confidence score (e.g. '--confidence 1.0').`
    )
    .with(
      { code: 'invalid_type', message: P.when((m: string) => /received undefined\b/i.test(m)) },
      () => `Missing required flag.`
    )
    .otherwise((e) => e.message);
}
