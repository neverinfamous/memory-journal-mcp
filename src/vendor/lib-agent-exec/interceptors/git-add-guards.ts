// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { convertToWindowsPath } from '../command-utils.js';
import type { ExecutionContext } from './types.js';
import {
  AGENTS_PATH_RE,
  GLOB_META_RE,
  blockGitAdd,
  extractGitDirWorkTreeFlags,
  guardPathspecFromFile,
  isPrivateRuntimePath,
  isSensitiveSecretPath,
  matchesGitLongOpt,
  mergeGitEnv,
  resolveEffectiveGitRepoRoot,
  scanBroadGitAddForBlockedPaths,
  stripGitPathspecMagic,
  tryRealpath,
} from './git-add-broad-scan.js';
import { collectGitPathspecs, syncGitPayloadArgs } from './git-staged-deletions.js';

export { blockGitAdd };
export {
  collectGitPathspecs,
  findAlreadyStagedGitDeletions,
  healGitAddStagedDeletions,
  healGitRmStagedDeletions,
  isAlreadyStagedGitDeletion,
  syncGitPayloadArgs,
} from './git-staged-deletions.js';

/** [INTENT]: Keep in sync with commit.ts stale-lock threshold (5 minutes). */
export const STALE_INDEX_LOCK_MS = 5 * 60 * 1000;

const GIT_ADD_FORCE_RE = /^-[nvfipeuANU]*f[nvfipeuANU]*$/;
const BROAD_ADD_GLOBS = new Set(['.', './', '..', '../', '.agents', '.agents/', '.agents/*', '.agents/**', '*', '**']);
const ALL_ADD_FLAG_RE = /^-[nvfipeuANU]*A[nvfipeuANU]*$/;
const UPDATE_ADD_FLAG_RE = /^-[nvfipeuANU]*u[nvfipeuANU]*$/;

export interface GitIgnoreProbe {
  ignored: boolean;
  pattern: string | null;
  sourceFile?: string | null;
}

/**
 * [INTENT]: Ask git (in the payload cwd) whether a path is ignored, and by which pattern.
 * Tracked files are never reported as ignored by `git check-ignore`.
 */
