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

const VALUE_FLAGS = [
  '-n', '--max-count', '--skip', '--author', '--committer', '--grep',
  '--since', '--after', '--until', '--before', '-S', '--pickaxe', '-G', '--patch-search',
  '-L', '--format', '--pretty', '-U', '--diff-context', '--diff-filter',
];

function resolveHistoryScript(targetCwd: string, rawCwd: string, cwd: string): string | null {
  const fallbackScript = path.resolve(HISTORY_DIR, '../../get-git-history-json.ts');
  return findEcosystemScript(targetCwd, 'get-git-history-json.ts')
    || findEcosystemScript(rawCwd, 'get-git-history-json.ts')
    || findEcosystemScript(cwd, 'get-git-history-json.ts')
    || (fs.existsSync(fallbackScript) ? fallbackScript : null);
}

const SEMVER_TAG_RE = /^v?\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?:[~^]\d*|@\{[^}]+\})*$/i;
const REMOTE_OR_REF_PREFIX_RE = /^(?:origin|upstream|refs\/(?:heads|tags|remotes))\//i;

function resolvesAsGitRef(argStr: string, targetCwd: string, cwd: string): boolean {
  if (argStr.startsWith('-') || argStr.includes('\\')) return false;
  const probeCwd = fs.statSync(targetCwd, { throwIfNoEntry: false })?.isDirectory() === true
    ? targetCwd
    : (fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory() === true ? cwd : undefined);
  if (probeCwd === undefined) return false;
  try {
    const res = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${argStr}^{commit}`], {
      cwd: probeCwd,
      windowsHide: true,
      timeout: 3000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

function isKnownGitPath(argStr: string, targetCwd: string, cwd: string): boolean {
  try {
    if (fs.existsSync(path.resolve(targetCwd, argStr)) || fs.existsSync(path.resolve(cwd, argStr))) return true;
  } catch {
    // fallback to syntactic path heuristics below
  }
  if (SEMVER_TAG_RE.test(argStr) || REMOTE_OR_REF_PREFIX_RE.test(argStr)) return false;
  if (argStr.includes('/') || argStr.includes('\\') || argStr.includes('.')) {
    return !resolvesAsGitRef(argStr, targetCwd, cwd);
  }
  if (/^(?:Dockerfile|Makefile|Containerfile|Procfile|LICENSE|README|AUTHORS|NOTICE|Brewfile|Vagrantfile|Gemfile)$/i.test(argStr)) return true;
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
    if (arg === '--') return args.slice(i + 1).length > 1;
    if (arg.startsWith('-')) {
      if (PAIRED_FLAGS.some(rule => rule.names.includes(arg)) || VALUE_FLAGS.includes(arg)) i += 1;
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
      if (PAIRED_FLAGS.some(rule => rule.names.includes(arg)) || VALUE_FLAGS.includes(arg)) i += 1;
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
  if (cmd === 'diff') {
    const ddIdx = args.indexOf('--');
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
        if (PAIRED_FLAGS.some(rule => rule.names.includes(arg)) || VALUE_FLAGS.includes(arg)) i += 1;
        continue;
      }
      if (arg.includes(':') && !/^[a-zA-Z]:[\\/]/.test(arg)) return true;
    }
  }
  if (['diff', 'log', 'show', 'shortlog'].includes(cmd)) {
    const ddIdx = args.indexOf('--');
    if (cmd === 'log' && subIdx !== -1) {
      const scanEnd = ddIdx === -1 ? args.length : ddIdx;
      for (let i = subIdx + 1; i < scanEnd; i++) {
        const a = args[i];
        if (a === undefined) continue;
        if (a === '-L' || a.startsWith('-L')) return true;
        if (VALUE_FLAGS.includes(a)) { i += 1; }
      }
    }
    if (ddIdx !== -1 && args.slice(ddIdx + 1).length > 1) return true;
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
      if (next !== undefined && /^\d+$/.test(next)) {
        limit = next;
        hasExplicitLimit = true;
        i += 1;
      }
      continue;
    }
    if (VALUE_FLAGS.includes(arg)) {
      i += 1;
      continue;
    }
    const attached = /^-n(\d+)$/.exec(arg) ?? /^--max-count=(\d+)$/.exec(arg) ?? /^-(\d+)$/.exec(arg);
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
    if (VALUE_FLAGS.includes(a) || PAIRED_FLAGS.some(rule => rule.names.includes(a))) {
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
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(arg) || /^\.\.?$/.test(arg)) return 'path';
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
    if (VALUE_FLAGS.includes(arg)) {
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
    if (VALUE_FLAGS.includes(arg)) { i++; continue; }
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
  ctx: ExecutionContext,
  args: string[],
  cmd: string,
  targetCwd: string,
  rawCwd: string,
  explicitCwd: string | undefined,
): void {
  if (cmd === 'diff' && args.includes('--no-index')) return;
  const cwd = ctx.payload.cwd || ctx.cwd || process.cwd();
  const scriptCandidate = resolveHistoryScript(targetCwd, rawCwd, cwd);
  const knownPathCache = new Map<string, boolean>();
  const knownPath = (argStr: string): boolean => {
    const cached = knownPathCache.get(argStr);
    if (cached !== undefined) return cached;
    const resolved = isKnownGitPath(argStr, targetCwd, cwd);
    knownPathCache.set(argStr, resolved);
    return resolved;
  };
  const subcmdIdx = findGitSubcommandIndex(args, cmd);
  if (hasCustomGitTreeFlags(args, subcmdIdx)) return;
  if (scriptCandidate === null) {
    injectDiffPathSeparator(ctx, cmd, knownPath, subcmdIdx);
    return;
  }
  if (shouldLeaveNative(cmd, args, subcmdIdx, ctx, knownPath)) return;
  if (process.platform === 'win32') ctx.payload.target = 'windows';
  if (cmd === 'status') {
    rewriteStatus(ctx, scriptCandidate, targetCwd, explicitCwd);
    return;
  }
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
