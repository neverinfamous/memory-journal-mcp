// @ts-nocheck
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { GIT_CMD_MAX_BUFFER, GIT_TIMEOUT_MS } from './constants.js';
import { hasUnsafeWin32PathSyntax, isPathContained, scrubCredentialUrls } from './security-utils.js';

const execFileAsync = promisify(execFile);
const FILTER_KEY_PATTERN = '^(user\\.(name|email)|core\\.(worktree|excludesfile)|filter\\..*\\.(clean|process|smudge|required))$';
const FILTER_CONFIG_ARGS = ['--no-pager', '-c', 'core.fsmonitor=false', 'config', '--show-scope', '--null', '--get-regexp', FILTER_KEY_PATTERN];
const MAX_FILTER_DRIVERS = 128;
const NON_NEG_INT_RE = /^(?:0|[1-9]\d*)$/;
const NEWLINE_SPACE_RE = /\r?\n/g;

export interface SafeUncommittedGitContext {
  env: NodeJS.ProcessEnv;
  userConfigRaw: string;
}

export const GIT_LOG_SAFE_CONFIG_ARGS = [
  '-c', 'core.quotePath=false',
  '-c', 'core.fsmonitor=false',
  '-c', 'diff.external=',
  '-c', 'diff.submodule=short',
  '-c', 'status.submoduleSummary=false',
  '-c', 'log.showSignature=false',
  '-c', 'log.mailmap=false',
  '-c', 'mailmap.file=',
  '-c', 'mailmap.blob=',
  '-c', 'core.attributesFile=',
  '-c', 'diff.orderFile=/dev/null',
  '-c', 'color.ui=false',
  '-c', 'color.diff=false',
] as const;

export const GIT_LOG_SAFE_POST_ARGS = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-show-signature',
  '--no-use-mailmap',
  '--no-color',
] as const;

interface ParsedGitConfig {
  drivers: Set<string>;
  userConfigRaw: string;
  worktree?: string;
  clearExcludesFile: boolean;
}

function parseGitConfigOutput(raw: string): ParsedGitConfig {
  const drivers = new Set<string>();
  const userLines: string[] = [];
  let worktree: string | undefined;
  let clearExcludesFile = false;
  if (!raw) return { drivers, userConfigRaw: '', clearExcludesFile };
  const parts = raw.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i] ?? '';
    const record = parts[i + 1] ?? '';
    if (!record) continue;
    const nl = record.indexOf('\n');
    const key = nl === -1 ? record : record.slice(0, nl);
    const val = nl === -1 ? '' : record.slice(nl + 1);
    const keyLower = key.toLowerCase();
    if (keyLower === 'user.name' || keyLower === 'user.email') {
      userLines.push(`${keyLower} ${val.replace(NEWLINE_SPACE_RE, ' ')}`);
      continue;
    }
    if (keyLower === 'core.worktree') { worktree = val; continue; }
    if (keyLower === 'core.excludesfile') {
      if (scope === 'local' || scope === 'worktree' || hasUnsafeWin32PathSyntax(val)) clearExcludesFile = true;
      continue;
    }
    if (!key.startsWith('filter.')) continue;
    const lastDot = key.lastIndexOf('.');
    if (lastDot <= 7) continue;
    const driver = key.slice(7, lastDot);
    if (!driver || driver.includes('\0')) continue;
    drivers.add(driver);
    if (drivers.size > MAX_FILTER_DRIVERS) {
      throw new Error(`Exceeded maximum allowed git filter drivers (${MAX_FILTER_DRIVERS}).`);
    }
  }
  return { drivers, userConfigRaw: userLines.join('\n'), clearExcludesFile, ...(worktree !== undefined ? { worktree } : {}) };
}

function resolveWorktreeCandidate(cwd: string, realCwd: string, rawWt: string, fromEnv: boolean, env: NodeJS.ProcessEnv): string {
  if (path.isAbsolute(rawWt)) return path.resolve(rawWt);
  if (fromEnv) return path.resolve(realCwd, rawWt);
  const dotGit = path.join(realCwd, '.git');
  const st = fs.lstatSync(dotGit, { throwIfNoEntry: false });
  if (st && st.isDirectory() && !st.isSymbolicLink()) return path.resolve(dotGit, rawWt);
  const top = execFileSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true, env,
  }).trim();
  if (!top) throw new Error('Unable to resolve git worktree toplevel safely.');
  return path.resolve(top);
}

function assertContainedWorktree(cwd: string, worktree: string | undefined, baseEnv?: NodeJS.ProcessEnv): void {
  const srcEnv = baseEnv ?? process.env;
  const envWt = typeof srcEnv['GIT_WORK_TREE'] === 'string' ? srcEnv['GIT_WORK_TREE'] : undefined;
  const rawWt = envWt ?? worktree;
  if (rawWt === undefined) return;
  if (!rawWt.trim() || hasUnsafeWin32PathSyntax(rawWt)) {
    throw new Error(`Unsafe git worktree path rejected: ${scrubCredentialUrls(rawWt)}`);
  }
  const realCwd = fs.realpathSync(cwd);
  const candidate = resolveWorktreeCandidate(cwd, realCwd, rawWt, envWt !== undefined, srcEnv);
  if (hasUnsafeWin32PathSyntax(candidate) || !isPathContained(realCwd, candidate)) {
    throw new Error(`Git worktree escapes repository root: ${scrubCredentialUrls(rawWt)}`);
  }
  let cur = candidate;
  while (true) {
    const st = fs.lstatSync(cur, { throwIfNoEntry: false });
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`Unsafe git worktree symlink or non-directory: ${cur}`);
      if (!isPathContained(realCwd, fs.realpathSync(cur))) throw new Error(`Git worktree realpath escapes repository root: ${rawWt}`);
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur || path.relative(realCwd, cur) === '') break;
    cur = parent;
  }
}

