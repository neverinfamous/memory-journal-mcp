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
  { names: ['-U', '--diff-context'], dest: '--diff-context', attachedPrefix: '-U' },
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

function shouldLeaveNative(cmd: string, args: string[], ctx: ExecutionContext): boolean {
  if (cmd === 'show') {
    const isBlob = args.some((arg) => !arg.startsWith('-') && arg !== 'show' && arg !== '--no-pager' && arg.includes(':') && !/^[a-zA-Z]:[\\/]/.test(arg));
    if (isBlob) return true;
  }
  return cmd === 'status' && ctx.payload.target === 'wsl2';
}

function cwdDiffers(targetCwd: string, explicitCwd: string | undefined): boolean {
  return explicitCwd !== undefined || path.resolve(targetCwd) !== path.resolve(process.cwd());
}

function syncGitCommandPayload(ctx: ExecutionContext): void {
  if (ctx.payload.type !== 'command') return;
  ctx.payload.command = ctx.cmdBasename;
  ctx.payload.args = ctx.args;
}

function rewriteStatus(ctx: ExecutionContext, scriptToInvoke: string, targetCwd: string, explicitCwd: string | undefined): void {
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git status' to '${scriptToInvoke} --uncommitted --stats'... (Frictionless Recovery)`);
  ctx.cmdBasename = 'bun';
  ctx.args = [scriptToInvoke, '--uncommitted', '--stats'];
  if (cwdDiffers(targetCwd, explicitCwd)) ctx.args.push('--cwd', targetCwd);
  syncGitCommandPayload(ctx);
}

function seedHistoryArgs(ctx: ExecutionContext, cmd: string, scriptToInvoke: string, targetCwd: string, explicitCwd: string | undefined): void {
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'git ${cmd}' to '${scriptToInvoke}' to prevent text dumps... (Frictionless Recovery)`);
  ctx.cmdBasename = 'bun';
  ctx.args = [scriptToInvoke];
  if (cwdDiffers(targetCwd, explicitCwd)) ctx.args.push('--cwd', targetCwd);
  if (cmd === 'show') ctx.args.push('--stats');
  if (cmd === 'diff') ctx.args.push('--stats', '--include-patch');
  syncGitCommandPayload(ctx);
}

function applyHistoryLimit(ctx: ExecutionContext, args: string[], cmd: string): void {
  let limit = '10';
  let hasExplicitLimit = false;
  const nIndex = args.indexOf('-n');
  if (nIndex !== -1 && nIndex + 1 < args.length) {
    limit = args[nIndex + 1];
    hasExplicitLimit = true;
  }
  for (const arg of args) {
    if (/^-\d+$/.test(arg)) {
      limit = arg.substring(1);
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

function classifyPositional(arg: string, cmd: string, rangeArg: string | undefined, knownPath: (value: string) => boolean): 'range' | 'path' | 'skip' {
  if (arg.startsWith('-') || arg === cmd || arg === '--no-pager') return 'skip';
  if (arg.includes('..') || knownPath(arg)) return arg.includes('..') ? 'range' : 'path';
  return rangeArg !== undefined ? 'path' : 'range';
}

function forwardHistoryArgs(ctx: ExecutionContext, args: string[], cmd: string, knownPath: (value: string) => boolean): { rangeArg?: string; pathArg?: string } {
  let rangeArg: string | undefined;
  let pathArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
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
    const kind = classifyPositional(arg, cmd, rangeArg, knownPath);
    if (kind === 'range') rangeArg = arg;
    if (kind === 'path') pathArg = arg;
  }
  const forwarded: { rangeArg?: string; pathArg?: string } = {};
  if (rangeArg !== undefined) forwarded.rangeArg = rangeArg;
  if (pathArg !== undefined) forwarded.pathArg = pathArg;
  return forwarded;
}

function injectDiffPathSeparator(ctx: ExecutionContext, cmd: string, knownPath: (value: string) => boolean): void {
  if (cmd !== 'diff' || ctx.args.includes('--')) return;
  const nonFlagArgs = ctx.args.filter((arg) => !arg.startsWith('-') && arg !== 'diff' && arg !== '--no-pager');
  if (nonFlagArgs.length < 2) return;
  const lastArg = nonFlagArgs[nonFlagArgs.length - 1];
  if (lastArg === undefined || !knownPath(lastArg)) return;
  const lastIdx = ctx.args.lastIndexOf(lastArg);
  if (lastIdx === -1) return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-injecting '--' before file path in 'git diff' to prevent ambiguous argument error... (Frictionless Recovery)`);
  ctx.args.splice(lastIdx, 0, '--');
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
  if (scriptCandidate === null) {
    injectDiffPathSeparator(ctx, cmd, knownPath);
    return;
  }
  if (shouldLeaveNative(cmd, args, ctx)) return;
  ctx.payload.target = 'windows';
  if (cmd === 'status') {
    rewriteStatus(ctx, scriptCandidate, targetCwd, explicitCwd);
    return;
  }
  seedHistoryArgs(ctx, cmd, scriptCandidate, targetCwd, explicitCwd);
  applyHistoryLimit(ctx, args, cmd);
  applyPatchFlag(ctx, args);
  const forwarded = forwardHistoryArgs(ctx, args, cmd, knownPath);
  if (cmd === 'diff' && forwarded.rangeArg === undefined) ctx.args.push('--uncommitted');
  if (forwarded.rangeArg !== undefined) ctx.args.push('--range', forwarded.rangeArg);
  if (forwarded.pathArg !== undefined) ctx.args.push('--path', forwarded.pathArg);
}
