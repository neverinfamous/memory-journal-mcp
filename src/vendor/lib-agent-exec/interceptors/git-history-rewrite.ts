// @ts-nocheck
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEcosystemScript } from '../utils.js';
import type { ExecutionContext } from './types.js';

const HISTORY_DIR = path.dirname(fileURLToPath(import.meta.url));

interface FlagRule {
  names: readonly string[];
  dest: string;
  equalsPrefix?: string;
  attachedPrefix?: string;
}

const PAIRED_FLAGS: readonly FlagRule[] = [
  { names: ['-S'], dest: '--pickaxe', attachedPrefix: '-S' },
  { names: ['-G'], dest: '--patch-search', attachedPrefix: '-G' },
  { names: ['--grep'], dest: '--grep', equalsPrefix: '--grep=' },
  { names: ['--author'], dest: '--author', equalsPrefix: '--author=' },
  { names: ['--since'], dest: '--since', equalsPrefix: '--since=' },
  { names: ['--after'], dest: '--since', equalsPrefix: '--after=' },
  { names: ['--until'], dest: '--until', equalsPrefix: '--until=' },
  { names: ['--before'], dest: '--until', equalsPrefix: '--before=' },
  { names: ['--diff-filter'], dest: '--diff-filter', equalsPrefix: '--diff-filter=' },
  { names: ['-U', '--diff-context'], dest: '--diff-context', equalsPrefix: '--diff-context=', attachedPrefix: '-U' },
];

const VALUE_FLAG_SET: ReadonlySet<string> = new Set([
  '-n', '--max-count', '--skip', '--author', '--committer', '--grep',
  '--since', '--after', '--until', '--before', '-S', '--pickaxe', '-G', '--patch-search',
  '-L', '--format', '--pretty', '-U', '--diff-context', '--diff-filter',
]);
const PAIRED_FLAG_NAME_SET: ReadonlySet<string> = new Set(PAIRED_FLAGS.flatMap(rule => rule.names));
const ANY_VALUE_FLAG_SET: ReadonlySet<string> = new Set([...VALUE_FLAG_SET, ...PAIRED_FLAG_NAME_SET]);
const HISTORY_RANGE_CMD_SET: ReadonlySet<string> = new Set(['diff', 'log', 'show', 'shortlog']);

function resolveHistoryScript(targetCwd: string, rawCwd: string, cwd: string): string | null {
  const checked = new Set<string>();
  for (const dir of [targetCwd, rawCwd, cwd]) {
    if (checked.has(dir)) continue;
    checked.add(dir);
    const found = findEcosystemScript(dir, 'get-git-history-json.ts');
    if (found !== null) return found;
  }
  const fallbackScript = path.resolve(HISTORY_DIR, '../../get-git-history-json.ts');
  return fs.existsSync(fallbackScript) ? fallbackScript : null;
}

const SEMVER_TAG_RE = /^v?\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?:[~^]\d*|@\{[^}]+\})*$/i;
const REMOTE_OR_REF_PREFIX_RE = /^(?:origin|upstream|refs\/(?:heads|tags|remotes))\//i;
const EXTENSIONLESS_REPO_DOC_RE = /^(?:Dockerfile|Makefile|Containerfile|Procfile|LICENSE|README|AUTHORS|NOTICE|Brewfile|Vagrantfile|Gemfile)$/i;
const GIT_DIGITS_RE = /^\d+$/;
const GIT_N_ATTACHED_RE = /^-n(\d+)$/;
const GIT_MAX_COUNT_EQ_RE = /^--max-count=(\d+)$/;
const GIT_SHORT_COUNT_RE = /^-(\d+)$/;
const WIN_DRIVE_COLON_RE = /^[a-zA-Z]:[\\/]/;
const REL_DOTDOT_PATH_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const DOTS_ONLY_RE = /^\.\.?$/;

