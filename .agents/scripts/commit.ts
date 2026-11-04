import { execSync, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { z } from 'zod';
import { match, P } from 'ts-pattern';

const VALID_CATEGORIES = ['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Deprecated'] as const;
const VALIDATION_STATES = ['passed', 'none', 'failed'] as const;
const CONVENTIONAL_COMMIT_REGEX = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const HISTORY_CATEGORY_REGEX = /^([A-Za-z]+):\s*([\s\S]+)$/;
const COMMIT_MSG_PREFIX = 'commit-msg-';
const JOURNAL_PREFIX = 'journal-';

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
} as const;

function capitalize(val: string): string {
  return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
}

function fatalError(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    let msg = error.message;
    if ('stderr' in error && error.stderr) {
      msg += '\nSTDERR:\n' + String(error.stderr);
    }
    return msg;
  }
  return String(error);
}

function isValidCategory(cat: string): cat is typeof VALID_CATEGORIES[number] {
  return VALID_CATEGORIES.some((c) => c === cat);
}

const TYPE_TO_CATEGORY: Record<string, typeof VALID_CATEGORIES[number]> = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  remove: 'Removed',
  drop: 'Removed',
  security: 'Security',
  docs: 'Changed',
  style: 'Changed',
  test: 'Changed',
  chore: 'Changed',
};