export function probeGitIgnore(
  cwd: string,
  target: string,
  gitOverrideFlags: readonly string[] = [],
  payloadEnv?: Record<string, string | undefined>
): GitIgnoreProbe {
  try {
    const res = spawnSync('git', [...gitOverrideFlags, 'check-ignore', '-v', '--', target], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      env: mergeGitEnv(payloadEnv),
    });
    if (res.status !== 0 || typeof res.stdout !== 'string' || res.stdout.trim() === '') {
      return { ignored: false, pattern: null, sourceFile: null };
    }
    const meta = (res.stdout.split(/\r?\n/)[0] ?? '').split('\t')[0] ?? '';
    const patternMatch = meta.match(/^(.*?):\d+:(.*)$/);
    const sourceFile = patternMatch !== null && patternMatch[1] !== undefined ? patternMatch[1] : null;
    const pattern = patternMatch !== null && patternMatch[2] !== undefined ? patternMatch[2] : null;
    if (pattern !== null && pattern.startsWith('!')) {
      return { ignored: false, pattern, sourceFile };
    }
    return { ignored: true, pattern, sourceFile };
  } catch (err: unknown) {
    console.error(`[git-add-guards] git check-ignore failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ignored: false, pattern: null, sourceFile: null };
  }
}

export function isWholesaleAgentsIgnore(pattern: string | null, sourceFile?: string | null): boolean {
  if (pattern === null) return false;
  const norm = pattern.trim().replace(/^\/+/, '').replace(/^\*\*\//, '');
  if (['.agents', '.agents/', '.agents/*', '.agents/**', '.agents/**/*'].includes(norm)) return true;
  if (norm === '*' && typeof sourceFile === 'string') {
    const normSource = sourceFile.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    return normSource === '.agents/.gitignore' || normSource.endsWith('/.agents/.gitignore');
  }
  return false;
}

export function findGitRepoRoot(startDir: string): string {
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

function globSegmentMatches(targetName: string, seg: string): boolean {
  if (!GLOB_META_RE.test(seg)) return seg.toLowerCase() === targetName.toLowerCase();
  let regexSrc = '^';
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i] ?? '';
    if (ch === '*') {
      if (!regexSrc.endsWith('.*')) regexSrc += '.*';
    } else if (ch === '?') regexSrc += '.';
    else if (ch === '[') {
      const close = seg.indexOf(']', i + 1);
      if (close !== -1) {
        const inner = seg.slice(i + 1, close);
        const regexInner = inner.startsWith('!') ? `^${inner.slice(1)}` : inner;
        regexSrc += `[${regexInner}]`;
        i = close;
        continue;
      }
      regexSrc += '\\[';
    } else if (/[.+^${}()|\\]/.test(ch)) {
      regexSrc += `\\${ch}`;
    } else {
      regexSrc += ch;
    }
  }
  try {
    return new RegExp(`${regexSrc}$`, 'i').test(targetName);
  } catch {
    return true;
  }
}

function isWildcardTargetingAgents(posixRelFromRoot: string): boolean {
  const clean = posixRelFromRoot.replace(/^\.\//, '');
  const parts = clean.split('/');
  const firstSeg = parts[0] ?? '';
  if (firstSeg.toLowerCase() === '.agents') {
    return parts.slice(1).some(seg => /[*?[\]]/.test(seg));
  }
  if (!/[*?[\]]/.test(firstSeg)) return false;
  return globSegmentMatches('.agents', firstSeg);
}

function hasBroadAllAddFlag(afterAdd: readonly string[]): boolean {
  for (const a of afterAdd) {
    if (a === '--') break;
    if (
      a === '-A' ||
      matchesGitLongOpt(a, '--all', 4) ||
      matchesGitLongOpt(a, '--no-ignore-removal', 13) ||
      ALL_ADD_FLAG_RE.test(a)
    ) {
      return true;
    }
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
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
    if (code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`WARN: failed inspecting '${agentsDir}': ${msg}`);
    }
    return false;
  }
}

function guardBroadAgentsForceAdd(
  rawLabel: string,
  repoRoot: string,
  gitOverrideFlags: readonly string[] = [],
  payloadEnv?: Record<string, string | undefined>
): void {
  const rootAgentsDir = path.resolve(repoRoot, '.agents');
  if (hasPrivateStateInDir(rootAgentsDir)) {
    blockGitAdd(`Refusing to force-add broad directory '${rawLabel}': '.agents' contains scratch/cache directories or *issues.jsonl logs.`, `Remove '${rawLabel}' from 'git add -f'. Stage explicit tracked paths only.`);
  }
  if (fs.statSync(rootAgentsDir, { throwIfNoEntry: false })?.isDirectory() === true) {
    const dirProbe = probeGitIgnore(repoRoot, '.agents', gitOverrideFlags, payloadEnv);
    const childProbe = dirProbe.ignored ? dirProbe : probeGitIgnore(repoRoot, '.agents/.gitignore', gitOverrideFlags, payloadEnv);
    if (childProbe.ignored && isWholesaleAgentsIgnore(childProbe.pattern, childProbe.sourceFile)) {
      blockGitAdd(`Refusing to force-add broad directory '${rawLabel}': this repo ignores '.agents/' wholesale (${childProbe.pattern ?? '.agents/'}), so its agent tooling must stay out of git.`, `Remove '${rawLabel}' from 'git add -f'. Stage explicit tracked paths only.`);
    }
  }
}

export function probeGitIgnoreBatch(
  cwd: string,
  targets: readonly string[],
  gitOverrideFlags: readonly string[] = [],
  payloadEnv?: Record<string, string | undefined>
): Map<string, GitIgnoreProbe> {
  const result = new Map<string, GitIgnoreProbe>();
  if (targets.length === 0) return result;
  try {
    const res = spawnSync('git', [...gitOverrideFlags, 'check-ignore', '-v', '-z', '--stdin'], {
      cwd,
      encoding: 'utf8',
      input: `${targets.join('\0')}\0`,
      timeout: 10000,
      windowsHide: true,
      env: mergeGitEnv(payloadEnv),
    });
    if (res.status !== 0 || typeof res.stdout !== 'string' || res.stdout.length === 0) return result;
    const fields = res.stdout.split('\0');
    for (let i = 0; i + 3 < fields.length; i += 4) {
      const sourceFile = fields[i] ?? null;
      const pattern = fields[i + 2] ?? null;
      const pathname = fields[i + 3];
      if (pathname !== undefined && pathname.length > 0) {
        result.set(pathname, { ignored: pattern !== null && !pattern.startsWith('!'), pattern, sourceFile });
      }
    }
  } catch (err: unknown) {
    console.error(`[git-add-guards] git check-ignore batch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

interface PendingAgentsProbe {
  rawSpec: string;
  probeRoot: string;
  probeTarget: string;
  isWildcardOrRootGlob: boolean;
}

function evaluateAgentsIgnoreProbes(
  agentsProbes: readonly PendingAgentsProbe[],
  repoRoot: string,
  hasForce: boolean,
  gitOverrideFlags: readonly string[],
  payloadEnv: Record<string, string | undefined> | undefined
): boolean {
  const probesByRoot = new Map<string, string[]>();
  for (const item of agentsProbes) {
    const list = probesByRoot.get(item.probeRoot) ?? [];
    list.push(item.probeTarget);
    probesByRoot.set(item.probeRoot, list);
  }
  const probeResultsByRoot = new Map<string, Map<string, GitIgnoreProbe>>();
  for (const [probeRoot, targets] of probesByRoot) {
    probeResultsByRoot.set(probeRoot, probeGitIgnoreBatch(probeRoot, targets, gitOverrideFlags, payloadEnv));
  }
  let anyIgnoredAgents = false;
  for (const item of agentsProbes) {
    const probe = probeResultsByRoot.get(item.probeRoot)?.get(item.probeTarget) ?? { ignored: false, pattern: null, sourceFile: null };
    if (probe.ignored && isWholesaleAgentsIgnore(probe.pattern, probe.sourceFile)) {
      blockGitAdd(`Refusing to ${hasForce ? 'force-add' : 'add'} '${item.rawSpec}': this repo ignores '.agents/' wholesale (${probe.pattern ?? '.agents/'}), so its agent tooling must stay out of git.`, `Remove '${item.rawSpec}' from 'git add' (and drop -f). Stage explicit tracked paths only.`);
      return false;
    }
    if (probe.ignored) {
      if (!hasForce && item.isWildcardOrRootGlob) {
        guardBroadAgentsForceAdd(item.rawSpec, repoRoot, gitOverrideFlags, payloadEnv);
        return false;
      }
      anyIgnoredAgents = true;
    }
  }
  return anyIgnoredAgents;
}

export function healGitAddForceFlag(ctx: ExecutionContext, gitCwd: string, addIdx: number): void {
  if (addIdx === -1) return;
  const { flags: gitOverrideFlags, hasGitOverride, workTreeOverride } = extractGitDirWorkTreeFlags(ctx.args.slice(0, addIdx), ctx.payload.env, gitCwd);
  const repoRoot = resolveEffectiveGitRepoRoot(gitCwd, gitOverrideFlags, hasGitOverride, ctx.payload.env, workTreeOverride, findGitRepoRoot);
  const rootAgentsDir = path.resolve(repoRoot, '.agents');
  const afterAdd = ctx.args.slice(addIdx + 1);
  guardPathspecFromFile(afterAdd);
  const ddIdx = afterAdd.indexOf('--');
  const preDdAdd = ddIdx === -1 ? afterAdd : afterAdd.slice(0, ddIdx);
  const hasForce = preDdAdd.some(a => matchesGitLongOpt(a, '--force', 3) || GIT_ADD_FORCE_RE.test(a));
  const hasBroadAll = hasBroadAllAddFlag(afterAdd);
  const hasUpdateFlag = preDdAdd.some(a => matchesGitLongOpt(a, '--update', 4) || matchesGitLongOpt(a, '--renormalize', 5) || UPDATE_ADD_FLAG_RE.test(a));
  const hasFullRepoFlag = hasBroadAll || hasUpdateFlag;
  let agentsForceGuarded = false;
  const ensureAgentsForceGuarded = (label: string): void => {
    if (agentsForceGuarded) return;
    agentsForceGuarded = true;
    guardBroadAgentsForceAdd(label, repoRoot, gitOverrideFlags, ctx.payload.env);
  };
  if (hasForce && hasBroadAll) ensureAgentsForceGuarded('-A');
  const paths = collectGitPathspecs(afterAdd).map(s => s.value);
  let hasNonAgentsPath = false;
  let anyBroadOrWildcard = false;
  let hasFullRepoScan = hasFullRepoFlag;
  const agentsProbes: PendingAgentsProbe[] = [];
  const broadScanTargets: string[] = [];
  let hasPositivePath = false;
  let hasExcludedPath = false;

  for (const rawSpec of paths) {
    const magic = stripGitPathspecMagic(rawSpec);
    if (magic.isExcluded) { hasExcludedPath = true; continue; }
    hasPositivePath = true;
    const baseDir = magic.isTopRooted ? repoRoot : gitCwd;
    const posixNorm = path.posix.normalize(magic.cleaned);
    const fsSpec = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(posixNorm) ? convertToWindowsPath(posixNorm) : posixNorm;
    const absResolved = path.resolve(baseDir, fsSpec);
    const realResolved = tryRealpath(absResolved);
    if (isPrivateRuntimePath(rawSpec) || isPrivateRuntimePath(posixNorm) || isPrivateRuntimePath(absResolved) || (realResolved !== null && isPrivateRuntimePath(realResolved))) {
      return blockGitAdd(`Refusing to ${hasForce ? 'force-add' : 'add'} '${rawSpec}': scratch/cache directories and *issues.jsonl logs are private runtime state.`, `Remove '${rawSpec}' from 'git add' (and drop -f). Stage explicit tracked paths only.`);
    }
    if (isSensitiveSecretPath(rawSpec) || isSensitiveSecretPath(posixNorm) || isSensitiveSecretPath(absResolved) || (realResolved !== null && isSensitiveSecretPath(realResolved))) {
      return blockGitAdd(`Refusing to ${hasForce ? 'force-add' : 'add'} '${rawSpec}': secrets/env/private key files must never be staged.`, `Remove '${rawSpec}' from 'git add'.`);
    }
    const isDirTarget = fs.statSync(absResolved, { throwIfNoEntry: false })?.isDirectory() === true;
    const unquotedRawSpec = rawSpec.trim().replace(/^['"]|['"]$/g, '');
    if (isSameFsPath(absResolved, repoRoot) || isContainedInDir(repoRoot, absResolved)) {
      hasFullRepoScan = true;
    } else if (GLOB_META_RE.test(magic.cleaned) || isDirTarget || magic.hasNonLiteralMagic) {
      broadScanTargets.push(magic.hasNonLiteralMagic ? unquotedRawSpec : (magic.isTopRooted ? `:/${magic.cleaned}` : magic.cleaned));
    }
    const normRel = posixNorm.replace(/\/+$/, '');
    const relToRoot = path.relative(repoRoot, absResolved).replace(/\\/g, '/');
    const isWildcardAgents = isWildcardTargetingAgents(relToRoot);
    const isAgentsDir = isSameFsPath(absResolved, rootAgentsDir) || (realResolved !== null && isSameFsPath(realResolved, rootAgentsDir));
    const inAgentsDir = isContainedInDir(absResolved, rootAgentsDir) || (realResolved !== null && isContainedInDir(realResolved, rootAgentsDir));
    const isWildcardOrRootGlob = BROAD_ADD_GLOBS.has(normRel) || BROAD_ADD_GLOBS.has(posixNorm) || isWildcardAgents;
    const isBroadOrWildcard = isWildcardOrRootGlob || isSameFsPath(absResolved, repoRoot) || isAgentsDir || isContainedInDir(rootAgentsDir, absResolved) || (isDirTarget && inAgentsDir);
    if (isBroadOrWildcard) anyBroadOrWildcard = true;
    if (hasForce && isBroadOrWildcard) ensureAgentsForceGuarded(rawSpec);
    const isAgents = AGENTS_PATH_RE.test(rawSpec) || AGENTS_PATH_RE.test(posixNorm) || inAgentsDir || isWildcardAgents;
    if (!isAgents) { hasNonAgentsPath = true; continue; }
    const canProbeFromRoot = relToRoot.length > 0 && !relToRoot.startsWith('..');
    agentsProbes.push({ rawSpec, probeRoot: canProbeFromRoot ? repoRoot : baseDir, probeTarget: canProbeFromRoot ? relToRoot : magic.cleaned, isWildcardOrRootGlob });
  }
  if (hasExcludedPath && !hasPositivePath) {
    anyBroadOrWildcard = true;
    broadScanTargets.push(...paths.map(p => p.trim().replace(/^['"]|['"]$/g, '')));
    if (hasForce) ensureAgentsForceGuarded(paths[0] ?? ':!');
  }
  if (hasFullRepoScan || broadScanTargets.length > 0) {
    scanBroadGitAddForBlockedPaths({ gitCwd, repoRoot, targets: broadScanTargets, hasFullRepoScan, hasForce, isUpdateOnly: !hasBroadAll && hasUpdateFlag, gitOverrideFlags, hasGitOverride, payloadEnv: ctx.payload.env });
  }
  const anyIgnoredAgents = evaluateAgentsIgnoreProbes(agentsProbes, repoRoot, hasForce, gitOverrideFlags, ctx.payload.env);
  if (paths.length > 0 && !hasForce && !hasNonAgentsPath && anyIgnoredAgents && !anyBroadOrWildcard) {
    ctx.args.splice(addIdx + 1, 0, '-f');
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '-f' to 'git add' for '.agents' path(s) that git check-ignore reports as ignored... (Frictionless Recovery)\x1b[0m`);
  }
}

export function validateNonHostWslAddPaths(gitCwd: string, afterAdd: readonly string[]): void {
  guardPathspecFromFile(afterAdd);
  const normCwd = path.posix.normalize(gitCwd.replace(/\\/g, '/'));
  const blockMsg = (target: string): void => blockGitAdd(
    `Refusing to add '${target}': scratch/cache directories and *issues.jsonl logs are private runtime state.`,
    `Remove '${target}' from 'git add'. Stage explicit tracked paths only.`,
  );
  if (isPrivateRuntimePath(gitCwd) || isPrivateRuntimePath(normCwd)) return blockMsg(gitCwd);
  for (const spec of collectGitPathspecs(afterAdd)) {
    const magic = stripGitPathspecMagic(spec.value);
    if (magic.isExcluded) continue;
    const normArg = path.posix.normalize(magic.cleaned);
    if (isPrivateRuntimePath(spec.value) || isPrivateRuntimePath(normArg) || isPrivateRuntimePath(path.posix.resolve(normCwd, normArg))) {
      return blockMsg(spec.value);
    }
    if (isSensitiveSecretPath(spec.value) || isSensitiveSecretPath(normArg)) {
      return blockGitAdd(
        `Refusing to add '${spec.value}': secrets/env/private key files must never be staged.`,
        `Remove '${spec.value}' from 'git add'.`
      );
    }
  }
}
