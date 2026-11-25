// @ts-nocheck
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AGENT_EXEC_README_URL = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'AGENT_README.md')
).href;

/**
 * Safely strips quoted parts linearly without per-character allocations.
 */
export const getUnquoted = (str: string): string => {
  let inSingle = false;
  let inDouble = false;
  let isEscaped = false;
  let unquoted = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? '';
    if (isEscaped) {
      isEscaped = false;
      if (!inSingle && !inDouble) unquoted += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === '\\') {
      isEscaped = true;
      unquoted += ch;
      continue;
    }
    if (inDouble && ch === '\\') {
      isEscaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      unquoted += ch;
    }
  }
  return unquoted;
};

// [INTENT]: Splits a shell snippet at the first unquoted pipeline, chain, or newline operator so single-command heuristics do not bleed across piped stages.
export function splitFirstShellSegment(code: string): { firstSegment: string; remainder: string } {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\' && !inSingle) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '|' || ch === ';' || ch === '\n') {
        return { firstSegment: code.slice(0, i), remainder: code.slice(i) };
      }
      if (ch === '&') {
        const prev = code[i - 1];
        const next = code[i + 1];
        if (next === '&' || (prev !== '>' && next !== '>')) {
          return { firstSegment: code.slice(0, i), remainder: code.slice(i) };
        }
      }
    }
  }

  return { firstSegment: code, remainder: '' };
}

const JS_INTERPRETERS = new Set(['node', 'bun', 'tsx', 'ts-node']);
const PY_INTERPRETERS = new Set(['python', 'python3']);
const JS_INLINE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const PY_INLINE_EVAL_FLAGS = new Set(['-c', '--command']);
const TAIL_VALUE_FLAGS = new Set(['-n', '--lines', '-c', '--bytes', '-s', '--sleep-interval', '--pid', '--max-unchanged-stats']);
const JOURNALCTL_VALUE_FLAGS = new Set([
  '-u', '--unit', '--user-unit', '-t', '--identifier', '-p', '--priority',
  '-g', '--grep', '-n', '--lines', '-o', '--output', '-S', '--since', '-U', '--until',
  '-c', '--cursor', '--after-cursor', '--cursor-file', '-M', '--machine',
  '-D', '--directory', '--file', '--root', '--namespace', '-F', '--field',
]);
const JQ_TWO_ARG_FLAGS = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile', '--argfile']);
const JQ_TWO_ARG_FILE_FLAGS = new Set(['--slurpfile', '--rawfile', '--argfile']);
const JQ_ONE_ARG_FLAGS = new Set(['-L', '--library-path', '--indent']);

export function hasPreDoubleDashHelpOrVersion(args: readonly string[], cmdBasename = ''): boolean {
  const base = path.basename(cmdBasename).toLowerCase().replace(/\.exe$/, '');
  for (const a of args) {
    if (a === '--') break;
    if (a === '--help' || a === '--version' || (a === '-V' && base !== 'sort')) return true;
  }
  return false;
}

const TAIL_SHORT_FOLLOW_RE = /^(?:-(?:[a-zA-Z]*|\d+[bckm]?)|\+\d+[bckm]?)[fF][a-zA-Z0-9]*$/;
const JOURNALCTL_SHORT_FOLLOW_RE = /^-[exqrkaobml]*f/;
const JQ_SHORT_L_ANY_RE = /^-[a-zA-Z]*L/;
const JQ_SHORT_L_EXACT_RE = /^-[a-zA-Z]*L$/;
const JQ_SHORT_F_EXACT_RE = /^-[a-zA-Z]*f$/;
const JQ_SHORT_F_ATTACHED_RE = /^-[a-zA-Z]*f(.+)$/;
const JQ_SHORT_L_ATTACHED_RE = /^-[a-zA-Z]*L(.+)$/;
const ALPHA_LEAD_RE = /^[a-zA-Z]/;
const ALPHA_CHAR_RE = /[a-zA-Z]/;

export function hasTailFollowFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (TAIL_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a === '-f' || a === '-F' || a === '--follow' || a.startsWith('--follow=')) return true;
    if (TAIL_SHORT_FOLLOW_RE.test(a)) return true;
  }
  return false;
}

export function hasJournalctlFollowFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (JOURNALCTL_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a === '-f' || a === '--follow') return true;
    if (!a.startsWith('--') && JOURNALCTL_SHORT_FOLLOW_RE.test(a)) return true;
  }
  return false;
}