// [BOUNDARY]: Strict Zod CLI schema boundary. [INVARIANT]: All inputs must be coerced and validated here. Do NOT implement manual validation downstream.
export const cliSchema = z.object({
  msg: z.preprocess((val) => {
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
      const spaceMatch = firstLine.match(/^([A-Za-z0-9_-]+)(?:\s*\(\s*([^)]+?)\s*\))?\s*(!)?[\s:]+(.+)$/);
      if (spaceMatch) {
        const [, type, scope, bang, subject] = spaceMatch;
        const lowerType = type.toLowerCase();
        const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
        if (validTypes.includes(lowerType)) {
          firstLine = `${lowerType}${scope ? `(${scope})` : ''}${bang || ''}: ${subject}`;
          corrected = true;
        }
      }

      if (!corrected) {
        const lowerFirst = firstLine.toLowerCase();
        let matchedType = 'chore';
        let strippedFirst = firstLine;
        const keywordMap: Record<string, string> = {
          fix: 'fix', resolve: 'fix', patch: 'fix',
          add: 'feat', implement: 'feat', introduce: 'feat',
          doc: 'docs', readme: 'docs',
          test: 'test', spec: 'test',
          refactor: 'refactor', restructure: 'refactor'
        };
        for (const [kw, t] of Object.entries(keywordMap)) {
          if (lowerFirst.startsWith(kw)) {
            matchedType = t;
            const replaced = firstLine.replace(new RegExp(`^${kw}\\s*`, 'i'), '');
            if (replaced.length > 0) {
              strippedFirst = replaced.charAt(0).toLowerCase() + replaced.slice(1);
            }
            break;
          }
        }
        firstLine = `${matchedType}: ${strippedFirst}`;
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
  }, z.string({ message: "Missing Commit Message! You must provide a commit message using `--msg \"...\"` or as the first positional argument." })
    .refine((val) => val.trim().split('\n')[0].length <= 200, { message: "Too big: expected commit subject (first line) to be <=200 characters" })
    .refine((val) => {
      const firstLine = val.trim().split('\n')[0];
      return CONVENTIONAL_COMMIT_REGEX.test(firstLine);
    }, { message: "must follow conventional commit format (e.g., 'feat(core): subject' or 'feat!: breaking')." })),
  history: z.string().optional(),
  'history-file': z.string().max(4096).optional(),
  'no-history': z.boolean().default(false),
  help: z.boolean().default(false),
  impact: z.preprocess((val) => {
    return val === undefined ? undefined : Number(val);
  }, z.number().min(0.0).max(1.0)),
  trust: z.preprocess((val) => val === undefined ? undefined : Number(val), z.number().min(0.0).max(1.0)).optional(),
  confidence: z.preprocess((val) => {
    return val === undefined ? undefined : Number(val);
  }, z.number().min(0.0).max(1.0)),
  validation: z.preprocess((val) => {
    if (val === undefined) {
      return undefined;
    }
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (['pass', 'yes', 'true', 'ok', 'passed'].includes(lower)) {
        if (val !== 'passed') console.warn(`⚠️ AUTONOMOUS HEALING: Normalized validation state '${val}' to 'passed'.`);
        return 'passed';
      }
      if (['fail', 'no', 'false', 'error', 'failed'].includes(lower)) {
        if (val !== 'failed') console.warn(`⚠️ AUTONOMOUS HEALING: Normalized validation state '${val}' to 'failed'.`);
        return 'failed';
      }
      if (['skip', 'skipped', 'not-run', 'na', 'n_a', 'none'].includes(lower)) {
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
      const cap = capitalize(val);
      if ((VALID_CATEGORIES as readonly string[]).includes(cap)) return cap;

      const mapped = TYPE_TO_CATEGORY[val.toLowerCase()];
      if (mapped) {
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
  'journal-project': z.coerce.number().int().finite().positive().optional(),
}).strict().transform(data => {
  if (data['journal-project'] !== undefined && !data.journal) {
    console.warn("⚠️ AUTONOMOUS HEALING: --journal-project provided without --journal flag. Automatically enabling --journal.");
    data.journal = true;
  }
  return data;
});

type CliArgs = z.infer<typeof cliSchema>;

function parseArguments(): CliArgs {
  const rawArgs = process.argv.slice(2);

  for (let i = 0; i < rawArgs.length - 1; i++) {
    if (
      rawArgs[i].startsWith('--') &&
      !rawArgs[i].includes('=') &&
      rawArgs[i + 1].startsWith('-') &&
      !Number.isNaN(Number(rawArgs[i + 1]))
    ) {
      rawArgs[i] = `${rawArgs[i]}=${rawArgs[i + 1]}`;
      rawArgs.splice(i + 1, 1);
      i--; // adjust index since we mutated the array
    }
  }

  function parseCLI() {
    try {
      return parseArgs({ args: rawArgs, options: CLI_OPTIONS, allowPositionals: true });
    } catch (error: unknown) {
      return match(error)
        .with({ code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' }, (e) => fatalError(`Unknown CLI argument. ${getErrorMessage(e)}`))
        .otherwise((e) => fatalError(`Error parsing CLI arguments: ${getErrorMessage(e)}`));
    }
  }

  const cliResult = parseCLI();
  const values = cliResult.values;
  const positionals = cliResult.positionals;

  const hasMessageFlag = !!(values.msg || values.message);
  const mergedValues = { ...values };

  if (values.msg && values.message) {
    console.warn("⚠️ AUTONOMOUS HEALING: Multiple commit messages provided via --msg and --message aliases. Using --msg.");
  }

  if (mergedValues.message) {
    mergedValues.msg = mergedValues.msg || mergedValues.message;
    delete mergedValues.message;
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

  if (mergedValues.help) {
    showHelpAndExit();
  }

  const parsed = cliSchema.safeParse(mergedValues);
  if (!parsed.success) {
    if (parsed.error.issues.some(err => err.path[0] === 'msg' && err.message.includes('Missing Commit Message!'))) {
      fatalError('CRITICAL: Missing Commit Message!');
    }
    console.error("🛠️ AUTONOMOUS HEALING: Invalid CLI arguments provided to commit.ts");
    parsed.error.issues.forEach(err => {
      const field = err.path.join('.');

      const formattedMsg = match(err)
        .with({ code: 'too_small', type: 'string' }, (e) => `Too small: expected string length to be ${e.inclusive ? '>=' : '>'}${e.minimum}`)
        .with({ code: 'too_small', type: 'array' }, (e) => `Too small: expected array length to be ${e.inclusive ? '>=' : '>'}${e.minimum}`)
        .with({ code: 'too_small', type: 'number' }, (e) => `Too small: expected number to be ${e.inclusive ? '>=' : '>'}${e.minimum}`)
        .with({ code: 'too_big', type: 'string' }, (e) => `Too big: expected string length to be ${e.inclusive ? '<=' : '<'}${e.maximum}`)
        .with({ code: 'too_big', type: 'array' }, (e) => `Too big: expected array length to be ${e.inclusive ? '<=' : '<'}${e.maximum}`)
        .with({ code: 'too_big', type: 'number' }, (e) => `Too big: expected number to be ${e.inclusive ? '<=' : '<'}${e.maximum}`)
        .with({ code: 'unrecognized_keys' }, (e) => `Unrecognized keys: ${e.keys.join(', ')}`)
        .with(
          { code: P.string, path: ['validation'] },
          () => {
            if (mergedValues.validation === undefined) {
              return `Missing required flag. You MUST append one of: ${VALIDATION_STATES.map(v => `'--validation ${v}'`).join(', ')} to your command.`;
            }
            return `Invalid validation status '${mergedValues.validation}'. You MUST append one of: ${VALIDATION_STATES.map(v => `'--validation ${v}'`).join(', ')} to your command.`;
          }
        )
        .with(
          { code: P.string, path: ['category'] },
          () => `Invalid explicit category '${mergedValues.category}'. Must be one of: ${VALID_CATEGORIES.join(', ')}`
        )
        .with(
          { code: 'invalid_type', received: P.union('nan', 'NaN') },
          (e) => `Invalid data type for --${String(e.path[0])}. Expected a number, but received a non-numeric value.`
        )
        .with(
          { code: 'invalid_type', path: ['validation'] },
          () => `Missing required flag. You MUST append one of: ${VALIDATION_STATES.map(v => `'--validation ${v}'`).join(', ')} to your command.`
        )
        .with(
          { code: 'invalid_type', path: ['impact'] },
          () => `Missing required flag. You MUST append an impact score (e.g. '--impact 0.5').`
        )
        .with(
          { code: 'invalid_type', path: ['confidence'] },
          () => `Missing required flag. You MUST append a confidence score (e.g. '--confidence 1.0').`
        )
        .with(
          { code: 'invalid_type' },
          () => `Missing required flag.`
        )
        .otherwise((e) => e.message);

      const prefix = err.path.length > 0 ? `--${field}: ` : '';
      console.error(`- ${prefix}${formattedMsg}`);
    });
    process.exit(1);
  }

  return parsed.data;
}

function showHelpAndExit(): never {
  console.log(`Usage: bun commit.ts [commit message] [options]

Options:
  --msg <string>         Conventional commit message (e.g. 'feat(core): subject') (or provide as first positional argument)
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
  --journal              Automatically create a memory journal entry for this commit.
  --journal-project <id> Specify the project ID for the journal entry (defaults to omitting it).
  --help                 Show this help message.

🤖 AI AGENT INSTRUCTIONS:
- MULTI-LINE HISTORY: ALWAYS write history to a scratch file (e.g. \`scratch/hist.txt\`) and use \`--history-file <path>\` instead of \`--history\` to prevent shell escaping failures.
- MESSAGE FORMAT: The commit message (\`--msg\` or first positional argument) MUST strictly follow conventional commits: \`type(scope): subject\`.
- REQUIRED FLAGS: You MUST provide \`--impact\`, \`--confidence\`, and \`--validation\`.
- STAGING: Try to stage ONLY the specific files you modified using \`--add <path>\` (or additional positional arguments) to keep commits atomic. Wildcard staging (\`--add .\`) is supported as a fallback for unified sweeping changes.
- EXAMPLE: bun commit.ts "fix(cli): resolve option errors" --history-file "scratch/hist.txt" --impact 0.6 --confidence 1.0 --validation passed "src/index.ts"`);
  process.exit(0);
}



// [INTENT]: Validates the git index state to prevent accidental staging of agent scratch payloads. [SIDE-EFFECT]: Aborts process if '.agents/scratch' paths are detected in the staging area. [AGENT-HINT]: Do NOT bypass this check; it is a critical safeguard for the project repository.
const BINARY_EXTENSIONS = new Set([
  '.db', '.wasm', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.pdf', '.zip', '.gz', '.node',
])

/** Match the workspace save rules: LF, no trailing spaces, one final newline. */
function canonicalizeText(text: string): string {
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = lf.split('\n');
  if (lf.endsWith('\n')) lines.pop();
  const trimmed = lines.map((line) => line.replace(/[ \t]+$/g, ''));
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  if (trimmed.length === 0) return '';
  return `${trimmed.join('\n')}\n`;
}

function normalizeTextFile(filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return;
  }
  if (!stat.isFile()) return;
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0)) return;
  const text = buf.toString('utf8');
  const next = canonicalizeText(text);
  if (next !== text) fs.writeFileSync(filePath, next);
}

function filesToNormalize(cwd: string, target: string): string[] {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  let status = '';
  try {
    status = execFileSync('git', ['status', '-z', '--', target], { cwd, encoding: 'utf8' });
  } catch {
    return [];
  }
  const files: string[] = [];
  const parts = status.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part.length < 4) continue;
    const statusCode = part.slice(0, 2);
    if (statusCode.includes('D')) continue;
    let filepath = part.slice(3);
    if (statusCode.includes('R') || statusCode.includes('C')) {
      i += 1;
      const renamed = parts[i];
      if (renamed !== undefined && renamed !== '') filepath = renamed;
    }
    if (filepath === '') continue;
    files.push(path.resolve(cwd, filepath));
  }
  return files;
}

function ensureStagedFiles(cwd: string, filesToAdd?: string[]): void {
  if (filesToAdd && filesToAdd.length > 0) {
    for (const target of filesToAdd) {
      for (const filePath of filesToNormalize(cwd, target)) normalizeTextFile(filePath)
    }
    try {
      execFileSync('git', ['add', ...filesToAdd], { stdio: 'inherit', cwd });
    } catch (e) {
      fatalError(`Error adding files: ${getErrorMessage(e)}`);
    }
  }

  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8', cwd }).trim();
    const resolvedGitDir = path.resolve(cwd, gitDir);
    if (fs.existsSync(path.join(resolvedGitDir, 'MERGE_HEAD')) ||
        fs.existsSync(path.join(resolvedGitDir, 'rebase-merge')) ||
        fs.existsSync(path.join(resolvedGitDir, 'rebase-apply'))) {
      fatalError('Repository is in a merge/rebase state. Resolve conflicts first.');
    }
  } catch {
    // Ignore error here and let git status catch it properly
  }

  let status: string;
  try {
    status = execSync('git status -z', { encoding: 'utf-8', cwd });
  } catch (e) {
    fatalError(`Not a git repository or git command failed.\n${getErrorMessage(e)}`);
  }

  const parts = status.split('\0');
  const stagedScratchFiles: string[] = [];
  let hasStagedFiles = false;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part) {
      i++;
      continue;
    }
    const indexStatus = part[0];
    const workTreeStatus = part[1];
    const filepath = part.substring(3);

    if (indexStatus !== ' ' && indexStatus !== '?') {
      hasStagedFiles = true;
      if (indexStatus !== 'D') {
        if (filepath.includes('scratch/') || filepath.includes('.agents/scratch') || filepath.endsWith('scratch.ts') || filepath.endsWith('scratch.js')) {
          stagedScratchFiles.push(filepath);
        }
      }
    }

    if (indexStatus === 'R' || indexStatus === 'C' || workTreeStatus === 'R' || workTreeStatus === 'C') {
      i += 2;
    } else {
      i += 1;
    }
  }

  if (!hasStagedFiles) {
    console.error('🛠️ AUTONOMOUS HEALING: No files staged for commit.');
    console.error('You MUST explicitly stage the files you want to commit using `git add <file-path>` before running this wrapper.');
    console.error('If you used `git add .` or `--add .`, ensure you actually had modified files to stage.');
    const shortStatus = execSync('git status --short', { encoding: 'utf-8', cwd });
    if (shortStatus.trim()) {
      console.error('Current status:');
      console.error(shortStatus);
    }
    fatalError('No files staged for commit.');
  }

  if (stagedScratchFiles.length > 0) {
    console.error('🛠️ AUTONOMOUS HEALING: Scratch files detected in staging area.');
    console.error('You MUST NOT commit scratch scripts, test data, or debug payloads. Please unstage the following files:');
    for (const file of stagedScratchFiles) {
      console.error(`- ${file}`);
    }
    fatalError('Commit aborted: Scratch files staged.');
  }
}