function resolvesAsGitRef(argStr: string, probeCwd: string | undefined): boolean {
  if (argStr.startsWith('-') || argStr.includes('\\') || probeCwd === undefined) return false;
  try {
    const res = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${argStr}^{commit}`], {
      cwd: probeCwd,
      windowsHide: true,
      timeout: 3000,
    });
    return res.status === 0;
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT') console.error(`⚠️ git rev-parse probe warning: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function isKnownGitPath(argStr: string, targetCwd: string, cwd: string, getProbeCwd: () => string | undefined): boolean {
  try {
    const p1 = path.resolve(targetCwd, argStr);
    if (fs.existsSync(p1)) return true;
    const p2 = path.resolve(cwd, argStr);
    if (p2 !== p1 && fs.existsSync(p2)) return true;
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENAMETOOLONG' && code !== 'EINVAL') {
      console.error(`⚠️ git path probe warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (SEMVER_TAG_RE.test(argStr) || REMOTE_OR_REF_PREFIX_RE.test(argStr)) return false;
  if (argStr.includes('/') || argStr.includes('\\') || argStr.includes('.')) {
    return !resolvesAsGitRef(argStr, getProbeCwd());
  }
  if (EXTENSIONLESS_REPO_DOC_RE.test(argStr)) return true;
  return false;
}

function hasMultiplePathArgsWithoutDash(
  args: readonly string[],
  startIdx: number,
  knownPath: (value: string) => boolean,
): boolean {
  let pathCount = 0;
  for (let i = startIdx + 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') return args.length - (i + 1) > 1;
    if (arg.startsWith('-')) {
      if (ANY_VALUE_FLAG_SET.has(arg)) i += 1;
      continue;
    }
    if (classifyPositional(arg, knownPath) === 'path') {
      pathCount += 1;
      if (pathCount >= 2) return true;
    }
  }
  return false;
}

function hasIncompatibleRangeArgs(
  args: readonly string[],
  cmd: string,
  startIdx: number,
  knownPath: (value: string) => boolean,
): boolean {
  let rangeCount = 0;
  let sawDotDotRange = false;
  for (let i = startIdx + 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg.startsWith('-')) {
      if (ANY_VALUE_FLAG_SET.has(arg)) i += 1;
      continue;
    }
    if (classifyPositional(arg, knownPath) !== 'range') continue;
    rangeCount += 1;
    if (arg.includes('..')) sawDotDotRange = true;
    if (rangeCount >= 2 && (cmd !== 'diff' || sawDotDotRange || rangeCount >= 3)) return true;
  }
  return false;
}

const CUSTOM_TREE_FLAGS: ReadonlySet<string> = new Set(['--git-dir', '--work-tree', '--namespace', '--bare']);

function hasCustomGitTreeFlags(args: readonly string[], subIdx: number): boolean {
  const limit = subIdx === -1 ? args.length : subIdx;
  for (let i = 0; i < limit; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (
      CUSTOM_TREE_FLAGS.has(arg) ||
      arg.startsWith('--git-dir=') ||
      arg.startsWith('--work-tree=') ||
      arg.startsWith('--namespace=')
    ) {
      return true;
    }
    if (GLOBAL_VALUE_FLAGS.has(arg)) i += 1;
  }
  return false;
}

const NATIVE_GIT_DIFF_FLAGS: ReadonlySet<string> = new Set([
  '--cached', '--staged', '--quiet', '--exit-code', '--name-only', '--name-status',
]);

function shouldLeaveNative(cmd: string, args: string[], subIdx: number, ctx: ExecutionContext, knownPath: (value: string) => boolean): boolean {
  if (ctx.payload.target === 'wsl2') return true;
  const ddIdx = args.indexOf('--');
  if (cmd === 'diff') {
    const diffScanEnd = ddIdx === -1 ? args.length : ddIdx;
    const diffPreDd = args.slice(subIdx === -1 ? 0 : subIdx + 1, diffScanEnd);
    if (diffPreDd.some(a => NATIVE_GIT_DIFF_FLAGS.has(a))) return true;
  }
  if (cmd === 'show' || cmd === 'diff') {
    const revArgs = subIdx !== -1 ? args.slice(subIdx + 1) : args;
    for (let i = 0; i < revArgs.length; i++) {
      const arg = revArgs[i];
      if (arg === undefined || arg === '--') break;
      if (arg.startsWith('-')) {
        if (ANY_VALUE_FLAG_SET.has(arg)) i += 1;
        continue;
      }
      if (arg.includes(':') && !WIN_DRIVE_COLON_RE.test(arg)) return true;
    }
  }
  if (HISTORY_RANGE_CMD_SET.has(cmd)) {
    if (cmd === 'log' && subIdx !== -1) {
      const scanEnd = ddIdx === -1 ? args.length : ddIdx;
      for (let i = subIdx + 1; i < scanEnd; i++) {
        const a = args[i];
        if (a === undefined) continue;
        if (a === '-L' || a.startsWith('-L')) return true;
        if (VALUE_FLAG_SET.has(a)) { i += 1; }
      }
    }
    if (ddIdx !== -1 && args.length - (ddIdx + 1) > 1) return true;
    if (subIdx !== -1 && hasMultiplePathArgsWithoutDash(args, subIdx, knownPath)) return true;
    if (hasIncompatibleRangeArgs(args, cmd, subIdx, knownPath)) return true;
  }
  return false;
}

function cwdDiffers(targetCwd: string, explicitCwd: string | undefined): boolean {
  if (explicitCwd !== undefined) return true;
  const a = path.resolve(targetCwd);
  const b = path.resolve(process.cwd());
  return process.platform === 'win32' ? a.toLowerCase() !== b.toLowerCase() : a !== b;
}

function syncGitCommandPayload(ctx: ExecutionContext): void {
  if (ctx.payload.type !== 'command') return;
  ctx.payload.command = ctx.cmdBasename;
  ctx.payload.args = ctx.args;
}

function rewriteStatus(ctx: ExecutionContext, scriptToInvoke: string, targetCwd: string, explicitCwd: string | undefined): void {
  ctx.cmdBasename = 'bun';
  ctx.args = [scriptToInvoke, '--uncommitted', '--stats'];
  if (cwdDiffers(targetCwd, explicitCwd)) ctx.args.push('--cwd', targetCwd);
  syncGitCommandPayload(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git status' to '${scriptToInvoke} --uncommitted --stats'... (Frictionless Recovery)`);
}

function seedHistoryArgs(ctx: ExecutionContext, cmd: string, scriptToInvoke: string, targetCwd: string, explicitCwd: string | undefined): void {
  ctx.cmdBasename = 'bun';
  ctx.args = [scriptToInvoke];
  if (cwdDiffers(targetCwd, explicitCwd)) ctx.args.push('--cwd', targetCwd);
  if (cmd === 'show') ctx.args.push('--stats');
  if (cmd === 'diff') ctx.args.push('--stats', '--include-patch');
  syncGitCommandPayload(ctx);
}

const GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);

function findGitSubcommandIndex(args: readonly string[], cmd: string): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (GLOBAL_VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    if (arg === cmd) return i;
  }
  return -1;
}

function applyHistoryLimit(ctx: ExecutionContext, args: string[], cmd: string, startIdx: number): void {
  let limit = cmd === 'show' ? '1' : '10';
  let hasExplicitLimit = false;
  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '-n' || arg === '--max-count') {
      const next = args[i + 1];
      if (next !== undefined && GIT_DIGITS_RE.test(next)) {
        limit = next;
        hasExplicitLimit = true;
        i += 1;
      }
      continue;
    }
    if (VALUE_FLAG_SET.has(arg)) {
      i += 1;
      continue;
    }
    const attached = GIT_N_ATTACHED_RE.exec(arg) ?? GIT_MAX_COUNT_EQ_RE.exec(arg) ?? GIT_SHORT_COUNT_RE.exec(arg);
    if (attached !== null && attached[1] !== undefined) {
      limit = attached[1];
      hasExplicitLimit = true;
    }
  }
  if (cmd !== 'diff' || hasExplicitLimit) ctx.args.push('--limit', limit);
}

