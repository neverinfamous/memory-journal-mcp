// @ts-nocheck
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { match, P } from 'ts-pattern';

export const AGENT_EXEC_README_URL = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'AGENT_README.md')
).href;

/**
 * Safely strips quoted parts using a ts-pattern state machine
 */
export const getUnquoted = (str: string): string => {
  type ParseState = { inSingle: boolean; inDouble: boolean; unquoted: string; isEscaped: boolean };
  const initialState: ParseState = { inSingle: false, inDouble: false, unquoted: '', isEscaped: false };
  return str.split('').reduce((state: ParseState, char: string) => {
      return match([state, char] as const)
          .with([{ isEscaped: true, inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, isEscaped: false, unquoted: s.unquoted + c }))
          .with([{ isEscaped: true }, P.string], ([s]) => ({ ...s, isEscaped: false }))
          .with([{ inSingle: false, inDouble: false }, '\\'], ([s, c]) => ({ ...s, isEscaped: true, unquoted: s.unquoted + c }))
          .with([{ inDouble: true }, '\\'], ([s]) => ({ ...s, isEscaped: true }))
          .with([{ inDouble: false }, "'"], ([s]) => ({ ...s, inSingle: !s.inSingle }))
          .with([{ inSingle: false }, '"'], ([s]) => ({ ...s, inDouble: !s.inDouble }))
          .with([{ inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, unquoted: s.unquoted + c }))
          .with([{ inSingle: true }, P.string], ([s]) => s)
          .with([{ inDouble: true }, P.string], ([s]) => s)
          .exhaustive();
  }, initialState).unquoted;
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

export function hasTailFollowFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (TAIL_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a === '-f' || a === '-F' || a === '--follow' || a.startsWith('--follow=')) return true;
    if (/^(?:-(?:[a-zA-Z]*|\d+[bckm]?)|\+\d+[bckm]?)[fF][a-zA-Z0-9]*$/.test(a)) return true;
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
    if (!a.startsWith('--') && /^-[exqrkaobml]*f/.test(a)) return true;
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
    } else if (!a.startsWith('--') && /^-[a-zA-Z]*L/.test(a) && (!a.includes('f') || a.indexOf('L') < a.indexOf('f'))) {
      if (a.endsWith('L')) i++;
    } else if (a === '-f' || a === '--from-file') {
      hasFromFile = true;
      const next = args[i + 1];
      if (next !== undefined) files.push(next);
      i++;
    } else if (a.startsWith('--from-file=')) {
      hasFromFile = true;
      files.push(a.slice('--from-file='.length));
    } else if (!a.startsWith('--') && /^-[a-zA-Z]*f$/.test(a)) {
      hasFromFile = true;
      const next = args[i + 1];
      if (next !== undefined) files.push(next);
      i++;
    } else if (!a.startsWith('--') && /^-[a-zA-Z]*f(.+)$/.test(a)) {
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
export function stripInlineCodeArgs(cmdBasename: string, args: readonly string[]): string[] {
  const base = cmdBasename.replace(/\.(?:exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
  let activeInterp: 'js' | 'py' | null = JS_INTERPRETERS.has(base) ? 'js' : (PY_INTERPRETERS.has(base) ? 'py' : null);
  const filtered: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    const baseName = a.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase();
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
      if ([...flags].some(flag => lower.startsWith(`${flag}=`))) {
        continue;
      }
    }
    if (baseName.startsWith('.agent_inline_script_') || /agent-exec-inline-/i.test(baseName)) {
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
    if (/^-[a-zA-Z]*f$/.test(a) && (lIdx === -1 || fIdx < lIdx)) { i++; continue; }
    if (/^-[a-zA-Z]*L$/.test(a) && (fIdx === -1 || lIdx < fIdx)) {
      const next = args[i + 1];
      if (next !== undefined) libs.push(next);
      i++;
      continue;
    }
    if (/^-[a-zA-Z]*L(.+)$/.test(a) && lIdx !== -1 && (fIdx === -1 || lIdx < fIdx) && lIdx + 1 < a.length) {
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
    if (shortBody.length === 0 || !/^[a-zA-Z]/.test(shortBody)) continue;
    let consumesNext = false;
    for (let k = 0; k < shortBody.length; k++) {
      const ch = shortBody[k];
      if (ch === shortChar) return true;
      if (ch === 'L' || ch === 'f') {
        consumesNext = k === shortBody.length - 1;
        break;
      }
      if (!/[a-zA-Z]/.test(ch ?? '')) break;
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

const SSH_KEYGEN_OTHER_VALUE_FLAGS = new Set(['-b', '-C', '-D', '-E', '-F', '-I', '-M', '-m', '-n', '-O', '-P', '-R', '-r', '-t', '-V', '-Z', '-z']);

/** [INTENT]: Verify `ssh-keygen` has both `-f` (file) and `-N` (passphrase) before `--` without counting operands as flags. */
export function hasSshKeygenNonInteractiveFlags(args: readonly string[]): boolean {
  let hasF = false;
  let hasN = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-f') { hasF = true; i++; continue; }
    if (a.startsWith('-f')) { hasF = true; continue; }
    if (a === '-N') { hasN = true; i++; continue; }
    if (a.startsWith('-N')) { hasN = true; continue; }
    if (SSH_KEYGEN_OTHER_VALUE_FLAGS.has(a)) i++;
  }
  return hasF && hasN;
}
