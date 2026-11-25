// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { match, P } from 'ts-pattern';
import { execFileSync } from 'node:child_process';
import { convertToWindowsPath, convertToWslPath } from '../command-utils.js';
import { type ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL, hasJournalctlFollowFlag } from './utils.js';
import { sanitizeJqInvocation } from './jq-sanitizer.js';
import { extractGitDirWorkTreeFlags } from './git-add-broad-scan.js';
import {
  STALE_INDEX_LOCK_MS,
  collectGitPathspecs,
  findAlreadyStagedGitDeletions,
  findGitRepoRoot,
  healGitAddForceFlag,
  healGitAddStagedDeletions,
  healGitRmStagedDeletions,
  isAlreadyStagedGitDeletion,
  isWholesaleAgentsIgnore,
  probeGitIgnore,
  syncGitPayloadArgs,
  validateNonHostWslAddPaths,
  type GitIgnoreProbe,
} from './git-add-guards.js';

export {
  STALE_INDEX_LOCK_MS,
  probeGitIgnore,
  isWholesaleAgentsIgnore,
  findAlreadyStagedGitDeletions,
  isAlreadyStagedGitDeletion,
  type GitIgnoreProbe,
};

const GIT_TOP_VALUE_FLAGS = new Set([
  '-c', '--attr-source', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);

interface ParsedGitInvocation {
  gitCwd: string;
  subcmdIndex: number;
  subcmd: string | undefined;
}

const MUTATING_MNT_PREFIX_RE = /^\/mnt\/[a-zA-Z](?:\/|$)/i;
const RM_SHORT_INTERACTIVE_CLUSTER_RE = /^-[a-zA-Z]*[iI][a-zA-Z]*$/;
const RM_STRIP_I_RE = /[iI]/g;

/**
 * [INTENT]: Resolve effective git working directory (honoring top-level `-C <dir>`) and locate the git subcommand
 * before `gitInterceptor` strips `-C`, preventing false matches on arguments like `git remote add`.
 */
function isPosixOrTildePath(p: string): boolean {
  return p.startsWith('/') || p === '~' || p.startsWith('~/');
}

function resolveMutatingGitDir(next: string, currentCwd: string): string {
  const isPosixBase = isPosixOrTildePath(currentCwd);
  let normalized = next;
  if (MUTATING_MNT_PREFIX_RE.test(next) && process.platform === 'win32') {
    normalized = convertToWindowsPath(next);
  } else if (isPosixBase && path.win32.isAbsolute(next)) {
    normalized = convertToWslPath(next);
  }
  if (normalized.startsWith('/') || normalized === '~' || normalized.startsWith('~/') || path.win32.isAbsolute(normalized)) {
    return normalized;
  }
  if (isPosixBase) {
    return currentCwd.startsWith('~') ? path.posix.join(currentCwd, normalized) : path.posix.resolve(currentCwd, normalized);
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(currentCwd, normalized);
}

function parseGitInvocation(ctx: ExecutionContext): ParsedGitInvocation {
  const rawPayloadCwd = ctx.payload.cwd;
  const convertedPayloadCwd = rawPayloadCwd !== undefined && rawPayloadCwd.length > 0 && MUTATING_MNT_PREFIX_RE.test(rawPayloadCwd) && process.platform === 'win32'
    ? convertToWindowsPath(rawPayloadCwd)
    : rawPayloadCwd;
  const baseCwd =
    convertedPayloadCwd !== undefined && convertedPayloadCwd.length > 0
      ? (isPosixOrTildePath(convertedPayloadCwd) ? convertedPayloadCwd : path.resolve(convertedPayloadCwd))
      : ctx.cwd !== undefined && ctx.cwd.length > 0
        ? (isPosixOrTildePath(ctx.cwd) ? ctx.cwd : path.resolve(ctx.cwd))
        : process.cwd();
  let gitCwd = baseCwd;
  let i = 0;
  while (i < ctx.args.length) {
    const a = ctx.args[i];
    if (a === undefined || a === '--') break;
    if (a === '-C') {
      const next = ctx.args[i + 1];
      if (next !== undefined && next.length > 0) gitCwd = resolveMutatingGitDir(next, gitCwd);
      i += 2;
    } else if (a.startsWith('-C') && a.length > 2) {
      gitCwd = resolveMutatingGitDir(a.slice(2), gitCwd);
      i += 1;
    } else if (GIT_TOP_VALUE_FLAGS.has(a)) {
      i += 2;
    } else if (a.startsWith('-')) {
      i += 1;
    } else {
      break;
    }
  }
  return { gitCwd, subcmdIndex: i, subcmd: ctx.args[i] };
}

const SUDO_VALUE_FLAGS = new Set([
  '-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
  '-r', '--role', '-t', '--type', '-C', '--close-from', '-D', '--chdir',
  '-T', '--command-timeout', '-U', '--other-user',
]);
const SUDO_SHORT_VALUE_CHARS = new Set(['u', 'g', 'h', 'p', 'r', 't', 'C', 'D', 'T', 'U']);

function hasSudoNonInteractiveFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-n' || a === '--non-interactive') return true;
    if (!a.startsWith('-')) break;
    if (SUDO_VALUE_FLAGS.has(a)) {
      i += 1;
      continue;
    }
    if (!a.startsWith('--')) {
      let takesNext = false;
      for (let c = 1; c < a.length; c++) {
        const ch = a[c] ?? '';
        if (ch === 'n') return true;
        if (SUDO_SHORT_VALUE_CHARS.has(ch)) {
          takesNext = c === a.length - 1;
          break;
        }
      }
      if (takesNext) i += 1;
    }
  }
  return false;
}

