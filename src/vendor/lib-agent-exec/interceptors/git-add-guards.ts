// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';

/** [INVARIANT]: Keep in sync with commit.ts stale-lock threshold (5 minutes). */
export const STALE_INDEX_LOCK_MS = 5 * 60 * 1000;

const AGENTS_PATH_RE = /(?:^|[\\/])\.agents(?:[\\/]|$)/i;
const PRIVATE_PATH_RE = /(?:^|[\\/])\.agents[\\/](?:scratch|cache)(?:[\\/]|$)|issues\.jsonl$/i;
const GIT_ADD_FORCE_RE = /^-[nvfipeuAN]*f[nvfipeuAN]*$/;
const BROAD_ADD_GLOBS = new Set(['.', './', '..', '../', '.agents', '.agents/', '.agents/*', '.agents/**', '*', '**']);
const ALL_ADD_FLAG_RE = /^-[nvfipeuAN]*A[nvfipeuAN]*$/;

export interface GitIgnoreProbe {
  ignored: boolean;
  pattern: string | null;
}

/**
 * [INTENT]: Ask git (in the payload cwd) whether a path is ignored, and by which pattern.
 * Tracked files are never reported as ignored by `git check-ignore`.
 */
export function probeGitIgnore(cwd: string, target: string): GitIgnoreProbe {
  try {
    const res = spawnSync('git', ['check-ignore', '-v', '--', target], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (res.status !== 0 || typeof res.stdout !== 'string' || res.stdout.trim() === '') {
      return { ignored: false, pattern: null };
    }
    const meta = (res.stdout.split(/\r?\n/)[0] ?? '').split('\t')[0] ?? '';
    const patternMatch = meta.match(/^.*?:\d+:(.*)$/);
    const pattern = patternMatch !== null && patternMatch[1] !== undefined ? patternMatch[1] : null;
    if (pattern !== null && pattern.startsWith('!')) {
      return { ignored: false, pattern };
    }
    return { ignored: true, pattern };
  } catch {
    return { ignored: false, pattern: null };
  }
}

export function isWholesaleAgentsIgnore(pattern: string | null): boolean {
  if (pattern === null) return false;
  const norm = pattern.trim().replace(/^\/+/, '').replace(/^\*\*\//, '');
  return ['.agents', '.agents/', '.agents/*', '.agents/**'].includes(norm);
}

function findGitRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.statSync(path.join(current, '.git'), { throwIfNoEntry: false }) !== undefined) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function isContainedInDir(candidatePath: string, baseDir: string): boolean {
  const realBase = process.platform === 'win32' ? path.resolve(baseDir).toLowerCase() : path.resolve(baseDir);
  const realCandidate = process.platform === 'win32' ? path.resolve(candidatePath).toLowerCase() : path.resolve(candidatePath);
  const rel = path.relative(realBase, realCandidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !rel.startsWith('../') && !path.isAbsolute(rel));
}

function isSameFsPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function stripGitPathspecMagic(rawSpec: string): { isTopRooted: boolean; isExcluded: boolean; cleaned: string } {
  let s = rawSpec.trim().replace(/^['"]|['"]$/g, '');
  let isTopRooted = false;
  let isExcluded = false;
  if (s.startsWith(':(')) {
    const closeIdx = s.indexOf(')');
    if (closeIdx !== -1) {
      const attrs = s.slice(2, closeIdx).split(',').map((part) => part.trim().toLowerCase());
      if (attrs.includes('top')) isTopRooted = true;
      if (attrs.includes('exclude')) isExcluded = true;
      s = s.slice(closeIdx + 1);
    }
  } else if (s.startsWith(':')) {
    let idx = 1;
    while (idx < s.length && (s[idx] === '/' || s[idx] === '!' || s[idx] === '^')) {
      if (s[idx] === '/') isTopRooted = true;
      if (s[idx] === '!' || s[idx] === '^') isExcluded = true;
      idx++;
    }
    s = s.slice(idx);
  }
  const norm = s.replace(/\\/g, '/').replace(/^\/+/, '');
  return { isTopRooted, isExcluded, cleaned: norm.length > 0 ? norm : '.' };
}

function globSegmentMatches(targetName: string, seg: string): boolean {
  if (!/[*?]/.test(seg)) return seg.toLowerCase() === targetName.toLowerCase();
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(targetName);
}

function isWildcardTargetingAgents(posixRelFromRoot: string): boolean {
  const clean = posixRelFromRoot.replace(/^\.\//, '');
  const firstSeg = clean.split('/')[0] ?? '';
  if (!/[*?]/.test(firstSeg)) return false;
  return globSegmentMatches('.agents', firstSeg);
}

export function syncGitPayloadArgs(ctx: ExecutionContext): void {
  if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
    ctx.payload.args = [...ctx.args];
  }
}

export function collectGitPathspecs(afterArgs: readonly string[]): Array<{ offset: number; value: string }> {
  const specs: Array<{ offset: number; value: string }> = [];
  let sawSeparator = false;
  for (let offset = 0; offset < afterArgs.length; offset++) {
    const a = afterArgs[offset];
    if (a === undefined) continue;
    if (!sawSeparator && a === '--') { sawSeparator = true; continue; }
    if (!sawSeparator && a.startsWith('-')) continue;
    specs.push({ offset, value: a });
  }
  return specs;
}

export function findAlreadyStagedGitDeletions(gitCwd: string, rawPathspecs: readonly string[]): Set<string> {
  const stagedDeletions = new Set<string>();
  const missingTargets: Array<{ original: string; relPosix: string }> = [];
  for (const rawPathspec of rawPathspecs) {
    const cleaned = rawPathspec.trim().replace(/^['"]|['"]$/g, '');
    if (cleaned.length === 0 || cleaned === '.' || cleaned === '..' || cleaned.startsWith(':') || /[*?[\]]/.test(cleaned)) continue;
    const absPath = path.resolve(gitCwd, cleaned);
    if (fs.statSync(absPath, { throwIfNoEntry: false }) !== undefined) continue;
    const rel = path.relative(gitCwd, absPath);
    if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    missingTargets.push({ original: rawPathspec, relPosix: rel.replace(/\\/g, '/') });
  }
  if (missingTargets.length === 0) return stagedDeletions;
  try {
    const cachedDelRes = spawnSync('git', ['diff', '--cached', '--relative', '--name-only', '--diff-filter=D', '-z', '--', ...missingTargets.map(m => m.relPosix)], { cwd: gitCwd, encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (cachedDelRes.status !== 0 || typeof cachedDelRes.stdout !== 'string') return stagedDeletions;
    const cachedDeletedSet = new Set(cachedDelRes.stdout.split('\0').filter(Boolean));
    for (const item of missingTargets) {
      if (cachedDeletedSet.has(item.relPosix)) stagedDeletions.add(item.original);
    }
  } catch {
    return stagedDeletions;
  }
  return stagedDeletions;
}

export function isAlreadyStagedGitDeletion(gitCwd: string, rawPathspec: string): boolean {
  return findAlreadyStagedGitDeletions(gitCwd, [rawPathspec]).has(rawPathspec);
}

export function healGitRmStagedDeletions(ctx: ExecutionContext, gitCwd: string, rmIdx: number): void {
  const afterRm = ctx.args.slice(rmIdx + 1);
  if (afterRm.includes('--ignore-unmatch') || afterRm.some(a => a === '--pathspec-from-file' || a.startsWith('--pathspec-from-file='))) return;
  const paths = collectGitPathspecs(afterRm).map(s => s.value);
  if (paths.length > 0 && findAlreadyStagedGitDeletions(gitCwd, paths).size > 0) {
    ctx.args.splice(rmIdx + 1, 0, '--ignore-unmatch');
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '--ignore-unmatch' into 'git rm' for already-staged deletion(s)... (Frictionless Recovery)\x1b[0m`);
  }
}

export function healGitAddStagedDeletions(ctx: ExecutionContext, gitCwd: string, addIdx: number): boolean {
  const afterAdd = ctx.args.slice(addIdx + 1);
  if (afterAdd.some(a => ['-n', '--dry-run', '-i', '--interactive', '-p', '--patch', '-e', '--edit', '--pathspec-from-file'].includes(a) || a.startsWith('--pathspec-from-file='))) {
    return false;
  }
  const pathSpecs = collectGitPathspecs(afterAdd).map(s => ({ argIndex: addIdx + 1 + s.offset, value: s.value }));
  if (pathSpecs.length === 0) return false;
  const stagedSet = findAlreadyStagedGitDeletions(gitCwd, pathSpecs.map(s => s.value));
  if (stagedSet.size === 0) return false;
  const stagedDeleted = pathSpecs.filter(s => stagedSet.has(s.value));
  if (pathSpecs.length > stagedDeleted.length) {
    for (let idx = stagedDeleted.length - 1; idx >= 0; idx--) {
      const item = stagedDeleted[idx];
      if (item !== undefined) ctx.args.splice(item.argIndex, 1);
    }
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Omitting already-staged deletion(s) from 'git add' pathspecs to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
    return false;
  }
  const prefixFlags = ctx.args.slice(0, addIdx);
  ctx.args.splice(0, ctx.args.length, ...prefixFlags, 'ls-files', '--stage', '--', ...stagedDeleted.map(s => s.value));
  syncGitPayloadArgs(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Pathspec(s) passed to 'git add' are already staged as deleted; treating as idempotent no-op to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
  return true;
}

function hasBroadAllAddFlag(afterAdd: readonly string[]): boolean {
  for (const a of afterAdd) {
    if (a === '--') break;
    if (a === '-A' || a === '--all' || a === '--no-ignore-removal' || ALL_ADD_FLAG_RE.test(a)) return true;
  }
  return false;
}

function hasPrivateStateInDir(dirPath: string): boolean {
  const baseName = path.basename(dirPath).toLowerCase();
  const agentsDir = baseName === '.agents' ? dirPath : path.join(dirPath, '.agents');
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    return entries.some((entry) => {
      const nameLower = entry.name.toLowerCase();
      return nameLower === 'scratch' || nameLower === 'cache' || nameLower.endsWith('issues.jsonl');
    });
  } catch {
    return false;
  }
}

export function blockGitAdd(hint: string, fix: string): void {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. ${fix} Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  process.exit(1);
}

function guardBroadAgentsForceAdd(rawLabel: string, repoRoot: string): void {
  const rootAgentsDir = path.resolve(repoRoot, '.agents');
  if (hasPrivateStateInDir(rootAgentsDir)) {
    blockGitAdd(
      `Refusing to force-add broad directory '${rawLabel}': '.agents' contains scratch/cache directories or *issues.jsonl logs.`,
      `Remove '${rawLabel}' from 'git add -f'. Stage explicit tracked paths only.`,
    );
  }
  if (fs.statSync(rootAgentsDir, { throwIfNoEntry: false })?.isDirectory() === true) {
    const rootProbe = probeGitIgnore(repoRoot, '.agents');
    if (rootProbe.ignored && isWholesaleAgentsIgnore(rootProbe.pattern)) {
      blockGitAdd(
        `Refusing to force-add broad directory '${rawLabel}': this repo ignores '.agents/' wholesale (${rootProbe.pattern ?? '.agents/'}), so its agent tooling must stay out of git.`,
        `Remove '${rawLabel}' from 'git add -f'. Stage explicit tracked paths only.`,
      );
    }
  }
}

export function healGitAddForceFlag(ctx: ExecutionContext, gitCwd: string, addIdx: number): void {
  if (addIdx === -1) return;
  const repoRoot = findGitRepoRoot(gitCwd);
  const rootAgentsDir = path.resolve(repoRoot, '.agents');
  const afterAdd = ctx.args.slice(addIdx + 1);
  const hasForce = afterAdd.some(a => a === '--force' || GIT_ADD_FORCE_RE.test(a));
  if (hasForce && hasBroadAllAddFlag(afterAdd)) {
    guardBroadAgentsForceAdd('-A', repoRoot);
  }
  const paths = collectGitPathspecs(afterAdd).map(s => s.value);
  let hasNonAgentsPath = false;
  let anyIgnoredAgents = false;
  for (const rawSpec of paths) {
    const magic = stripGitPathspecMagic(rawSpec);
    if (magic.isExcluded) continue;
    const baseDir = magic.isTopRooted ? repoRoot : gitCwd;
    const posixNorm = path.posix.normalize(magic.cleaned);
    const absResolved = path.resolve(baseDir, posixNorm);
    if (PRIVATE_PATH_RE.test(rawSpec) || PRIVATE_PATH_RE.test(posixNorm) || PRIVATE_PATH_RE.test(absResolved)) {
      return blockGitAdd(`Refusing to ${hasForce ? 'force-add' : 'add'} '${rawSpec}': scratch/cache directories and *issues.jsonl logs are private runtime state.`, `Remove '${rawSpec}' from 'git add' (and drop -f). Stage explicit tracked paths only.`);
    }
    const normRel = posixNorm.replace(/\/+$/, '');
    const relToRoot = path.relative(repoRoot, absResolved).replace(/\\/g, '/');
    const isAgentsDir = isSameFsPath(absResolved, rootAgentsDir);
    const isBroadOrWildcard = BROAD_ADD_GLOBS.has(normRel) || BROAD_ADD_GLOBS.has(posixNorm) || isSameFsPath(absResolved, repoRoot)
      || isAgentsDir || isContainedInDir(rootAgentsDir, absResolved) || isWildcardTargetingAgents(relToRoot);
    if (hasForce && isBroadOrWildcard) guardBroadAgentsForceAdd(rawSpec, repoRoot);
    const isAgents = AGENTS_PATH_RE.test(rawSpec) || AGENTS_PATH_RE.test(posixNorm) || isContainedInDir(absResolved, rootAgentsDir);
    if (!isAgents) { hasNonAgentsPath = true; continue; }
    const probe = probeGitIgnore(baseDir, magic.cleaned);
    if (probe.ignored && isWholesaleAgentsIgnore(probe.pattern)) {
      return blockGitAdd(`Refusing to ${hasForce ? 'force-add' : 'add'} '${rawSpec}': this repo ignores '.agents/' wholesale (${probe.pattern ?? '.agents/'}), so its agent tooling must stay out of git.`, `Remove '${rawSpec}' from 'git add' (and drop -f). Stage explicit tracked paths only.`);
    }
    if (probe.ignored) anyIgnoredAgents = true;
  }
  if (paths.length > 0 && !hasForce && !hasNonAgentsPath && anyIgnoredAgents) {
    ctx.args.splice(addIdx + 1, 0, '-f');
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '-f' to 'git add' for '.agents' path(s) that git check-ignore reports as ignored... (Frictionless Recovery)\x1b[0m`);
  }
}

export function validateNonHostWslAddPaths(gitCwd: string, afterAdd: readonly string[]): void {
  const normCwd = path.posix.normalize(gitCwd.replace(/\\/g, '/'));
  const blockMsg = (target: string): void => blockGitAdd(
    `Refusing to add '${target}': scratch/cache directories and *issues.jsonl logs are private runtime state.`,
    `Remove '${target}' from 'git add'. Stage explicit tracked paths only.`,
  );
  if (PRIVATE_PATH_RE.test(gitCwd) || PRIVATE_PATH_RE.test(normCwd)) return blockMsg(gitCwd);
  for (const spec of collectGitPathspecs(afterAdd)) {
    const magic = stripGitPathspecMagic(spec.value);
    if (magic.isExcluded) continue;
    const normArg = magic.cleaned;
    if (PRIVATE_PATH_RE.test(spec.value) || PRIVATE_PATH_RE.test(normArg) || PRIVATE_PATH_RE.test(path.posix.resolve(normCwd, normArg))) {
      return blockMsg(spec.value);
    }
  }
}
