// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTONOMOUS_HEALING_MSG, findEcosystemScript, resolveFreshCompiledCommitBundle } from '../utils.js';
import { convertToWindowsPath } from '../command-utils.js';
import type { ExecutionContext } from './types.js';

const COMMIT_DIR = path.dirname(fileURLToPath(import.meta.url));

const COMMIT_VALUE_FLAGS = new Set([
  '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message',
  '--fixup', '--squash', '--author', '--date', '-t', '--template',
  '--cleanup', '--trailer', '--pathspec-from-file',
]);
const COMMIT_READONLY_FLAGS = new Set(['--dry-run', '--short', '--porcelain', '--long']);
const GIT_TOP_VALUE_FLAGS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);
const SHORT_MSG_CLUSTER_RE = /^-[asnqvoie]+m$/;
const SHORT_ATTACHED_MSG_RE = /^-[asnqvoie]*m(.+)$/;
const SHORT_VALUE_CLUSTER_RE = /^-[asnqvoie]+[FCct]$/;

interface GitTopLevelPrefix {
  commitStartIdx: number;
  gitDir: string | undefined;
  workTree: string | undefined;
}

interface ParsedGitCommitArgs {
  message: string | undefined;
  hasAmend: boolean;
  isDryRun: boolean;
  hasPathspecFromFile: boolean;
  pathspecs: string[];
  gitDir: string | undefined;
  workTree: string | undefined;
}

function parseGitTopLevelPrefix(args: readonly string[]): GitTopLevelPrefix {
  let gitDir: string | undefined;
  let workTree: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') return { commitStartIdx: 0, gitDir: undefined, workTree: undefined };
    if (arg === '--git-dir' && args[i + 1] !== undefined) {
      gitDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--git-dir=')) {
      gitDir = arg.slice(10);
      continue;
    }
    if (arg === '--work-tree' && args[i + 1] !== undefined) {
      workTree = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--work-tree=')) {
      workTree = arg.slice(12);
      continue;
    }
    if (GIT_TOP_VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg === 'commit' ? { commitStartIdx: i + 1, gitDir, workTree } : { commitStartIdx: 0, gitDir: undefined, workTree: undefined };
  }
  return { commitStartIdx: 0, gitDir: undefined, workTree: undefined };
}

function parseGitCommitArgs(args: readonly string[]): ParsedGitCommitArgs {
  const prefix = parseGitTopLevelPrefix(args);
  const messages: string[] = [];
  const pathspecs: string[] = [];
  let hasAmend = false;
  let isDryRun = false;
  let hasPathspecFromFile = false;
  let pastDoubleDash = false;
  for (let i = prefix.commitStartIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (pastDoubleDash) {
      pathspecs.push(arg);
      continue;
    }
    if (arg === '--') {
      pastDoubleDash = true;
    } else if (arg === '--amend') {
      hasAmend = true;
    } else if (COMMIT_READONLY_FLAGS.has(arg)) {
      isDryRun = true;
    } else if (arg === '--pathspec-from-file') {
      hasPathspecFromFile = true;
      i += 1;
    } else if (arg.startsWith('--pathspec-from-file=')) {
      hasPathspecFromFile = true;
    } else if (arg === '-m' || arg === '--message' || arg === '-am' || arg === '-ma' || SHORT_MSG_CLUSTER_RE.test(arg)) {
      const nextMsg = args[i + 1];
      if (nextMsg !== undefined) messages.push(nextMsg);
      i += 1;
    } else if ((arg.startsWith('-am') || arg.startsWith('-ma')) && arg.length > 3) {
      messages.push(arg.slice(3));
    } else if (arg.startsWith('--message=')) {
      messages.push(arg.slice(10));
    } else if (!arg.startsWith('--')) {
      const attachedMatch = SHORT_ATTACHED_MSG_RE.exec(arg);
      if (attachedMatch?.[1] !== undefined) {
        messages.push(attachedMatch[1]);
      } else if (COMMIT_VALUE_FLAGS.has(arg) || SHORT_VALUE_CLUSTER_RE.test(arg)) {
        i += 1;
      } else if (!arg.startsWith('-')) {
        pathspecs.push(arg);
      }
    } else if (COMMIT_VALUE_FLAGS.has(arg)) {
      i += 1;
    }
  }
  return {
    message: messages.length > 0 ? messages.join('\n\n') : undefined,
    hasAmend,
    isDryRun,
    hasPathspecFromFile,
    pathspecs,
    gitDir: prefix.gitDir,
    workTree: prefix.workTree,
  };
}

export function readCommitMessage(args: readonly string[]): string | undefined {
  return parseGitCommitArgs(args).message;
}

