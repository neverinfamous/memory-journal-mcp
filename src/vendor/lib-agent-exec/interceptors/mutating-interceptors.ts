// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { match, P } from 'ts-pattern';
import { execFileSync } from 'node:child_process';
import { convertToWindowsPath } from '../command-utils.js';
import { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';
import { sanitizeJqInvocation } from './jq-sanitizer.js';
import {
  STALE_INDEX_LOCK_MS,
  findAlreadyStagedGitDeletions,
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
  '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);

interface ParsedGitInvocation {
  gitCwd: string;
  subcmdIndex: number;
  subcmd: string | undefined;
}

/**
 * [INTENT]: Resolve effective git working directory (honoring top-level `-C <dir>`) and locate the git subcommand
 * before `gitInterceptor` strips `-C`, preventing false matches on arguments like `git remote add`.
 */
function isPosixOrTildePath(p: string): boolean {
  return p.startsWith('/') || p === '~' || p.startsWith('~/');
}

function resolveMutatingGitDir(next: string, currentCwd: string): string {
  const normalized = /^\/mnt\/[a-zA-Z](?:\/|$)/.test(next) && process.platform === 'win32'
    ? convertToWindowsPath(next)
    : next;
  if ((normalized.startsWith('/') && !normalized.startsWith('/mnt/')) || normalized === '~' || normalized.startsWith('~/')) {
    return normalized;
  }
  if (isPosixOrTildePath(currentCwd)) {
    return currentCwd.startsWith('~') ? path.posix.join(currentCwd, normalized) : path.posix.resolve(currentCwd, normalized);
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(currentCwd, normalized);
}

function parseGitInvocation(ctx: ExecutionContext): ParsedGitInvocation {
  const rawPayloadCwd = ctx.payload.cwd;
  const convertedPayloadCwd = rawPayloadCwd !== undefined && rawPayloadCwd.length > 0 && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(rawPayloadCwd) && process.platform === 'win32'
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
      if (next !== undefined && !/^\d+$/.test(next)) gitCwd = resolveMutatingGitDir(next, gitCwd);
      i += 2;
    } else if (a.startsWith('-C') && a.length > 2) {
      const candidate = a.slice(2);
      if (!/^\d+$/.test(candidate)) gitCwd = resolveMutatingGitDir(candidate, gitCwd);
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

function hasSudoNonInteractiveFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-n' || a === '--non-interactive') return true;
    if (!a.startsWith('-')) break;
    if (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(a)) return true;
    if (SUDO_VALUE_FLAGS.has(a)) i += 1;
  }
  return false;
}

function healGitMutatingCommand(ctx: ExecutionContext, matchedArgs: readonly string[]): void {
  const { gitCwd, subcmdIndex, subcmd } = parseGitInvocation(ctx);
  const lockPath = path.join(gitCwd, '.git', 'index.lock');
  const lockStats = fs.statSync(lockPath, { throwIfNoEntry: false });
  if (lockStats !== undefined && Date.now() - lockStats.mtimeMs > STALE_INDEX_LOCK_MS) {
    try {
      fs.unlinkSync(lockPath);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected stale '.git/index.lock' (age: ${Math.round((Date.now() - lockStats.mtimeMs) / 1000)}s). Removing lock to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
    } catch { /* ignore stale lock race */ }
  }
  const hasLocalGitCwd = fs.statSync(gitCwd, { throwIfNoEntry: false })?.isDirectory() === true;
  if (subcmd === 'rm' && ctx.payload.target !== 'wsl2') healGitRmStagedDeletions(ctx, gitCwd, subcmdIndex);
  else if (subcmd === 'add') {
    const rewritten = ctx.payload.target !== 'wsl2' ? healGitAddStagedDeletions(ctx, gitCwd, subcmdIndex) : false;
    if (!rewritten && (ctx.payload.target !== 'wsl2' || hasLocalGitCwd)) healGitAddForceFlag(ctx, gitCwd, subcmdIndex);
    else if (!rewritten) validateNonHostWslAddPaths(gitCwd, ctx.args.slice(subcmdIndex + 1));
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

export function runMutatingInterceptors(
  ctx: ExecutionContext,
  derived: { cmd: string; cmdBasename: string; args: string[] }
) {
  const { cmd, cmdBasename, args } = derived;

  match({ cmd, args })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args: matchedArgs }) => {
      let mutated = false;
      if (!matchedArgs.some(a => a.includes('StrictHostKeyChecking='))) {
        ctx.args.unshift('-o', 'StrictHostKeyChecking=accept-new');
        mutated = true;
      }
      if (!matchedArgs.some(a => a.includes('BatchMode=yes'))) {
        ctx.args.unshift('-o', 'BatchMode=yes');
        syncGitPayloadArgs(ctx);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.... (Frictionless Recovery)`);
        return;
      }
      if (mutated) syncGitPayloadArgs(ctx);
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args: matchedArgs }) => {
      if ((process.platform === 'win32' && ctx.payload.target !== 'wsl2') || cmd === 'ping.exe') {
        if (matchedArgs.includes('-t')) {
          for (let i = ctx.args.length - 1; i >= 0; i--) {
            if (ctx.args[i] === '-t') ctx.args.splice(i, 1);
          }
          syncGitPayloadArgs(ctx);
          console.error(`\n   🛠️ AUTONOMOUS HEALING: 'ping -t' runs indefinitely. Stripped '-t' (Frictionless Recovery). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
        }
      } else {
        if (!matchedArgs.includes('-c')) {
          ctx.args.unshift('-c', '4');
          syncGitPayloadArgs(ctx);
          console.error(`\n   🛠️ AUTONOMOUS HEALING: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.... (Frictionless Recovery)`);
        }
      }
    })
    .with({ cmd: P.union('rm', 'rm.exe') }, ({ args: matchedArgs }) => {
      const hasForce = matchedArgs.some(a => a === '-f' || a === '--force' || /^-([a-zA-Z]*f[a-zA-Z]*)$/.test(a));
      if (!hasForce) {
        ctx.args.unshift('-f');
        syncGitPayloadArgs(ctx);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-f' into rm command to prevent interactive prompts and missing file errors.... (Frictionless Recovery)\x1b[0m`);
      }
    })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args: matchedArgs }) => {
      if ((process.platform !== 'win32' || ctx.payload.target === 'wsl2') && !hasSudoNonInteractiveFlag(matchedArgs)) {
        ctx.args.unshift('-n');
        syncGitPayloadArgs(ctx);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.... (Frictionless Recovery)`);
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, ({ args: matchedArgs }) => {
      const hasFollow = matchedArgs.some(a => a === '-f' || a === '--follow' || /^-[exqrkaobml]*f[exqrkaobml]*$/.test(a));
      if (hasFollow) return;
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