function parseCategory(history: string, type: string): { category: string; entry: string } {
  const cleanHistory = history.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const categoryMatch = cleanHistory.match(HISTORY_CATEGORY_REGEX);

  if (categoryMatch) {
    const matchedCat = categoryMatch[1];
    const capitalizedMatch = capitalize(matchedCat);

    if (isValidCategory(capitalizedMatch)) {
      return { category: capitalizedMatch, entry: categoryMatch[2].trim() };
    }

    const mapped = TYPE_TO_CATEGORY[matchedCat.toLowerCase()];
    if (mapped) {
      console.warn(`⚠️ AUTONOMOUS HEALING: Invalid history category '${matchedCat}' mapped to '${mapped}'.`);
      return { category: mapped, entry: categoryMatch[2].trim() };
    }

    console.warn(`⚠️ AUTONOMOUS HEALING: Unrecognized history category '${matchedCat}'. Falling back to default category.`);
    return { category: TYPE_TO_CATEGORY[type] || 'Changed', entry: categoryMatch[2].trim() };
  }

  const category = TYPE_TO_CATEGORY[type] || 'Changed';
  return { category, entry: cleanHistory.trim() };
}

const tempFilesToCleanup = new Set<string>();
process.on('exit', () => {
  for (const file of tempFilesToCleanup) {
    cleanupTempFile(file);
  }
});

