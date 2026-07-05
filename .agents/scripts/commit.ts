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

const cliSchema = z.object({
  msg: z.string({ message: "Missing Commit Message! You must provide a commit message using `--msg \"...\"` or as the first positional argument." })
    .refine((val) => val.trim().split('\n')[0].length <= 200, { message: "Too big: expected commit subject (first line) to be <=200 characters" })
    .refine((val) => {
      const firstLine = val.trim().split('\n')[0];
      return CONVENTIONAL_COMMIT_REGEX.test(firstLine);
    }, { message: "must follow conventional commit format (e.g., 'feat(core): subject' or 'feat!: breaking')." }),
  history: z.string().optional(),
  'history-file': z.string().max(4096).optional(),
  'no-history': z.boolean().default(false),
  help: z.boolean().default(false),
  impact: z.preprocess((val) => val === undefined ? undefined : Number(val), z.number().min(0.0).max(1.0)),
  trust: z.preprocess((val) => val === undefined ? undefined : Number(val), z.number().min(0.0).max(1.0)).optional(),
  confidence: z.preprocess((val) => val === undefined ? undefined : Number(val), z.number().min(0.0).max(1.0)),
  validation: z.enum(VALIDATION_STATES),
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
  add: z.array(z.string().max(4096)).optional().refine(
    (val) => !val || !val.some(v => v === '.' || v === '*' || v === './' || v === '.\\'),
    { message: "Wildcard staging (e.g. '.') is forbidden. You must explicitly specify files." }
  ),
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
    if (rawArgs[i].startsWith('--') && rawArgs[i + 1].startsWith('-') && !Number.isNaN(Number(rawArgs[i + 1]))) {
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
    fatalError('Multiple commit messages provided via --msg and --message aliases. Please provide only one.');
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
          { code: 'invalid_value', path: ['validation'] },
          () => {
            if (mergedValues.validation === undefined) {
              return `Missing required flag. You MUST append one of: ${VALIDATION_STATES.map(v => `'--validation ${v}'`).join(', ')} to your command.`;
            }
            return `Invalid validation status '${mergedValues.validation}'. You MUST append one of: ${VALIDATION_STATES.map(v => `'--validation ${v}'`).join(', ')} to your command.`;
          }
        )
        .with(
          { code: 'invalid_value', path: ['category'] },
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
- WARNING: DO NOT use \`git add .\` to blanket stage files. Stage ONLY the specific files you modified using \`--add <path>\` (or additional positional arguments) to avoid polluting commits.
- EXAMPLE: bun commit.ts "fix(cli): resolve option errors" --history-file "scratch/hist.txt" --impact 0.6 --confidence 1.0 --validation passed "src/index.ts"`);
  process.exit(0);
}



function ensureStagedFiles(cwd: string, filesToAdd?: string[]): void {
  if (filesToAdd && filesToAdd.length > 0) {
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
    status = execSync('git status --porcelain', { encoding: 'utf-8', cwd });
  } catch (e) {
    fatalError(`Not a git repository or git command failed.\n${getErrorMessage(e)}`);
  }

  const hasStaged = status.split('\n').some(line => {
    if (line.length < 2) return false;
    const indexStatus = line[0];
    return indexStatus !== ' ' && indexStatus !== '?';
  });
  
  if (!hasStaged) {
    console.error('🛠️ AUTONOMOUS HEALING: No files staged for commit.');
    console.error('You MUST explicitly stage the files you want to commit using `git add <file-path>` before running this wrapper.');
    console.error('Do NOT use `git add .` to blanket stage files.');
    const shortStatus = execSync('git status --short', { encoding: 'utf-8', cwd });
    if (shortStatus.trim()) {
      console.error('Current status:');
      console.error(shortStatus);
    }
    fatalError('No files staged for commit.');
  }
}

function parseCategory(history: string, type: string): { category: string; entry: string } {
  const categoryMatch = history.match(HISTORY_CATEGORY_REGEX);

  if (categoryMatch) {
    const matchedCat = categoryMatch[1];
    const capitalizedMatch = capitalize(matchedCat);
    
    if (isValidCategory(capitalizedMatch)) {
      return { category: capitalizedMatch, entry: categoryMatch[2].trim() };
    }
  }

  const category = TYPE_TO_CATEGORY[type] || 'Changed';
  return { category, entry: history.trim() };
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
  
  if (entry || (!args['no-history'] && !entry)) {
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
    
    let historyContent = args.history || '';
    if (args['history-file']) {
      try {
        historyContent = fs.readFileSync(path.resolve(args['history-file']), 'utf-8');
      } catch (e) {
        fatalError(`Error reading history file: ${getErrorMessage(e)}`);
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

main();
