// @ts-nocheck
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

function isKnownGitPath(argStr: string, targetCwd: string, cwd: string): boolean {
  if (argStr.includes('/') || argStr.includes('\\') || argStr.includes('.')) return true;
  if (/^(?:Dockerfile|Makefile|Containerfile|Procfile|LICENSE|README|AUTHORS|NOTICE|Brewfile|Vagrantfile|Gemfile)$/i.test(argStr)) return true;
  try {
    if (fs.existsSync(path.resolve(targetCwd, argStr)) || fs.existsSync(path.resolve(cwd, argStr))) return true;
  } catch {
    return false;
  }
  return false;
}

function hasMultiplePathArgsWithoutDash(
  args: readonly string[],
  cmd: string,
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
    if (classifyPositional(arg, cmd, knownPath) === 'path') {
      pathCount += 1;
      if (pathCount >= 2) return true;
    }
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

function shouldLeaveNative(cmd: string, args: string[], ctx: ExecutionContext, knownPath: (value: string) => boolean): boolean {
  if (ctx.payload.target === 'wsl2') return true;
  const subIdx = findGitSubcommandIndex(args, cmd);
  if (hasCustomGitTreeFlags(args, subIdx)) return true;
  if (cmd === 'show') {
    const showArgs = subIdx !== -1 ? args.slice(subIdx + 1) : args;
    const isBlob = showArgs.some((arg) => !arg.startsWith('-') && arg !== '--no-pager' && arg.includes(':') && !/^[a-zA-Z]:[\\/]/.test(arg));
    if (isBlob) return true;
  }
  if (['diff', 'log', 'show', 'shortlog'].includes(cmd)) {
    const ddIdx = args.indexOf('--');
    if (ddIdx !== -1 && args.slice(ddIdx + 1).length > 1) return true;
    if (subIdx !== -1 && hasMultiplePathArgsWithoutDash(args, cmd, subIdx, knownPath)) return true;
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

function applyPatchFlag(ctx: ExecutionContext, args: string[]): void {
  if ((args.includes('-p') || args.includes('--patch')) && !ctx.args.includes('--include-patch')) {
    ctx.args.push('--include-patch');
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

function classifyPositional(arg: string, cmd: string, knownPath: (value: string) => boolean): 'range' | 'path' | 'skip' {
  if (arg.startsWith('-') || arg === cmd || arg === '--no-pager') return 'skip';
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
    const kind = classifyPositional(arg, cmd, knownPath);
    if (kind === 'range') {
      if (rangeArg === undefined) rangeArg = arg;
      else if (cmd === 'diff' && !rangeArg.includes('..') && !arg.includes('..')) rangeArg = `${rangeArg}..${arg}`;
      else if (pathArg === undefined) pathArg = arg;
    } else if (kind === 'path') {
      pathArg = arg;
    }
  }
  const forwarded: { rangeArg?: string; pathArg?: string } = {};
  if (rangeArg !== undefined) forwarded.rangeArg = rangeArg;
  if (pathArg !== undefined) forwarded.pathArg = pathArg;
  return forwarded;
}

function injectDiffPathSeparator(ctx: ExecutionContext, cmd: string, knownPath: (value: string) => boolean): void {
  if (cmd !== 'diff' || ctx.args.includes('--')) return;
  const diffIdx = ctx.args.indexOf('diff');
  const startIdx = diffIdx !== -1 ? diffIdx + 1 : 0;
  const posItems: Array<{ idx: number; arg: string }> = [];
  for (let i = startIdx; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === undefined) continue;
    if (VALUE_FLAGS.includes(arg)) { i++; continue; }
    if (arg.startsWith('-') || arg === '--no-pager') continue;
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
  const cwd = ctx.payload.cwd || process.cwd();
  const scriptCandidate = resolveHistoryScript(targetCwd, rawCwd, cwd);
  const knownPath = (argStr: string) => isKnownGitPath(argStr, targetCwd, cwd);
  const subcmdIdx = findGitSubcommandIndex(args, cmd);
  if (hasCustomGitTreeFlags(args, subcmdIdx)) return;
  if (scriptCandidate === null) {
    injectDiffPathSeparator(ctx, cmd, knownPath);
    return;
  }
  if (shouldLeaveNative(cmd, args, ctx, knownPath)) return;
  ctx.payload.target = 'windows';
  if (cmd === 'status') {
    rewriteStatus(ctx, scriptCandidate, targetCwd, explicitCwd);
    return;
  }
  seedHistoryArgs(ctx, cmd, scriptCandidate, targetCwd, explicitCwd);
  const startIdx = subcmdIdx !== -1 ? subcmdIdx + 1 : 0;
  applyHistoryLimit(ctx, args, cmd, startIdx);
  applyPatchFlag(ctx, args);
  const forwarded = forwardHistoryArgs(ctx, args, cmd, knownPath, startIdx);
  if (cmd === 'diff' && forwarded.rangeArg === undefined) ctx.args.push('--uncommitted');
  if (forwarded.rangeArg !== undefined) ctx.args.push('--range', forwarded.rangeArg);
  if (forwarded.pathArg !== undefined) ctx.args.push('--path', forwarded.pathArg);
  syncGitCommandPayload(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git ${cmd}' to '${scriptCandidate}' to prevent text dumps... (Frictionless Recovery)`);
}