function isSameResolvedPath(a: string, b: string): boolean {
  const normA = path.resolve(a);
  const normB = path.resolve(b);
  return process.platform === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

function findAncestorRepoCommitScript(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, 'scripts', 'commit.ts');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeHostSearchDir(dir: string): string {
  return process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(dir)
    ? convertToWindowsPath(dir)
    : dir;
}

function resolveCommitScript(targetCwd: string, rawCwd: string, spawnCwd: string, extraSearchDir?: string): string | null {
  const hostTarget = normalizeHostSearchDir(targetCwd);
  const hostRaw = normalizeHostSearchDir(rawCwd);
  const hostSpawn = normalizeHostSearchDir(spawnCwd);
  const hostExtra = extraSearchDir !== undefined ? normalizeHostSearchDir(extraSearchDir) : undefined;
  const localAgentPath = path.join(hostTarget, '.agents', 'scripts', 'commit.ts');
  const localScriptsPath = path.join(hostTarget, 'scripts', 'commit.ts');
  const sameAsSpawnCwd = isSameResolvedPath(hostTarget, hostSpawn);
  if (fs.existsSync(localAgentPath)) return sameAsSpawnCwd ? './.agents/scripts/commit.ts' : localAgentPath;
  if (fs.existsSync(localScriptsPath)) return sameAsSpawnCwd ? './scripts/commit.ts' : localScriptsPath;
  const searchDirs: string[] = [];
  const rawSearchDirs = hostExtra !== undefined ? [hostTarget, hostRaw, hostSpawn, hostExtra] : [hostTarget, hostRaw, hostSpawn];
  for (const dir of rawSearchDirs) {
    if (!searchDirs.some((seen) => isSameResolvedPath(seen, dir))) searchDirs.push(dir);
  }
  for (const dir of searchDirs) {
    const found = findEcosystemScript(dir, 'commit.ts') || findAncestorRepoCommitScript(dir);
    if (found) return found;
  }
  const bundledFallbacks = [
    path.resolve(COMMIT_DIR, '../../commit.ts'),
    path.resolve(COMMIT_DIR, '../../commit/commit.ts'),
    path.resolve(COMMIT_DIR, '../../commit/commit.js'),
  ];
  for (const candidate of bundledFallbacks) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isPosixStylePath(p: string): boolean {
  return p.startsWith('/') || p === '~' || p.startsWith('~/');
}

function resolvePrefixPath(baseDir: string, rawVal: string, isWsl2: boolean): string {
  if (isWsl2) {
    if (rawVal === '~' || rawVal.startsWith('~/')) return rawVal;
    if (rawVal.startsWith('/')) return path.posix.resolve(rawVal);
    if (baseDir === '~' || baseDir.startsWith('~/')) return path.posix.join(baseDir, rawVal);
    if (baseDir.startsWith('/')) return path.posix.resolve(baseDir, rawVal);
  }
  return path.resolve(baseDir, rawVal);
}

function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

function isRelativeSelfOrDescendant(rel: string, sep: string): boolean {
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`));
}

function isPathInsideDir(childDir: string, parentDir: string, isWsl2: boolean): boolean {
  if (isWsl2 && (isPosixStylePath(childDir) || isPosixStylePath(parentDir))) {
    if (childDir.startsWith('/') && parentDir.startsWith('/')) {
      const rel = path.posix.relative(path.posix.resolve(parentDir), path.posix.resolve(childDir));
      return isRelativeSelfOrDescendant(rel, '/') && !path.posix.isAbsolute(rel);
    }
    if ((childDir === '~' || childDir.startsWith('~/')) && (parentDir === '~' || parentDir.startsWith('~/'))) {
      const rel = path.posix.relative(path.posix.normalize(parentDir), path.posix.normalize(childDir));
      return isRelativeSelfOrDescendant(rel, '/') && !path.posix.isAbsolute(rel);
    }
    return false;
  }
  const isUnderHost = (parent: string, child: string): boolean => {
    const foldedParent = process.platform === 'win32' ? parent.toLowerCase() : parent;
    const foldedChild = process.platform === 'win32' ? child.toLowerCase() : child;
    const rel = path.relative(foldedParent, foldedChild);
    return isRelativeSelfOrDescendant(rel, path.sep) && !path.isAbsolute(rel);
  };
  const normParent = path.resolve(parentDir);
  const normChild = path.resolve(childDir);
  if (isUnderHost(normParent, normChild)) return true;
  const realParent = tryRealpath(normParent);
  const realChild = tryRealpath(normChild);
  return realParent !== null && realChild !== null && isUnderHost(realParent, realChild);
}

export function resolveCommitRunnerBasename(entryScript: string, target: string | undefined): string {
  if (entryScript.endsWith('.js')) {
    return process.platform === 'win32' && target !== 'wsl2' ? 'node.exe' : 'node';
  }
  return 'bun';
}

function applyCommitWrapper(
  ctx: ExecutionContext,
  script: string,
  message: string,
  targetCwd: string,
  explicitCwd: string | undefined,
  pathspecs: readonly string[],
  spawnCwd: string,
): void {
  const compiledCommit = ctx.payload.target !== 'wsl2' ? resolveFreshCompiledCommitBundle(script, targetCwd) : null;
  const entryScript = compiledCommit ?? script;
  ctx.cmdBasename = resolveCommitRunnerBasename(entryScript, ctx.payload.target);
  const msgArgs = message.startsWith('-') ? [`--msg=${message}`] : ['--msg', message];
  const addArgs: string[] = [];
  for (const p of pathspecs) {
    if (p.startsWith('-')) addArgs.push(`--add=${p}`);
    else addArgs.push('--add', p);
  }
  ctx.args = [entryScript, ...msgArgs, '--impact', '0.5', '--confidence', '0.5', '--validation', 'passed', ...addArgs];
  ctx.payload.bypassInterceptors = true;
  const minTimeout = ctx.payload.target === 'wsl2' ? 90000 : 240000;
  if (ctx.payload.timeoutMs !== 0 && (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < minTimeout)) {
    ctx.payload.timeoutMs = minTimeout;
  }
  if (explicitCwd !== undefined || !isSameResolvedPath(targetCwd, spawnCwd) || !isSameResolvedPath(targetCwd, process.cwd())) {
    ctx.args.push('--cwd', targetCwd);
  }
  if ('command' in ctx.payload) {
    ctx.payload.command = ctx.cmdBasename;
    ctx.payload.args = ctx.args;
  }
  console.error(`\n   💡 AGENT HINT: 'git commit' is intercepted for safety.`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Transparently rewriting to '${script}' with default scores... (Frictionless Recovery)`);
}

export function rewriteGitCommit(
  ctx: ExecutionContext,
  args: string[],
  targetCwd: string,
  rawCwd: string,
  explicitCwd: string | undefined,
): void {
  const spawnCwd = ctx.payload.cwd || ctx.cwd || process.cwd();
  const parsed = parseGitCommitArgs(args);
  if (parsed.isDryRun) return;
  const isWsl2 = ctx.payload.target === 'wsl2';
  const effectiveWorkTree = parsed.workTree !== undefined ? resolvePrefixPath(targetCwd, parsed.workTree, isWsl2) : undefined;
  const targetInsideWorkTree =
    effectiveWorkTree !== undefined && isPathInsideDir(targetCwd, effectiveWorkTree, isWsl2);
  const switchedToWorkTree = effectiveWorkTree !== undefined && !targetInsideWorkTree;
  const effectiveTargetCwd = switchedToWorkTree ? effectiveWorkTree : targetCwd;
  const effectiveExplicitCwd = switchedToWorkTree ? effectiveWorkTree : explicitCwd;
  const nextSpawnCwd = switchedToWorkTree ? effectiveTargetCwd : spawnCwd;
  const commitScript = resolveCommitScript(effectiveTargetCwd, rawCwd, nextSpawnCwd, effectiveWorkTree);
  if (parsed.hasAmend && commitScript !== null) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git commit --amend' is forbidden when using the commit.ts wrapper because it breaks the Memory Journal tracking.`);
    console.error(`   Because 'agent-exec.ts' requires strict tracking, this is blocked. Please create a new commit or bypass the interceptor if you must amend.`);
    process.exit(1);
  }
  if (parsed.hasPathspecFromFile && commitScript !== null) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git commit --pathspec-from-file' is not supported by the commit.ts wrapper because reading pathspecs externally can omit or mis-stage files.`);
    console.error(`   Use '${commitScript}' with explicit '--add <path>' flags instead.`);
    process.exit(1);
  }
  if (parsed.message !== undefined && commitScript !== null) {
    if (parsed.gitDir !== undefined) ctx.envOverrides['GIT_DIR'] = resolvePrefixPath(targetCwd, parsed.gitDir, isWsl2);
    if (effectiveWorkTree !== undefined) ctx.envOverrides['GIT_WORK_TREE'] = effectiveWorkTree;
    if (switchedToWorkTree) ctx.payload.cwd = effectiveTargetCwd;
    applyCommitWrapper(ctx, commitScript, parsed.message, effectiveTargetCwd, effectiveExplicitCwd, parsed.pathspecs, nextSpawnCwd);
    return;
  }
  if (parsed.message !== undefined) return;
  if (commitScript !== null) {
    console.error(`\n   💡 AGENT HINT: 'git commit' is strictly forbidden via the shell.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   You must use the designated wrapper instead: bun ${commitScript}`);
    process.exit(1);
  }
  console.error(`\n   💡 AGENT HINT: 'git commit' without '-m' will open an interactive editor and hang.\n${AUTONOMOUS_HEALING_MSG}`);
  console.error(`   Because 'agent-exec.ts' is non-interactive, you MUST provide '-m' or '--message'.`);
  process.exit(1);
}
