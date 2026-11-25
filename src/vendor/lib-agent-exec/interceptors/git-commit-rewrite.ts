// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTONOMOUS_HEALING_MSG, findEcosystemScript, resolveFreshCompiledCommitBundle } from '../utils.js';
import { convertToWindowsPath, convertToWslPath } from '../command-utils.js';
import { tryRealpath } from './git-add-broad-scan.js';
import { parseGitCommitArgs, readCommitMessage } from './git-commit-args.js';
import type { ExecutionContext } from './types.js';

export { readCommitMessage };

const COMMIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_ANCESTOR_WALK_DEPTH = 12;

function isRegularNonSymlinkFile(filePath: string): boolean {
  const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isFile();
}

function isNonSymlinkDir(dirPath: string): boolean {
  const st = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isDirectory();
}

function isSameResolvedPath(a: string, b: string): boolean {
  const normA = path.resolve(a);
  const normB = path.resolve(b);
  return process.platform === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

function findAncestorRepoCommitScript(startDir: string): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < MAX_ANCESTOR_WALK_DEPTH; depth++) {
    const scriptsDir = path.join(current, 'scripts');
    const candidate = path.join(scriptsDir, 'commit.ts');
    if (isNonSymlinkDir(scriptsDir) && isRegularNonSymlinkFile(candidate)) return candidate;
    if (fs.lstatSync(path.join(current, '.git'), { throwIfNoEntry: false }) !== undefined) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

const COMMIT_MNT_PATH_RE = /^\/?mnt\/[a-zA-Z](?:\/|$)/i;

function normalizeHostSearchDir(dir: string): string {
  return process.platform === 'win32' && COMMIT_MNT_PATH_RE.test(dir)
    ? convertToWindowsPath(dir)
    : dir;
}

function resolveCommitScript(targetCwd: string, rawCwd: string, spawnCwd: string, extraSearchDir?: string): string | null {
  const hostTarget = normalizeHostSearchDir(targetCwd);
  const hostRaw = normalizeHostSearchDir(rawCwd);
  const hostSpawn = normalizeHostSearchDir(spawnCwd);
  const hostExtra = extraSearchDir !== undefined ? normalizeHostSearchDir(extraSearchDir) : undefined;
  const localAgentsDir = path.join(hostTarget, '.agents');
  const localAgentsScriptsDir = path.join(localAgentsDir, 'scripts');
  const localAgentPath = path.join(localAgentsScriptsDir, 'commit.ts');
  const localScriptsDir = path.join(hostTarget, 'scripts');
  const localScriptsPath = path.join(localScriptsDir, 'commit.ts');
  const sameAsSpawnCwd = isSameResolvedPath(hostTarget, hostSpawn);
  if (isNonSymlinkDir(localAgentsDir) && isNonSymlinkDir(localAgentsScriptsDir) && isRegularNonSymlinkFile(localAgentPath)) {
    return sameAsSpawnCwd ? './.agents/scripts/commit.ts' : localAgentPath;
  }
  if (isNonSymlinkDir(localScriptsDir) && isRegularNonSymlinkFile(localScriptsPath)) {
    return sameAsSpawnCwd ? './scripts/commit.ts' : localScriptsPath;
  }
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
    path.resolve(COMMIT_DIR, '../../scripts/commit.ts'),
    path.resolve(COMMIT_DIR, '../../commit/commit.ts'),
    path.resolve(COMMIT_DIR, '../../commit/commit.js'),
    path.resolve(COMMIT_DIR, '../commit/commit.js'),
  ];
  for (const candidate of bundledFallbacks) {
    if (isRegularNonSymlinkFile(candidate)) return candidate;
  }
  return null;
}

function isPosixStylePath(p: string): boolean {
  return p.startsWith('/') || p === '~' || p.startsWith('~/');
}

function resolvePrefixPath(baseDir: string, rawVal: string, isWsl2: boolean): string {
  if (isWsl2) {
    if (rawVal === '~' || rawVal.startsWith('~/')) return rawVal;
    if (path.win32.isAbsolute(rawVal)) return path.posix.resolve(convertToWslPath(rawVal));
    if (rawVal.startsWith('/')) return path.posix.resolve(rawVal);
    if (baseDir === '~' || baseDir.startsWith('~/')) return path.posix.join(baseDir, rawVal);
    if (baseDir.startsWith('/')) return path.posix.resolve(baseDir, rawVal);
  }
  return path.resolve(baseDir, rawVal);
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
  ignoredFlags: { hasAll: boolean; hasMessageFile: boolean },
): void {
  const compiledCommit = ctx.payload.target !== 'wsl2' ? resolveFreshCompiledCommitBundle(script, targetCwd) : null;
  const rawEntryScript = compiledCommit ?? script;
  const entryScript =
    ctx.payload.target === 'wsl2' && path.win32.isAbsolute(rawEntryScript)
      ? convertToWslPath(rawEntryScript)
      : rawEntryScript;
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
  const isWslTildeCwd = ctx.payload.target === 'wsl2' && (targetCwd === '~' || targetCwd.startsWith('~/'));
  if (!isWslTildeCwd && (explicitCwd !== undefined || !isSameResolvedPath(targetCwd, spawnCwd) || !isSameResolvedPath(targetCwd, process.cwd()))) {
    ctx.args.push('--cwd', targetCwd);
  }
  if ('command' in ctx.payload) {
    ctx.payload.command = ctx.cmdBasename;
    ctx.payload.args = ctx.args;
  }
  console.error(`\n   💡 AGENT HINT: 'git commit' is intercepted for safety.`);
  if (ignoredFlags.hasAll) {
    console.error(`   ⚠️ AUTONOMOUS HEALING: '-a/--all' is not forwarded by commit.ts; pass explicit '--add <path>' flags if modified files need staging.`);
  }
  if (ignoredFlags.hasMessageFile) {
    console.error(`   ⚠️ AUTONOMOUS HEALING: '-F/--file' is not forwarded when rewriting with '-m'; pass '--history-file <path>' or inline '--msg' directly to commit.ts.`);
  }
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
  if (parsed.hasInteractiveOrPatch) {
    console.error(`\n   💡 AGENT HINT: 'git commit -p'/'-i' (interactive patch commit) will hang indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, interactive commit flags are blocked.`);
    process.exit(1);
  }
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
    applyCommitWrapper(
      ctx,
      commitScript,
      parsed.message,
      effectiveTargetCwd,
      effectiveExplicitCwd,
      parsed.pathspecs,
      nextSpawnCwd,
      { hasAll: parsed.hasAll, hasMessageFile: parsed.hasMessageFile }
    );
    return;
  }
  if (commitScript === null && (parsed.message !== undefined || parsed.hasMessageFile || parsed.hasNonInteractiveMsgSource)) return;
  if (commitScript !== null) {
    console.error(`\n   💡 AGENT HINT: 'git commit' is strictly forbidden via the shell.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   You must use the designated wrapper instead: bun ${commitScript}`);
    process.exit(1);
  }
  console.error(`\n   💡 AGENT HINT: 'git commit' without '-m' will open an interactive editor and hang.\n${AUTONOMOUS_HEALING_MSG}`);
  console.error(`   Because 'agent-exec.ts' is non-interactive, you MUST provide '-m' or '--message'.`);
  process.exit(1);
}