function cleanupTempFile(filepath: string): void {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    tempFilesToCleanup.delete(filepath);
  } catch { /* ignore */ }
}

function shouldCreateJournal(args: CliArgs, _historyContent: string): boolean {
  return args.journal;
}

function generateHistoryEntry(args: CliArgs, type: string, historyContent: string): string {
  const parsedCategory = parseCategory(historyContent, type);
  const category = args.category || parsedCategory.category;

  let entry = parsedCategory.entry;

  if (entry) {
    entry = entry
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim() === '' ? '\u200B' : line)
      .join('\n')
      .replace(/\n/g, '\n  ');
  }

  let body = `\n\nHistory-Category: ${category}`;

  if (entry || !args['no-history']) {
      body += `\nHistory-Entry: ${entry}`;
  }

  if (args.significance) {
    body += `\nHistory-Significance: ${args.significance}`;
  }
  body += `\nHistory-Impact: ${args.impact}`;
  body += `\nHistory-Confidence: ${args.confidence}`;
  body += `\nHistory-Validation: ${args.validation}`;
  if (shouldCreateJournal(args, historyContent)) {
    body += `\nHistory-Journal: true`;
    if (args['journal-project'] !== undefined) {
      body += `\nHistory-Journal-Project: ${args['journal-project']}`;
    }
  }

  return body;
}