const WIN_PING_T_RE = /^[-/]t$/i;
const UNIX_PING_C_RE = /^-c\d+$/;
const RM_FORCE_SHORT_RE = /^-([a-zA-Z]*f[a-zA-Z]*)$/;

const MAX_DOT_GIT_FILE_BYTES = 4096;

function isRegularNonSymlinkFile(filePath: string): boolean {
  const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isFile();
}

function isValidGitDir(dirPath: string): boolean {
  const dirStat = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  if (dirStat === undefined || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false;
  return isRegularNonSymlinkFile(path.join(dirPath, 'HEAD'));
}

export function resolveGitIndexLockPath(lockRoot: string): string | null {
  const dotGitPath = path.join(lockRoot, '.git');
  const dotGitStat = fs.lstatSync(dotGitPath, { throwIfNoEntry: false });
  if (dotGitStat === undefined || dotGitStat.isSymbolicLink()) return null;
  if (dotGitStat.isDirectory()) {
    return isValidGitDir(dotGitPath) ? path.join(dotGitPath, 'index.lock') : null;
  }
  if (dotGitStat.isFile() && dotGitStat.size <= MAX_DOT_GIT_FILE_BYTES) {
    try {
      const content = fs.readFileSync(dotGitPath, 'utf8');
      const match = /^gitdir:[ \t]*([^\r\n]+)$/im.exec(content);
      const rawDir = match?.[1]?.trim();
      if (rawDir !== undefined && rawDir.length > 0) {
        const resolvedGitDir = path.resolve(lockRoot, rawDir);
        return isValidGitDir(resolvedGitDir) ? path.join(resolvedGitDir, 'index.lock') : null;
      }
    } catch (err: unknown) {
      const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
      if (code !== 'ENOENT' && code !== 'EISDIR') {
        console.error(`⚠️ .git pointer read warning (${dotGitPath}): ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
    }
  }
  return null;
}

function cleanupStaleGitIndexLock(lockRoot: string): void {
  const lockPath = resolveGitIndexLockPath(lockRoot);
  if (lockPath === null) return;
  const lockStats = fs.lstatSync(lockPath, { throwIfNoEntry: false });
  if (lockStats === undefined || lockStats.isSymbolicLink() || !lockStats.isFile()) return;
  const ageMs = Date.now() - lockStats.mtimeMs;
  if (ageMs <= STALE_INDEX_LOCK_MS) return;
  try {
    fs.unlinkSync(lockPath);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected stale '.git/index.lock' (age: ${Math.round(ageMs / 1000)}s). Removing lock to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT') {
      console.error(`⚠️ Stale git index.lock removal failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function healGitMutatingCommand(ctx: ExecutionContext, matchedArgs: readonly string[]): void {
  const { gitCwd, subcmdIndex, subcmd } = parseGitInvocation(ctx);
  const isNonHostPosixCwd = process.platform === 'win32'
    && ((gitCwd.startsWith('/') && !MUTATING_MNT_PREFIX_RE.test(gitCwd)) || gitCwd.startsWith('~'));
  const hasLocalGitCwd = !isNonHostPosixCwd && fs.statSync(gitCwd, { throwIfNoEntry: false })?.isDirectory() === true;
  let preResolvedRepoRoot: string | undefined;
  if (hasLocalGitCwd) {
    const lockRoot = findGitRepoRoot(gitCwd);
    preResolvedRepoRoot = lockRoot;
    cleanupStaleGitIndexLock(lockRoot);
  }
  if (subcmd === 'rm' && ctx.payload.target !== 'wsl2') healGitRmStagedDeletions(ctx, gitCwd, subcmdIndex);
  else if (subcmd === 'add') {
    const preLen = ctx.args.length;
    const preOverrides = ctx.payload.target !== 'wsl2' || hasLocalGitCwd
      ? extractGitDirWorkTreeFlags(ctx.args.slice(0, subcmdIndex), ctx.payload.env, gitCwd)
      : undefined;
    const prePathspecs = collectGitPathspecs(ctx.args.slice(subcmdIndex + 1));
    const rewritten = ctx.payload.target !== 'wsl2'
      ? healGitAddStagedDeletions(ctx, gitCwd, subcmdIndex, preOverrides?.flags, prePathspecs)
      : false;
    if (!rewritten && (ctx.payload.target !== 'wsl2' || hasLocalGitCwd)) {
      healGitAddForceFlag(ctx, gitCwd, subcmdIndex, preResolvedRepoRoot, preOverrides, ctx.args.length === preLen ? prePathspecs : undefined);
    } else if (!rewritten) validateNonHostWslAddPaths(gitCwd, ctx.args.slice(subcmdIndex + 1));
  }
  const ddIdx = matchedArgs.indexOf('--');
  const bFlags = ddIdx === -1 ? matchedArgs : matchedArgs.slice(0, ddIdx);
  const isReadBranchRemote = subcmd === 'branch' && ctx.payload.target !== 'wsl2' && hasLocalGitCwd
    && (bFlags.includes('-r') || bFlags.includes('--remotes'))
    && !bFlags.some(a => a === '-d' || a === '-D' || a === '--delete' || a === '-h' || a === '--help');
  if (!isReadBranchRemote) return;
  try {
    execFileSync('git', ['fetch', '-p'], {
      cwd: gitCwd, stdio: 'ignore', timeout: 60000, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: process.env['GIT_SSH_COMMAND'] ?? 'ssh -o BatchMode=yes' },
    });
    console.error(`\n   💡 AGENT HINT: 'git branch -r' may return stale deleted branches.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Synchronously running 'git fetch -p' to prune the cache before executing branch listing.\x1b[0m`);
  } catch (err) {
    console.error(`   ⚠️ git fetch -p failed before 'git branch -r': ${err instanceof Error ? err.message : String(err)}`);
  }
}

const SSH_OPT_VALUE_FLAGS = new Set(['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-P', '-p', '-Q', '-R', '-S', '-W', '-w']);

function hasSshOption(args: readonly string[], optionRe: RegExp): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (!a.startsWith('-')) break;
    if (a === '-o') {
      const next = args[i + 1];
      if (next !== undefined && optionRe.test(next)) return true;
      i++;
      continue;
    }
    if (a.startsWith('-o') && a.length > 2) {
      if (optionRe.test(a.slice(2))) return true;
      continue;
    }
    if (SSH_OPT_VALUE_FLAGS.has(a)) i++;
  }
  return false;
}

const SSH_STRICT_HOST_KEY_RE = /^\s*StrictHostKeyChecking(?:=|\s+)/i;
const SSH_BATCH_MODE_YES_RE = /^\s*BatchMode(?:=|\s+)yes\b/i;

function healRmCommand(ctx: ExecutionContext): void {
  const ddIdx = ctx.args.indexOf('--');
  const endIdx = ddIdx === -1 ? ctx.args.length : ddIdx;
  let strippedInteractive = false;
  for (let i = endIdx - 1; i >= 0; i--) {
    const a = ctx.args[i];
    if (a === undefined) continue;
    if (a === '-i' || a === '-I' || a === '--interactive' || a.startsWith('--interactive=')) {
      ctx.args.splice(i, 1);
      strippedInteractive = true;
    } else if (!a.startsWith('--') && RM_SHORT_INTERACTIVE_CLUSTER_RE.test(a)) {
      const rest = a.replace(RM_STRIP_I_RE, '');
      if (rest === '-') ctx.args.splice(i, 1);
      else ctx.args[i] = rest;
      strippedInteractive = true;
    }
  }
  const nextDdIdx = ctx.args.indexOf('--');
  const flagsSlice = nextDdIdx === -1 ? ctx.args : ctx.args.slice(0, nextDdIdx);
  const hasForce = flagsSlice.some(a => a === '-f' || a === '--force' || RM_FORCE_SHORT_RE.test(a));
  if (!hasForce || strippedInteractive) {
    if (!hasForce) ctx.args.unshift('-f');
    syncGitPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically enforcing '-f' (non-interactive) on rm command to prevent interactive prompts and missing file errors.... (Frictionless Recovery)`);
  }
}

export function runMutatingInterceptors(
  ctx: ExecutionContext,
  derived: { cmd: string; cmdBasename: string; args: string[] }
): void {
  const { cmd, cmdBasename, args } = derived;

  match({ cmd, args })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args: matchedArgs }) => {
      let mutated = false;
      if (!hasSshOption(matchedArgs, SSH_STRICT_HOST_KEY_RE)) {
        ctx.args.unshift('-o', 'StrictHostKeyChecking=accept-new');
        mutated = true;
      }
      if (!hasSshOption(matchedArgs, SSH_BATCH_MODE_YES_RE)) {
        ctx.args.unshift('-o', 'BatchMode=yes');
        syncGitPayloadArgs(ctx);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.... (Frictionless Recovery)`);
        return;
      }
      if (mutated) syncGitPayloadArgs(ctx);
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args: matchedArgs }) => {
      if ((process.platform === 'win32' && ctx.payload.target !== 'wsl2') || cmd === 'ping.exe') {
        if (matchedArgs.some(a => WIN_PING_T_RE.test(a))) {
          for (let i = ctx.args.length - 1; i >= 0; i--) {
            if (WIN_PING_T_RE.test(ctx.args[i] ?? '')) ctx.args.splice(i, 1);
          }
          syncGitPayloadArgs(ctx);
          console.error(`\n   🛠️ AUTONOMOUS HEALING: 'ping -t' runs indefinitely. Stripped '-t' (Frictionless Recovery). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
        }
      } else {
        if (!matchedArgs.some(a => a === '-c' || UNIX_PING_C_RE.test(a))) {
          ctx.args.unshift('-c', '4');
          syncGitPayloadArgs(ctx);
          console.error(`\n   🛠️ AUTONOMOUS HEALING: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.... (Frictionless Recovery)`);
        }
      }
    })
    .with({ cmd: P.union('rm', 'rm.exe') }, () => { healRmCommand(ctx); })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args: matchedArgs }) => {
      if ((process.platform !== 'win32' || ctx.payload.target === 'wsl2') && !hasSudoNonInteractiveFlag(matchedArgs)) {
        ctx.args.unshift('-n');
        syncGitPayloadArgs(ctx);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.... (Frictionless Recovery)`);
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, ({ args: matchedArgs }) => {
      if (hasJournalctlFollowFlag(matchedArgs)) return;
      if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
        ctx.payload.target = 'wsl2';
        console.error(`\n   🛠️ AUTONOMOUS HEALING: 'journalctl' requires Linux systemd. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      }
      if (!matchedArgs.includes('--no-pager')) {
        ctx.args.unshift('--no-pager');
        syncGitPayloadArgs(ctx);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-pager' into ${cmdBasename} command to prevent pager hanging... (Frictionless Recovery)\x1b[0m`);
      }
    })
    .with({ cmd: P.union('git', 'git.exe') }, ({ args: matchedArgs }) => {
      healGitMutatingCommand(ctx, matchedArgs);
    })
    .with({ cmd: P.union('jq', 'jq.exe') }, ({ args: matchedArgs }) => {
      sanitizeJqInvocation(ctx, matchedArgs);
    })
    .otherwise(() => {});
}
