// @ts-nocheck
import path from 'node:path';
import { convertToWindowsPath, convertToWslPath } from '../command-utils.js';
import { type ExecutionContext } from './types.js';
import { applyEarlyGitGuards, applyEditorGitHeals, applyInteractiveGitBlocks } from './git-guards.js';
import { syncGitPayloadArgs } from './git-add-guards.js';

const GIT_VALUE_FLAGS = new Set([
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
  '--super-prefix',
]);

const GIT_SUBCMD_VALUE_FLAGS = new Set([
  '-m', '--message', '-S', '-G', '-F', '--file', '--grep', '--author', '--date',
  '--format', '--pretty', '-n', '--max-count', '-c', '--config', '-b', '-B',
  '-C', '--reuse-message', '--reedit-message', '--fixup', '--squash',
  '-t', '--template', '--cleanup', '--trailer', '--pathspec-from-file',
]);

const GIT_TOP_LONG_VALUE_FLAGS: readonly string[] = [...GIT_VALUE_FLAGS].filter((f) => f.startsWith('--'));
const GIT_SUBCMD_LONG_VALUE_FLAGS: readonly string[] = [...GIT_SUBCMD_VALUE_FLAGS].filter((f) => f.startsWith('--'));

function isLongValueFlagPrefix(arg: string, longFlags: readonly string[]): boolean {
  if (!arg.startsWith('--') || arg.includes('=') || arg.length < 3) return false;
  return longFlags.some((flag) => flag.startsWith(arg));
}

const SUBCMD_SHORT_VALUE_CLUSTER_RE = /^-[a-zA-Z]*[mFCct]$/;
const DANGEROUS_GIT_CONFIG_RE = /^(?:alias\.|core\.hookspath$|core\.fsmonitor$|core\.sshcommand$|core\.gitproxy$|core\.alternaterefscommand$|core\.askpass$|core\.editor$|sequence\.editor$|credential\.(?:.+\.)?helper$|core\.pager$|pager\.|diff\.external$|diff\..+\.(?:command|textconv)$|merge\..+\.driver$|uploadpack\.|remote\..+\.(?:uploadpack|receivepack)$|protocol\.ext\.allow$|include\.path$|includeif\..+\.path$|filter\..+\.(?:clean|smudge|process)$|gpg\.(?:.+\.)?program$)/i;

function stripWrappingQuotes(token: string): string {
  return (token.startsWith('"') && token.endsWith('"') && token.length >= 2) || (token.startsWith("'") && token.endsWith("'") && token.length >= 2)
    ? token.slice(1, -1)
    : token;
}