// [INTENT]: Executes native git commit. [SIDE-EFFECT]: Writes the commit message to a temporary file on disk rather than passing it inline to prevent shell escaping traps. [DEPENDENCY]: Relies on node:os and node:crypto for safe temp file generation.
function executeCommit(header: string, body: string, cwd?: string): string {
  const msgFile = path.join(os.tmpdir(), `${COMMIT_MSG_PREFIX}${crypto.randomUUID()}.txt`);
  tempFilesToCleanup.add(msgFile);
  fs.writeFileSync(msgFile, `${header}${body}`);
  try {
    execFileSync('git', ['commit', '-F', msgFile], { stdio: 'inherit', cwd });
  } finally {
      cleanupTempFile(msgFile);
  }

  const sha = execSync('git log -1 --format=%h', { encoding: 'utf-8', cwd }).trim();
  console.log(`\n✅ Successfully committed ${sha}`);
  console.log(`__COMMIT_SHA__:${sha}`);

  return sha;
}

function createJournalEntry(sha: string, header: string, args: CliArgs, historyContent: string, cwd?: string): void {
  if (!shouldCreateJournal(args, historyContent)) {
    return;
  }

  console.log(`\n📓 Creating automated journal entry for ${sha}...`);
  try {
    const frontmatterLines = [
      '---',
      'type: "architecture"',
      'tags: ["commit-narrative"]'
    ];

    if (args['journal-project']) {
      frontmatterLines.push(`project: ${args['journal-project']}`);
    }

    frontmatterLines.push(`impact: ${args.impact}`);
    frontmatterLines.push(`trust: ${args.confidence}`);
    frontmatterLines.push(`validation_status: "${args.validation}"`);

    frontmatterLines.push('auto_context:');
    frontmatterLines.push('  type: "session-commits"');
    frontmatterLines.push(`  commits: ["${sha}"]`);
    frontmatterLines.push('---');

    const journalBody = historyContent || header;
    const journalContent = `${frontmatterLines.join('\n')}\n${journalBody}\n\nCommit: ${sha}`;

    const journalFile = path.join(os.tmpdir(), `${JOURNAL_PREFIX}${sha}.md`);
    tempFilesToCleanup.add(journalFile);
    fs.writeFileSync(journalFile, journalContent);

    try {
      execFileSync('memory-journal-mcp', ['entry', 'create', '--file', journalFile], { stdio: 'inherit', shell: process.platform === 'win32', cwd });
    } finally {
        cleanupTempFile(journalFile);
    }
  } catch (e) {
    console.error(`\n⚠️ Failed to create journal entry: ${getErrorMessage(e)}`);
  }
}

