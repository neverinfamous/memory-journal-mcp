// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENT_EXEC_README_URL } from './utils.js';

export const AGENTS_PATH_RE = /(?:^|[\\/])\.agents(?:[\\/]|$)/i;
export const PRIVATE_PATH_RE = /(?:^|[\\/])\.agents[\\/](?:scratch|cache)(?:[\\/]|$)|issues\.jsonl$/i;
export const GLOB_META_RE = /[*?[\]]/;
export const PATHSPEC_FROM_FILE_RE = /^--pathspec-fr[a-z-]*(?:=|$)/;

const SAFE_ENV_BASENAMES: ReadonlySet<string> = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.schema',
]);
const PRIVATE_KEY_EXT_RE = /\.(?:pem|key|p12|pfx)$/;
const PRIVATE_KEY_NAMES: ReadonlySet<string> = new Set(['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']);
const SECRET_GLOB_RE = /^(?:\*\.env(?:\.[^/]*)?|\*?\.env\*|\*?\.env\.[^*]*\*|\*?secrets\.env\*?|\*?id_(?:rsa|ed25519|ecdsa|dsa)\*?|\*\.(?:pem|key|p12|pfx)\*?)$/;

export function blockGitAdd(hint: string, fix: string): void {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. ${fix} Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  process.exit(1);
}

export function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

export function matchesGitLongOpt(arg: string, fullFlag: string, minLen: number): boolean {
  return arg.length >= minLen && arg.length <= fullFlag.length && fullFlag.startsWith(arg);
}

export function stripGitPathspecMagic(rawSpec: string): { isTopRooted: boolean; isExcluded: boolean; cleaned: string } {
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
    if (idx < s.length && s[idx] === ':') idx++;
    s = s.slice(idx);
  }
  const norm = s.replace(/\\/g, '/');
  const trimmedLeading = isTopRooted ? norm.replace(/^\/+/, '') : norm;
  return { isTopRooted, isExcluded, cleaned: trimmedLeading.length > 0 ? trimmedLeading : '.' };
}

function stripWin32TrailingDotsAndSpaces(seg: string): string {
  let end = seg.length;
  while (end > 0 && (seg[end - 1] === '.' || seg[end - 1] === ' ')) {
    end--;
  }
  return seg.slice(0, end);
}

export function isPrivateRuntimePath(rawPath: string): boolean {
  const normalized = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => stripWin32TrailingDotsAndSpaces(seg))
    .join('/');
  return PRIVATE_PATH_RE.test(normalized);
}

export function isSensitiveSecretPath(rawPath: string): boolean {
  const segments = rawPath
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => stripWin32TrailingDotsAndSpaces(seg).toLowerCase());
  const basename = segments[segments.length - 1] ?? '';
  if (basename === 'secrets.env' || SECRET_GLOB_RE.test(basename)) return true;
  if ((basename === '.env' || basename.startsWith('.env.')) && !SAFE_ENV_BASENAMES.has(basename)) {
    return true;
  }
  return PRIVATE_KEY_EXT_RE.test(basename) || PRIVATE_KEY_NAMES.has(basename);
}

export function guardPathspecFromFile(afterArgs: readonly string[]): void {
  for (const a of afterArgs) {
    if (a === '--') break;
    if (PATHSPEC_FROM_FILE_RE.test(a)) {
      blockGitAdd(
        "Refusing 'git add --pathspec-from-file': reading pathspecs externally bypasses pre-stage secret and scratch checks.",
        "Pass explicit tracked file paths directly to 'git add'."
      );
    }
  }
}