function applyPatchFlag(ctx: ExecutionContext, args: string[], startIdx = 0): void {
  if (ctx.args.includes('--include-patch')) return;
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-p' || a === '--patch') {
      ctx.args.push('--include-patch');
      return;
    }
    if (ANY_VALUE_FLAG_SET.has(a)) {
      i += 1;
    }
  }
}

function pushAttached(out: string[], arg: string, rule: FlagRule): boolean {
  const prefix = rule.attachedPrefix;
  if (prefix === undefined || !arg.startsWith(prefix) || arg.length <= prefix.length || arg.startsWith('--')) return false;
  out.push(rule.dest, arg.slice(prefix.length));
  return true;
}

function consumePairedFlag(args: string[], index: number, out: string[]): number | undefined {
  const arg = args[index];
  if (arg === undefined) return undefined;
  for (const rule of PAIRED_FLAGS) {
    if (rule.names.includes(arg)) {
      const next = args[index + 1];
      if (next === undefined) return index;
      out.push(rule.dest, next);
      return index + 1;
    }
    if (rule.equalsPrefix !== undefined && arg.startsWith(rule.equalsPrefix)) {
      out.push(rule.dest, arg.slice(rule.equalsPrefix.length));
      return index;
    }
    if (pushAttached(out, arg, rule)) return index;
  }
  return undefined;
}

function classifyPositional(arg: string, knownPath: (value: string) => boolean): 'range' | 'path' | 'skip' {
  if (arg.startsWith('-')) return 'skip';
  if (REL_DOTDOT_PATH_RE.test(arg) || DOTS_ONLY_RE.test(arg)) return 'path';
  if (arg.includes('..')) return 'range';
  return knownPath(arg) ? 'path' : 'range';
}