function main(): void {
  try {
    const args = parseArguments();

    let cwd = process.cwd();
    if (args.cwd) {
      const targetCwd = path.resolve(args.cwd);
      if (!fs.existsSync(targetCwd) || !fs.statSync(targetCwd).isDirectory()) {
        fatalError(`Commit failed: Directory does not exist or is not a directory: ${targetCwd}`);
      }
      cwd = targetCwd;
    }

    if (args.add) {
      args.add = args.add.flatMap(p => {
        const resolved = path.resolve(cwd, p);
        if (!fs.existsSync(resolved) && p.includes(' ')) {
          console.warn(`⚠️ AUTONOMOUS HEALING: Path '${p}' not found and contains spaces. Splitting by space to recover hallucinated --add list.`);
          return p.split(' ').filter(Boolean).map(sp => path.resolve(cwd, sp));
        }
        return resolved;
      });
    }

    const firstLine = args.msg.trim().split('\n')[0];
    const commitMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
    const type = commitMatch ? commitMatch[1] : 'chore';
    ensureStagedFiles(cwd, args.add);

    let historyContent = args.history ? args.history.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') : '';
    if (args['history-file']) {
      const resolvedPath = path.resolve(args['history-file']);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`⚠️ AUTONOMOUS HEALING: History file '${args['history-file']}' not found. Defaulting to --no-history.`);
        args['no-history'] = true;
      } else {
        try {
          historyContent = fs.readFileSync(resolvedPath, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        } catch (e) {
          fatalError(`Error reading history file: ${getErrorMessage(e)}`);
        }
      }
    }

    if (!historyContent && !args['no-history']) {
      console.warn("⚠️ AUTONOMOUS HEALING: Missing history flag detected. Defaulting to --no-history.");
      args['no-history'] = true;
    }

    const body = generateHistoryEntry(args, type, historyContent);
    const sha = executeCommit(args.msg, body, cwd);
    createJournalEntry(sha, args.msg, args, historyContent, cwd);

  } catch (error) {
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    fatalError(`Commit failed: ${getErrorMessage(error)}`);
  }
}

if (import.meta.main) {
  main();
}