export function scanJqFromFiles(args: readonly string[]): { hasFromFile: boolean; files: string[] } {
  const files: string[] = [];
  let hasFromFile = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (JQ_TWO_ARG_FLAGS.has(a)) {
      if (JQ_TWO_ARG_FILE_FLAGS.has(a)) {
        const pathVal = args[i + 2];
        if (pathVal !== undefined) files.push(pathVal);
      }
      i += 2;
    } else if (JQ_ONE_ARG_FLAGS.has(a)) {
      i++;
    } else if (!a.startsWith('--') && JQ_SHORT_L_ANY_RE.test(a) && (!a.includes('f') || a.indexOf('L') < a.indexOf('f'))) {
      if (JQ_SHORT_L_EXACT_RE.test(a)) i++;
    } else if (a === '-f' || a === '--from-file') {
      hasFromFile = true;
      const next = args[i + 1];
      if (next !== undefined) files.push(next);
      i++;
    } else if (a.startsWith('--from-file=')) {
      hasFromFile = true;
      files.push(a.slice('--from-file='.length));
    } else if (!a.startsWith('--') && JQ_SHORT_F_EXACT_RE.test(a)) {
      hasFromFile = true;
      const next = args[i + 1];
      if (next !== undefined) files.push(next);
      i++;
    } else if (!a.startsWith('--') && JQ_SHORT_F_ATTACHED_RE.test(a)) {
      hasFromFile = true;
      const idx = a.indexOf('f');
      if (idx !== -1 && idx + 1 < a.length) files.push(a.slice(idx + 1));
    }
  }
  return { hasFromFile, files };
}

/**
 * [INTENT]: Exclude inline code bodies (`-e "..."`, `--eval=...`) and rewritten temp script paths from
 * quality-gate/test keyword regexes so JS/TS eval snippets mentioning "test"/"check" never trigger 240s timeouts or stall bypasses.
 */
const INLINE_CMD_BASE_DIR_RE = /^.*[\\/]/;
const INLINE_WIN_EXT_RE = /\.(?:exe|cmd|bat)$/i;
const INLINE_EXEC_MARKER_RE = /agent-exec-inline-/i;

export function stripInlineCodeArgs(cmdBasename: string, args: readonly string[]): string[] {
  const base = cmdBasename.replace(/\.(?:exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
  let activeInterp: 'js' | 'py' | null = JS_INTERPRETERS.has(base) ? 'js' : (PY_INTERPRETERS.has(base) ? 'py' : null);
  const filtered: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    const baseName = a.replace(INLINE_CMD_BASE_DIR_RE, '').replace(INLINE_WIN_EXT_RE, '').toLowerCase();
    if (!a.startsWith('-') && (JS_INTERPRETERS.has(baseName) || PY_INTERPRETERS.has(baseName))) {
      activeInterp = JS_INTERPRETERS.has(baseName) ? 'js' : 'py';
      filtered.push(a);
      continue;
    }
    if (activeInterp !== null) {
      const lower = a.toLowerCase();
      const flags = activeInterp === 'js' ? JS_INLINE_EVAL_FLAGS : PY_INLINE_EVAL_FLAGS;
      if (flags.has(lower)) {
        filtered.push(a);
        i++;
        continue;
      }
      const eqIdx = lower.indexOf('=');
      if (eqIdx > 0 && flags.has(lower.slice(0, eqIdx))) {
        continue;
      }
    }
    if (baseName.startsWith('.agent_inline_script_') || INLINE_EXEC_MARKER_RE.test(baseName)) {
      continue;
    }
    filtered.push(a);
  }

  return filtered;
}

const PKG_VALUE_FLAGS = new Set([
  '--dir', '-C', '--cwd', '--prefix', '--filter', '-F', '--config', '-c',
  '--registry', '--userconfig', '--globalconfig', '--cache', '--store-dir',
  '--loglevel', '--reporter', '--mutex', '--network-timeout', '-w', '--workspace',
]);

/** [INTENT]: Collect jq `-L`/`--library-path` arguments before `--` so Linux library dirs still route jq to WSL2 on Windows. */
export function collectJqLibraryPaths(args: readonly string[]): string[] {
  const libs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (JQ_TWO_ARG_FLAGS.has(a)) { i += 2; continue; }
    if (a === '--indent' || a === '-f' || a === '--from-file') { i++; continue; }
    if (a === '-L' || a === '--library-path') {
      const next = args[i + 1];
      if (next !== undefined) libs.push(next);
      i++;
      continue;
    }
    if (a.startsWith('--library-path=')) { libs.push(a.slice('--library-path='.length)); continue; }
    if (a.startsWith('--')) continue;
    const fIdx = a.indexOf('f');
    const lIdx = a.indexOf('L');
    if (JQ_SHORT_F_EXACT_RE.test(a) && (lIdx === -1 || fIdx < lIdx)) { i++; continue; }
    if (JQ_SHORT_L_EXACT_RE.test(a) && (fIdx === -1 || lIdx < fIdx)) {
      const next = args[i + 1];
      if (next !== undefined) libs.push(next);
      i++;
      continue;
    }
    if (JQ_SHORT_L_ATTACHED_RE.test(a) && lIdx !== -1 && (fIdx === -1 || lIdx < fIdx) && lIdx + 1 < a.length) {
      libs.push(a.slice(lIdx + 1));
    }
  }
  return libs;
}