function applyDisabledFilterEnv(raw: string, cwd: string, baseEnv?: NodeJS.ProcessEnv): SafeUncommittedGitContext {
  const srcEnv = baseEnv ?? process.env;
  const { drivers, userConfigRaw, worktree, clearExcludesFile } = parseGitConfigOutput(raw);
  assertContainedWorktree(cwd, worktree, baseEnv);
  if (drivers.size === 0 && !clearExcludesFile) return { env: srcEnv, userConfigRaw };

  const nextEnv: NodeJS.ProcessEnv = { ...srcEnv };
  const rawCount = typeof srcEnv['GIT_CONFIG_COUNT'] === 'string' ? srcEnv['GIT_CONFIG_COUNT'].trim() : '';
  let count = NON_NEG_INT_RE.test(rawCount) ? Number.parseInt(rawCount, 10) : 0;
  if (!Number.isSafeInteger(count) || count > 1024) {
    throw new Error(`Invalid inherited GIT_CONFIG_COUNT value: ${rawCount}`);
  }
  if (clearExcludesFile) {
    nextEnv[`GIT_CONFIG_KEY_${count}`] = 'core.excludesFile';
    nextEnv[`GIT_CONFIG_VALUE_${count}`] = '';
    count++;
  }
  for (const driver of drivers) {
    const overrides: readonly [string, string][] = [
      [`filter.${driver}.clean`, ''],
      [`filter.${driver}.process`, ''],
      [`filter.${driver}.smudge`, ''],
      [`filter.${driver}.required`, 'false'],
    ];
    for (const [k, v] of overrides) {
      nextEnv[`GIT_CONFIG_KEY_${count}`] = k;
      nextEnv[`GIT_CONFIG_VALUE_${count}`] = v;
      count++;
    }
  }
  nextEnv['GIT_CONFIG_COUNT'] = String(count);
  return { env: nextEnv, userConfigRaw };
}

function formatConfigFailure(err: unknown, status?: number | null, stderr?: string): Error {
  const errStr = err instanceof Error
    ? err.message
    : typeof err === 'string' || typeof err === 'number' || typeof err === 'boolean'
      ? String(err)
      : (err !== undefined && err !== null ? (JSON.stringify(err) ?? typeof err) : `exit ${status ?? 'unknown'}`);
  const detail = stderr?.trim() || errStr;
  return new Error(`Git filter config inspection failed: ${scrubCredentialUrls(detail)}`, err instanceof Error ? { cause: err } : undefined);
}

/** [INTENT]: Inspect `user.(name|email)` and neutralize repo-configured `filter.<driver>.*` hooks in 1 config invocation. */
export function buildSafeUncommittedGitContext(cwd: string, baseEnv?: NodeJS.ProcessEnv): SafeUncommittedGitContext {
  const res = spawnSync('git', FILTER_CONFIG_ARGS, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: GIT_CMD_MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    ...(baseEnv ? { env: baseEnv } : {}),
  });
  if (res.error) {
    if ('code' in res.error && res.error.code === 'ENOENT') {
      assertContainedWorktree(cwd, undefined, baseEnv);
      return { env: baseEnv ?? process.env, userConfigRaw: '' };
    }
    throw formatConfigFailure(res.error, res.status, typeof res.stderr === 'string' ? res.stderr : '');
  }
  if (res.status === 1) {
    assertContainedWorktree(cwd, undefined, baseEnv);
    return { env: baseEnv ?? process.env, userConfigRaw: '' };
  }
  if (res.status !== 0) throw formatConfigFailure(undefined, res.status, typeof res.stderr === 'string' ? res.stderr : '');
  return applyDisabledFilterEnv(res.stdout, cwd, baseEnv);
}

/** [INTENT]: Async counterpart of `buildSafeUncommittedGitContext` for `getUncommittedStateAsync`. */
export async function buildSafeUncommittedGitContextAsync(cwd: string, baseEnv?: NodeJS.ProcessEnv): Promise<SafeUncommittedGitContext> {
  try {
    const { stdout } = await execFileAsync('git', FILTER_CONFIG_ARGS, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: GIT_CMD_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      ...(baseEnv ? { env: baseEnv } : {}),
    });
    return applyDisabledFilterEnv(stdout, cwd, baseEnv);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err.code === 1 || err.code === 'ENOENT')) {
      assertContainedWorktree(cwd, undefined, baseEnv);
      return { env: baseEnv ?? process.env, userConfigRaw: '' };
    }
    const stderr = err instanceof Error && 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : '';
    throw formatConfigFailure(err, undefined, stderr);
  }
}

export const buildFilterSafeGitEnv = (cwd: string, baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  buildSafeUncommittedGitContext(cwd, baseEnv).env;

export const buildFilterSafeGitEnvAsync = async (cwd: string, baseEnv?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> =>
  (await buildSafeUncommittedGitContextAsync(cwd, baseEnv)).env;