function assertNoDangerousGitConfig(args: readonly string[]): void {
  for (let i = 0; i < args.length; i++) {
    const rawTok = args[i];
    if (rawTok === undefined) continue;
    const a = stripWrappingQuotes(rawTok);
    if (a === '--') break;
    let configVal: string | undefined;
    if (a === '-c' || a === '--config-env') {
      configVal = args[i + 1];
      i += 1;
    } else if (a.startsWith('-c') && a.length > 2) {
      configVal = a.slice(2);
    } else if (a.startsWith('--config-env=')) {
      configVal = a.slice('--config-env='.length);
    } else if (a === '-C' || GIT_VALUE_FLAGS.has(a)) {
      i += 1;
      continue;
    } else if (!a.startsWith('-')) {
      break;
    }
    if (configVal !== undefined) {
      const strippedVal = stripWrappingQuotes(configVal);
      const eqIdx = strippedVal.indexOf('=');
      const rawKey = stripWrappingQuotes((eqIdx === -1 ? strippedVal : strippedVal.slice(0, eqIdx)).trim());
      if (DANGEROUS_GIT_CONFIG_RE.test(rawKey)) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Blocked unsafe inline git config '-c ${rawKey}' (cannot override aliases, hooks, fsmonitor, sshCommand, or credential helpers).`);
        process.exit(1);
      }
    }
  }
}

function resolveGitCDir(nextPath: string, currentCwd: string, usePosix: boolean): string {
  if (nextPath === '~' || nextPath.startsWith('~/')) return nextPath;
  const hostPath = !usePosix && process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(nextPath)
    ? convertToWindowsPath(nextPath)
    : (usePosix && path.win32.isAbsolute(nextPath) ? convertToWslPath(nextPath) : (usePosix ? nextPath.replace(/\\/g, '/') : nextPath));
  if (currentCwd === '~' || currentCwd.startsWith('~/')) {
    return hostPath.startsWith('/') ? hostPath : path.posix.join(currentCwd, hostPath);
  }
  const resolvedCurrent = usePosix && path.win32.isAbsolute(currentCwd)
    ? convertToWslPath(currentCwd)
    : currentCwd;
  const baseImpl = usePosix || resolvedCurrent.startsWith('/') ? path.posix : path;
  const nextImpl = hostPath.startsWith('/') ? path.posix : baseImpl;
  return nextImpl.isAbsolute(hostPath) ? hostPath : baseImpl.resolve(resolvedCurrent, hostPath);
}

function applyGitCFlags(args: string[], initialCwd: string, usePosix: boolean): { targetCwd: string; explicitCwd: string | undefined } {
  let targetCwd = initialCwd;
  let explicitCwd: string | undefined;
  // -C <path> is a top-level git flag and MUST appear before the git subcommand
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-C') {
      const nextPath = args[i + 1];
      if (nextPath !== undefined && nextPath.length > 0) {
        targetCwd = resolveGitCDir(nextPath, targetCwd, usePosix);
        explicitCwd = targetCwd;
        args.splice(i, 2);
        continue;
      }
      i += nextPath !== undefined ? 2 : 1;
    } else if (a.startsWith('-C') && a.length > 2) {
      const candidate = a.slice(2);
      if (candidate.length > 0) {
        targetCwd = resolveGitCDir(candidate, targetCwd, usePosix);
        explicitCwd = targetCwd;
        args.splice(i, 1);
        continue;
      }
      i++;
    } else if (GIT_VALUE_FLAGS.has(a)) {
      i += 2;
    } else if (a.startsWith('-')) {
      i++;
    } else {
      break;
    }
  }
  return { targetCwd, explicitCwd };
}

function hasGitHelpFlag(args: readonly string[]): boolean {
  let seenSubcmd = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--help' || (!seenSubcmd && a === '-h')) return true;
    if (
      (!seenSubcmd && (a === '-C' || GIT_VALUE_FLAGS.has(a) || isLongValueFlagPrefix(a, GIT_TOP_LONG_VALUE_FLAGS))) ||
      (seenSubcmd && (GIT_SUBCMD_VALUE_FLAGS.has(a) || SUBCMD_SHORT_VALUE_CLUSTER_RE.test(a) || isLongValueFlagPrefix(a, GIT_SUBCMD_LONG_VALUE_FLAGS)))
    ) {
      i++;
      continue;
    }
    if (!a.startsWith('-')) seenSubcmd = true;
  }
  return false;
}

function findGitSubcommand(args: readonly string[]): string | undefined {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === undefined) break;
    if (a === '--') {
      i++;
      return i < args.length ? args[i] : undefined;
    }
    if (a === '-C' || GIT_VALUE_FLAGS.has(a)) {
      i += 2;
      continue;
    }
    if (a.startsWith('-')) {
      i++;
      continue;
    }
    return a;
  }
  return undefined;
}

function hasGlobalGitFlag(args: readonly string[], targetFlag: string): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === targetFlag) return true;
    if (a === '-C' || GIT_VALUE_FLAGS.has(a)) { i++; continue; }
    if (!a.startsWith('-')) break;
  }
  return false;
}

export function gitInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const cmdLower = cmdBasename.toLowerCase();
  if ((cmdLower !== 'git' && cmdLower !== 'git.exe') || payload.type !== 'command') return;
  assertNoDangerousGitConfig(args);
  if (hasGitHelpFlag(args)) return;

  const isPosixWslCwd = payload.target === 'wsl2'
    && typeof ctx.payload.cwd === 'string'
    && (ctx.payload.cwd.startsWith('/') || ctx.payload.cwd.startsWith('~'));
  const fallbackCwd = typeof ctx.cwd === 'string' && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd();
  const rawCwd = isPosixWslCwd && ctx.payload.cwd !== undefined
    ? ctx.payload.cwd
    : (ctx.payload.cwd ? path.resolve(ctx.payload.cwd) : fallbackCwd);
  const { targetCwd, explicitCwd } = applyGitCFlags(args, rawCwd, payload.target === 'wsl2');

  if (explicitCwd !== undefined) {
    ctx.payload.cwd = targetCwd;
  }

  if (!hasGlobalGitFlag(args, '--no-pager')) {
    args.unshift('--no-pager');
    syncGitPayloadArgs(ctx);
  } else if (explicitCwd !== undefined) {
    syncGitPayloadArgs(ctx);
  }
  const gitSubCmd = findGitSubcommand(args);
  const scope = { cmd: gitSubCmd, args, ctx, targetCwd, rawCwd, explicitCwd };
  if (applyEarlyGitGuards(scope)) return;
  if (applyInteractiveGitBlocks(scope)) return;
  applyEditorGitHeals(scope);
}