/** [INTENT]: Return the array index of the first non-flag package-manager subcommand (or `-1` if absent), skipping value-taking flags. */
export function findFirstPkgSubcmdIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--') break;
    if (PKG_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    return i;
  }
  return -1;
}

/** [INTENT]: Return positional package-manager args while skipping value-taking flags (`--dir <path>`, `--filter <pkg>`). */
export function getPkgNonFlagArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--') break;
    if (PKG_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
}

/** [INTENT]: Detect a jq short or long flag before `--` while skipping value-taking flags and attached `-L`/`-f` operands. */
export function hasJqShortOrLongFlag(args: readonly string[], shortChar: string, longFlag: string): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (JQ_TWO_ARG_FLAGS.has(a)) { i += 2; continue; }
    if (JQ_ONE_ARG_FLAGS.has(a) || a === '-f' || a === '--from-file') { i++; continue; }
    if (a === longFlag) return true;
    if (a.startsWith('--')) continue;
    const shortBody = a.startsWith('-') ? a.slice(1) : '';
    if (shortBody.length === 0 || !ALPHA_LEAD_RE.test(shortBody)) continue;
    let consumesNext = false;
    for (let k = 0; k < shortBody.length; k++) {
      const ch = shortBody[k];
      if (ch === shortChar) return true;
      if (ch === 'L' || ch === 'f') {
        consumesNext = k === shortBody.length - 1;
        break;
      }
      if (!ALPHA_CHAR_RE.test(ch ?? '')) break;
    }
    if (consumesNext) i++;
  }
  return false;
}

const XARGS_REQ_VALUE_LONG_FLAGS = new Set([
  '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars', '--process-slot-var',
]);

/** [INTENT]: Check whether `xargs` reads items from an explicit `-a`/`--arg-file` option before `--` or the subcommand. */
export function hasXargsArgFile(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (!a.startsWith('-')) break;
    if (a === '--arg-file' || a.startsWith('--arg-file=')) return true;
    if (a.startsWith('--')) {
      if (!a.includes('=') && XARGS_REQ_VALUE_LONG_FLAGS.has(a)) i++;
      continue;
    }
    const shortBody = a.slice(1);
    let consumesNext = false;
    for (let k = 0; k < shortBody.length; k++) {
      const ch = shortBody[k];
      if (ch === 'a') return true;
      if (ch !== undefined && 'dEIiLlnePRSs'.includes(ch)) {
        consumesNext = k === shortBody.length - 1 && 'dEILnPRSs'.includes(ch);
        break;
      }
    }
    if (consumesNext) i++;
  }
  return false;
}

const SSH_KEYGEN_OTHER_VALUE_CHARS: ReadonlySet<string> = new Set(['b', 'C', 'D', 'E', 'F', 'I', 'M', 'm', 'n', 'O', 'P', 'R', 'r', 't', 'V', 'Z', 'z']);

/** [INTENT]: Verify `ssh-keygen` has both `-f` (file) and `-N` (passphrase) before `--` without counting operands as flags. */
export function hasSshKeygenNonInteractiveFlags(args: readonly string[]): boolean {
  let hasF = false;
  let hasN = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (!a.startsWith('-') || a.startsWith('--')) continue;
    const shortBody = a.slice(1);
    for (let k = 0; k < shortBody.length; k++) {
      const ch = shortBody[k] ?? '';
      if (ch === 'f' || ch === 'N') {
        if (ch === 'f') hasF = true;
        else hasN = true;
        if (k === shortBody.length - 1) i++;
        break;
      }
      if (SSH_KEYGEN_OTHER_VALUE_CHARS.has(ch)) {
        if (k === shortBody.length - 1) i++;
        break;
      }
    }
  }
  return hasF && hasN;
}