function forwardHistoryArgs(
  ctx: ExecutionContext,
  args: string[],
  cmd: string,
  knownPath: (value: string) => boolean,
  startIdx: number,
): { rangeArg?: string; pathArg?: string } {
  let rangeArg: string | undefined;
  let pathArg: string | undefined;
  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      const remaining = args.slice(i + 1).filter((item) => item !== '--');
      if (remaining.length > 0) pathArg = remaining.join(' ');
      break;
    }
    const consumed = consumePairedFlag(args, i, ctx.args);
    if (consumed !== undefined) {
      i = consumed;
      continue;
    }
    if (arg === '--first-parent' || arg === '--all' || arg === '--reverse') {
      ctx.args.push(arg);
      continue;
    }
    if (VALUE_FLAG_SET.has(arg)) {
      i += 1;
      continue;
    }
    const kind = classifyPositional(arg, knownPath);
    if (kind === 'range') {
      if (rangeArg === undefined) rangeArg = arg;
      else if (cmd === 'diff' && !rangeArg.includes('..') && !arg.includes('..')) rangeArg = `${rangeArg}..${arg}`;
    } else if (kind === 'path') {
      pathArg = arg;
    }
  }
  const forwarded: { rangeArg?: string; pathArg?: string } = {};
  if (rangeArg !== undefined) forwarded.rangeArg = rangeArg;
  if (pathArg !== undefined) forwarded.pathArg = pathArg;
  return forwarded;
}

function injectDiffPathSeparator(
  ctx: ExecutionContext,
  cmd: string,
  knownPath: (value: string) => boolean,
  subcmdIdx = -1,
): void {
  if (cmd !== 'diff' || ctx.args.includes('--')) return;
  const diffIdx = subcmdIdx !== -1 ? subcmdIdx : ctx.args.indexOf('diff');
  const startIdx = diffIdx !== -1 ? diffIdx + 1 : 0;
  const posItems: Array<{ idx: number; arg: string }> = [];
  for (let i = startIdx; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === undefined) continue;
    if (VALUE_FLAG_SET.has(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    posItems.push({ idx: i, arg });
  }
  if (posItems.length < 2) return;
  let firstTrailingPathPos = posItems.length;
  while (firstTrailingPathPos > 0) {
    const item = posItems[firstTrailingPathPos - 1];
    if (item === undefined || !knownPath(item.arg)) break;
    firstTrailingPathPos--;
  }
  if (firstTrailingPathPos === posItems.length || firstTrailingPathPos === 0) return;
  const insertAt = posItems[firstTrailingPathPos]?.idx;
  if (insertAt === undefined) return;
  ctx.args.splice(insertAt, 0, '--');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-injecting '--' before file path in 'git diff' to prevent ambiguous argument error... (Frictionless Recovery)`);
}

export function rewriteGitInspection(
  ctx: ExecutionContext, args: string[], cmd: string, targetCwd: string, rawCwd: string, explicitCwd: string | undefined,
): void {
  if (cmd === 'diff' && args.includes('--no-index')) return;
  const subcmdIdx = findGitSubcommandIndex(args, cmd);
  if (hasCustomGitTreeFlags(args, subcmdIdx)) return;
  if (ctx.payload.target === 'wsl2' && (cmd !== 'diff' || args.includes('--'))) return;
  const cwd = ctx.payload.cwd || ctx.cwd || process.cwd();
  const scriptCandidate = resolveHistoryScript(targetCwd, rawCwd, cwd);
  let probeCwdChecked = false;
  let probeCwdVal: string | undefined;
  const getProbeCwd = (): string | undefined => {
    if (!probeCwdChecked) {
      probeCwdChecked = true;
      probeCwdVal = fs.statSync(targetCwd, { throwIfNoEntry: false })?.isDirectory() === true ? targetCwd : (fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory() === true ? cwd : undefined);
    }
    return probeCwdVal;
  };
  const knownPathCache = new Map<string, boolean>();
  const knownPath = (argStr: string): boolean => {
    let resolved = knownPathCache.get(argStr);
    if (resolved === undefined) { resolved = isKnownGitPath(argStr, targetCwd, cwd, getProbeCwd); knownPathCache.set(argStr, resolved); }
    return resolved;
  };
  if (scriptCandidate === null) { injectDiffPathSeparator(ctx, cmd, knownPath, subcmdIdx); return; }
  if (shouldLeaveNative(cmd, args, subcmdIdx, ctx, knownPath)) return;
  if (process.platform === 'win32') ctx.payload.target = 'windows';
  if (cmd === 'status') { rewriteStatus(ctx, scriptCandidate, targetCwd, explicitCwd); return; }
  seedHistoryArgs(ctx, cmd, scriptCandidate, targetCwd, explicitCwd);
  const startIdx = subcmdIdx !== -1 ? subcmdIdx + 1 : 0;
  applyHistoryLimit(ctx, args, cmd, startIdx);
  applyPatchFlag(ctx, args, startIdx);
  const forwarded = forwardHistoryArgs(ctx, args, cmd, knownPath, startIdx);
  if (cmd === 'diff' && forwarded.rangeArg === undefined) ctx.args.push('--uncommitted');
  if (forwarded.rangeArg !== undefined) ctx.args.push('--range', forwarded.rangeArg);
  if (forwarded.pathArg !== undefined) ctx.args.push('--path', forwarded.pathArg);
  syncGitCommandPayload(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git ${cmd}' to '${scriptCandidate}' to prevent text dumps... (Frictionless Recovery)`);
}