export function mergeGitEnv(
  payloadEnv: Record<string, string | undefined> | undefined
): NodeJS.ProcessEnv {
  if (payloadEnv === undefined) return process.env;
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(payloadEnv)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

export function extractGitDirWorkTreeFlags(
  topArgs: readonly string[],
  payloadEnv: Record<string, string | undefined> | undefined,
  baseCwd?: string
): { flags: string[]; hasGitOverride: boolean; workTreeOverride: string | undefined } {
  const resolveFlagVal = (val: string): string =>
    baseCwd !== undefined && val.length > 0 && !path.isAbsolute(val) ? path.resolve(baseCwd, val) : val;
  const flags: string[] = [];
  let workTreeOverride: string | undefined;
  for (let i = 0; i < topArgs.length; i++) {
    const arg = topArgs[i];
    if (arg === undefined) continue;
    if (arg === '--git-dir' || arg === '--work-tree') {
      const next = topArgs[i + 1];
      if (next !== undefined) {
        const resolvedNext = resolveFlagVal(next);
        flags.push(arg, resolvedNext);
        if (arg === '--work-tree' && resolvedNext.length > 0) workTreeOverride = resolvedNext;
        i++;
      }
    } else if (arg.startsWith('--git-dir=') || arg.startsWith('--work-tree=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.slice(0, eqIdx);
      const val = resolveFlagVal(arg.slice(eqIdx + 1));
      flags.push(`${key}=${val}`);
      if (key === '--work-tree' && val.length > 0) workTreeOverride = val;
    }
  }
  const hasNonEmptyEnv = (name: string): boolean => {
    const pVal = process.env[name];
    const eVal = payloadEnv?.[name];
    return (pVal !== undefined && pVal.length > 0) || (eVal !== undefined && eVal.length > 0);
  };
  const hasEnvOverride = hasNonEmptyEnv('GIT_DIR') || hasNonEmptyEnv('GIT_WORK_TREE');
  return { flags, hasGitOverride: flags.length > 0 || hasEnvOverride, workTreeOverride };
}

export function resolveEffectiveGitRepoRoot(
  gitCwd: string,
  gitOverrideFlags: readonly string[],
  hasGitOverride: boolean,
  payloadEnv: Record<string, string | undefined> | undefined,
  workTreeOverride: string | undefined,
  fallbackFindRoot: (startDir: string) => string
): string {
  if (!hasGitOverride) return fallbackFindRoot(gitCwd);
  const env = mergeGitEnv(payloadEnv);
  const res = spawnSync('git', [...gitOverrideFlags, 'rev-parse', '--show-toplevel'], {
    cwd: gitCwd,
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    env,
  });
  if (res.status === 0 && typeof res.stdout === 'string' && res.stdout.trim().length > 0) {
    return path.resolve(res.stdout.trim());
  }
  const wtEnv = payloadEnv?.['GIT_WORK_TREE'] ?? process.env['GIT_WORK_TREE'];
  const rawWt = workTreeOverride ?? (wtEnv !== undefined && wtEnv.length > 0 ? wtEnv : undefined);
  if (rawWt !== undefined && rawWt.length > 0) {
    return path.resolve(gitCwd, rawWt);
  }
  return fallbackFindRoot(gitCwd);
}

export interface BroadGitAddScanOptions {
  gitCwd: string;
  repoRoot: string;
  targets: readonly string[];
  hasFullRepoScan: boolean;
  hasForce: boolean;
  isUpdateOnly: boolean;
  gitOverrideFlags: readonly string[];
  hasGitOverride: boolean;
  payloadEnv: Record<string, string | undefined> | undefined;
}

export function scanBroadGitAddForBlockedPaths(opts: BroadGitAddScanOptions): void {
  const { gitCwd, repoRoot, targets, hasFullRepoScan, hasForce, isUpdateOnly, gitOverrideFlags, hasGitOverride, payloadEnv } = opts;
  if (!hasGitOverride && fs.lstatSync(path.join(repoRoot, '.git'), { throwIfNoEntry: false }) === undefined) {
    return;
  }
  const statusArgs = [
    ...gitOverrideFlags,
    '-c', 'status.relativePaths=false',
    'status', '-z',
    ...(isUpdateOnly ? [] : ['-uall', ...(hasForce ? ['--ignored=traditional'] : [])]),
    ...(!hasFullRepoScan && targets.length > 0 ? ['--', ...targets] : []),
  ];
  const env = mergeGitEnv(payloadEnv);
  const res = spawnSync('git', statusArgs, { cwd: gitCwd, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env });
  if (res.error !== undefined || res.status !== 0 || typeof res.stdout !== 'string') {
    blockGitAdd('Pre-stage status scan failed while checking broad git add targets.', 'Stage explicit tracked paths instead of broad globs or directories.');
    return;
  }
  const parts = res.stdout.split('\0');
  for (let i = 0; i < parts.length; ) {
    const part = parts[i];
    if (!part) { i++; continue; }
    const idxSt = part[0];
    const wtSt = part[1];
    if (isUpdateOnly && (idxSt === '?' || wtSt === '?' || idxSt === '!' || wtSt === '!')) { i += 1; continue; }
    const filepath = part.substring(3);
    const isIgnoredForce = hasForce && idxSt === '!' && wtSt === '!';
    if (idxSt !== 'D' && wtSt !== 'D' && (isPrivateRuntimePath(filepath) || isSensitiveSecretPath(filepath) || (isIgnoredForce && AGENTS_PATH_RE.test(filepath)))) {
      blockGitAdd(`Refusing broad 'git add': matches sensitive or private path '${filepath}'.`, 'Add secrets/scratch to .gitignore and stage explicit tracked paths only.');
    }
    i += idxSt === 'R' || idxSt === 'C' || wtSt === 'R' || wtSt === 'C' ? 2 : 1;
  }
}
