import { execSync, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { z } from 'zod';
import { match, P } from 'ts-pattern';
import {
  VALID_CATEGORIES,
  TYPE_TO_CATEGORY,
  capitalizeCategory,
  generateHistoryEntry,
  createJournalEntry,
} from './commit-journal.js';

const VALIDATION_STATES = ['passed', 'none', 'failed'] as const;
const CANONICAL_RELATION_TYPES = [
  'evolves_from',
  'references',
  'implements',
  'clarifies',
  'response_to',
  'blocked_by',
  'resolved',
  'caused',
] as const;
const CONVENTIONAL_COMMIT_REGEX = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const COMMIT_MSG_PREFIX = 'commit-msg-';

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
} as const;

function fatalError(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    let msg = error.message;
    if ('stderr' in error && error.stderr !== null && error.stderr !== undefined) {
      msg += '\nSTDERR:\n' + String(error.stderr);
    }
    return msg;
  }
  return String(error);
}

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
  'journal-project': z.coerce.number().int().finite().positive().optional(),
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
  relate: z.preprocess((val) => {
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
        const relStr = colonIdx === -1 ? 'references' : clean.slice(colonIdx + 1).trim();
        if (!/^\d+$/.test(idStr)) {
          return clean;
        }
        specs.push({ targetId: Number(idStr), relationType: relStr });
      }
    }
    return specs.length > 0 ? specs : undefined;
  }, z.array(z.object({
    targetId: z.number().int().positive(),
    relationType: z.enum(CANONICAL_RELATION_TYPES),
  })).optional()),
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
  --journal              Automatically create a memory journal entry for this commit (auto-populates file anchors).
  --journal-project <id> Specify the project ID for the journal entry (auto-resolved from projectRegistry if omitted).
  --session-id <id>      Conversation/session ID to attach to the automated journal entry.
  --tags <tag>           Add tag(s) to the automated journal entry (repeatable or comma-separated).
  --relate <id[:type]>   Link commit journal entry to an existing entry (e.g. '14653:evolves_from'; repeatable/comma-separated).
  --help                 Show this help message.
  
🤖 AI AGENT INSTRUCTIONS:
- MULTI-LINE HISTORY: ALWAYS write history to your conversation scratch dir (e.g. \`<scratch_dir>/hist.txt\`) and use \`--history-file <path>\` instead of \`--history\` to prevent shell escaping failures.
- MESSAGE FORMAT: The commit message (\`--msg\` or first positional argument) MUST strictly follow conventional commits: \`type(scope): subject\`.
- REQUIRED FLAGS: You MUST provide \`--impact\`, \`--confidence\`, and \`--validation\`.
- STAGING: Try to stage ONLY the specific files you modified using \`--add <path>\` (or additional positional arguments) to keep commits atomic. Wildcard staging (\`--add .\`) is supported as a fallback for unified sweeping changes.
- EXAMPLE: bun commit.ts "fix(cli): resolve option errors" --history-file "<scratch_dir>/hist.txt" --impact 0.6 --confidence 1.0 --validation passed "src/index.ts"`);
  process.exit(0);
}



// [INTENT]: Validates the git index state to prevent accidental staging of agent scratch payloads. [SIDE-EFFECT]: Aborts process if '.agents/scratch' paths are detected in the staging area. [AGENT-HINT]: Do NOT bypass this check; it is a critical safeguard for the project repository.
function ensureStagedFiles(cwd: string, filesToAdd?: string[]): void {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8', cwd }).trim();
    const resolvedGitDir = path.resolve(cwd, gitDir);
    const lockFile = path.join(resolvedGitDir, 'index.lock');
    if (fs.existsSync(lockFile)) {
      const ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (ageMs > 5 * 60 * 1000) {
        try {
          fs.unlinkSync(lockFile);
          console.warn(`⚠️ AUTONOMOUS HEALING: Removed stale git index.lock (${Math.round(ageMs / 60000)}m old) in ${resolvedGitDir}`);
        } catch {
          // Ignore and let git surface the error if locked by an active process
        }
      }
    }
  } catch {
    // Ignore error here and let git commands catch it properly
  }

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
    const statusArgs = ['status', '-z'];
    if (filesToAdd && filesToAdd.length > 0 && !filesToAdd.some(f => path.resolve(cwd, f) === path.resolve(cwd))) {
      statusArgs.push('-uno', '--', ...filesToAdd);
    }
    status = execFileSync('git', statusArgs, { encoding: 'utf-8', cwd });
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

// [INTENT]: Executes native git commit. [SIDE-EFFECT]: Writes the commit message to a temporary file on disk rather than passing it inline to prevent shell escaping traps. [DEPENDENCY]: Relies on node:os and node:crypto for safe temp file generation.
function executeCommit(header: string, body: string, cwd?: string, onlyFiles?: string[]): string {
  const msgFile = path.join(os.tmpdir(), `${COMMIT_MSG_PREFIX}${crypto.randomUUID()}.txt`);
  tempFilesToCleanup.add(msgFile);
  fs.writeFileSync(msgFile, `${header}${body}`, { mode: 0o600 });
  try {
    const commitArgs = ['commit', '-q', '-F', msgFile];
    if (onlyFiles && onlyFiles.length > 0 && !onlyFiles.some(f => path.resolve(cwd ?? process.cwd(), f) === path.resolve(cwd ?? process.cwd()))) {
      commitArgs.push('--only', '--', ...onlyFiles);
    }
    execFileSync('git', commitArgs, { stdio: 'inherit', cwd });
  } finally {
      cleanupTempFile(msgFile);
  }

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd }).trim();
  console.log(`\n✅ Successfully committed ${sha.slice(0, 7)} (${sha})`);
  console.log(`__COMMIT_SHA__:${sha}`);
  
  return sha;
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
      const candidateCwdPath = path.resolve(cwd, args['history-file']);
      const resolvedPath = fs.existsSync(candidateCwdPath)
        ? candidateCwdPath
        : path.resolve(args['history-file']);
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

    const body = generateHistoryEntry(args, type, historyContent, cwd);
    const sha = executeCommit(args.msg, body, cwd, args.add);
    createJournalEntry(
      sha,
      args.msg,
      args,
      historyContent,
      cwd,
      (filepath) => { tempFilesToCleanup.add(filepath); },
      cleanupTempFile,
      getErrorMessage
    );

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
