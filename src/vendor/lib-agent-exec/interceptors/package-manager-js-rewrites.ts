// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { type ExecutionContext } from './types.js';
import { findFirstPkgSubcmdIndex, getPkgNonFlagArgs } from './utils.js';

const LOCKFILE_DIR_FLAGS = new Set(['--dir', '-C', '--cwd', '--prefix']);
const NON_DIR_PKG_VALUE_FLAGS = new Set([
  '--filter', '-F', '--config', '-c',
  '--registry', '--userconfig', '--globalconfig', '--cache', '--store-dir',
  '--loglevel', '--reporter', '--mutex', '--network-timeout', '-w', '--workspace',
]);
const LOCKFILE_DIR_EQ_RE = /^(?:--dir|--cwd|--prefix|-C)=(.+)$/;
const INTERACTIVE_STRIP_SUBCMDS = new Set([
  'update', 'up', 'upgrade', 'outdated', 'init',
  'add', 'install', 'i', 'remove', 'rm', 'uninstall',
]);
const STOP_STRIP_TOKENS = new Set(['--', 'exec', 'dlx', 'x', 'run']);

function resolveTargetProjectDir(baseDir: string, nextDir: string): string {
  if (nextDir === '~' || nextDir.startsWith('~/') || nextDir.startsWith('/')) return nextDir;
  if (baseDir === '~' || baseDir.startsWith('~/')) return path.posix.join(baseDir, nextDir);
  if (baseDir.startsWith('/')) return path.posix.resolve(baseDir, nextDir);
  return path.resolve(baseDir, nextDir);
}

export function resolvePackageProjectDir(args: readonly string[], defaultDir: string): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    const eqMatch = a.match(LOCKFILE_DIR_EQ_RE);
    if (eqMatch?.[1] !== undefined) {
      return resolveTargetProjectDir(defaultDir, eqMatch[1]);
    }
    if (LOCKFILE_DIR_FLAGS.has(a) && i + 1 < args.length) {
      const nextVal = args[i + 1];
      if (nextVal !== undefined && nextVal.length > 0) {
        return resolveTargetProjectDir(defaultDir, nextVal);
      }
      i++;
      continue;
    }
    if (NON_DIR_PKG_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (!a.startsWith('-')) break;
  }
  return defaultDir;
}

function pushFlagBeforeDash(args: string[], flag: string): void {
  const ddIdx = args.indexOf('--');
  if (ddIdx !== -1) args.splice(ddIdx, 0, flag);
  else args.push(flag);
}

function hasFlagBeforeDash(args: readonly string[], flag: string): boolean {
  const ddIdx = args.indexOf('--');
  const slice = ddIdx === -1 ? args : args.slice(0, ddIdx);
  return slice.includes(flag);
}

function translateToBunArgs(args: string[], subCmd: string | undefined, isNpm: boolean, isYarn: boolean): void {
  const firstPosIdx = findFirstPkgSubcmdIndex(args);
  const flagScanLimit = firstPosIdx === -1 ? args.length : firstPosIdx;
  for (let i = 0; i < flagScanLimit; i++) {
    const a = args[i];
    if (a === '--dir' || a === '--prefix' || a === '-C') args[i] = '--cwd';
    else if (a?.startsWith('--dir=')) args[i] = `--cwd=${a.slice('--dir='.length)}`;
    else if (a?.startsWith('--prefix=')) args[i] = `--cwd=${a.slice('--prefix='.length)}`;
    else if (a?.startsWith('-C=')) args[i] = `--cwd=${a.slice('-C='.length)}`;
  }
  if (subCmd === 'dlx' && firstPosIdx !== -1) args[firstPosIdx] = 'x';
  else if (subCmd === 'exec' && firstPosIdx !== -1) args[firstPosIdx] = 'run';
  if (isNpm && subCmd === 'uninstall' && firstPosIdx !== -1) args[firstPosIdx] = 'remove';
  if (isNpm && subCmd === 'ci' && firstPosIdx !== -1) {
    args[firstPosIdx] = 'install';
    if (!hasFlagBeforeDash(args, '--frozen-lockfile')) pushFlagBeforeDash(args, '--frozen-lockfile');
  }
  if (isYarn && !subCmd && args.length === 0) args.push('install');
}

function platformPmBinary(base: 'pnpm' | 'bun', target: ExecutionContext['payload']['target']): string {
  if (process.platform === 'win32' && target !== 'wsl2') {
    return base === 'bun' ? 'bun.exe' : 'pnpm.cmd';
  }
  return base;
}

function normalizeCwdFlagForPnpm(args: string[]): void {
  const firstPosIdx = findFirstPkgSubcmdIndex(args);
  const scanLimit = firstPosIdx === -1 ? args.length : firstPosIdx;
  for (let i = 0; i < scanLimit; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--cwd') args[i] = '--dir';
    else if (a.startsWith('--cwd=')) args[i] = `--dir=${a.slice('--cwd='.length)}`;
  }
}

function applyNpmOrYarnToPnpm(
  args: string[],
  nonFlagArgs: readonly string[],
  firstPosIdx: number,
  isNpm: boolean,
  isYarn: boolean,
): boolean {
  const subCmd = nonFlagArgs[0];
  let converted = false;
  if (isNpm) {
    if (subCmd === 'install' && nonFlagArgs.length === 1) converted = true;
    else if (subCmd === 'install' && nonFlagArgs.length > 1 && firstPosIdx !== -1) { args[firstPosIdx] = 'add'; converted = true; }
    else if (subCmd === 'uninstall' && nonFlagArgs.length > 1 && firstPosIdx !== -1) { args[firstPosIdx] = 'remove'; converted = true; }
    else if (subCmd !== undefined && ['run', 'test', 'start'].includes(subCmd)) converted = true;
    else if (subCmd === 'ci' && firstPosIdx !== -1) {
      args[firstPosIdx] = 'install';
      if (!hasFlagBeforeDash(args, '--frozen-lockfile')) pushFlagBeforeDash(args, '--frozen-lockfile');
      converted = true;
    }
  } else if (isYarn) {
    if (!subCmd && args.length === 0) { args.push('install'); converted = true; }
    else if (subCmd !== undefined && ['add', 'remove'].includes(subCmd) && nonFlagArgs.length > 1) converted = true;
  }
  if (converted) normalizeCwdFlagForPnpm(args);
  return converted;
}

function toHostFsPath(p: string): string {
  return process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(p) ? convertToWindowsPath(p) : p;
}

export function rewriteJsPackageManager(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  projectDir: string,
): { cmdBasename: string; isYarn: boolean; isPnpm: boolean } {
  const effectiveDir = resolvePackageProjectDir(args, projectDir);
  const hostEffectiveDir = toHostFsPath(effectiveDir);
  // [INVARIANT]: Detect both modern text lockfile ('bun.lock') and legacy binary lockfile ('bun.lockb').
  const isBunProject = fs.existsSync(path.join(hostEffectiveDir, 'bun.lock')) || fs.existsSync(path.join(hostEffectiveDir, 'bun.lockb'));
  const isNpm = cmdBasename.startsWith('npm');
  const isYarn = cmdBasename.startsWith('yarn');
  const isPnpm = cmdBasename.startsWith('pnpm');

  let nextCmd = cmdBasename;
  const nonFlagArgs = getPkgNonFlagArgs(args);
  const firstPosIdx = findFirstPkgSubcmdIndex(args);
  const subCmd = nonFlagArgs[0];

  if (!isBunProject && (isNpm || isYarn)) {
    if (applyNpmOrYarnToPnpm(args, nonFlagArgs, firstPosIdx, isNpm, isYarn)) {
      nextCmd = platformPmBinary('pnpm', ctx.payload.target);
      ctx.cmdBasename = nextCmd;
      if ('command' in ctx.payload) {
        ctx.payload.command = nextCmd;
        ctx.payload.args = args;
      }
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting '${`${cmdBasename} ${subCmd ?? ''}`.trim()}' to pnpm... (Frictionless Recovery)`);
    }
  } else if (isBunProject && (isNpm || isYarn || isPnpm)) {
    translateToBunArgs(args, subCmd, isNpm, isYarn);
    nextCmd = platformPmBinary('bun', ctx.payload.target);
    ctx.cmdBasename = nextCmd;
    if ('command' in ctx.payload) {
      ctx.payload.command = nextCmd;
      ctx.payload.args = args;
    }
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Bun project detected. Transparently rewriting '${`${cmdBasename} ${subCmd ?? ''}`.trim()}' to bun... (Frictionless Recovery)`);
  }

  return { cmdBasename: nextCmd, isYarn, isPnpm };
}

const PKG_SHORT_VALUE_CHARS = new Set(['C', 'F', 'c', 'w']);

function stripInteractiveArg(arg: string, isYarnOrPnpm: boolean): string | null {
  if (arg === '--interactive') return null;
  if (arg.startsWith('--interactive=')) {
    const lowVal = arg.slice('--interactive='.length).toLowerCase();
    return lowVal !== 'false' && lowVal !== '0' ? null : arg;
  }
  if (!isYarnOrPnpm || arg.startsWith('--') || !arg.startsWith('-')) return arg;
  if (arg === '-i') return null;
  if (!/^-[a-zA-Z]*i[a-zA-Z]*$/.test(arg)) return arg;
  let kept = '';
  for (let i = 1; i < arg.length; i++) {
    const ch = arg[i] ?? '';
    if (PKG_SHORT_VALUE_CHARS.has(ch)) {
      kept += arg.slice(i);
      break;
    }
    if (ch !== 'i') kept += ch;
  }
  return kept.length > 0 ? `-${kept}` : null;
}

export function stripScopedInteractiveFlags(
  args: string[],
  cmdBasename: string,
  isYarnOrPnpm: boolean,
  ctx?: ExecutionContext,
): void {
  const nonFlagArgs = getPkgNonFlagArgs(args);
  const subCmd = nonFlagArgs[0]?.toLowerCase() ?? '';
  if (!INTERACTIVE_STRIP_SUBCMDS.has(subCmd)) return;

  let stopIdx = args.length;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]?.toLowerCase();
    if (a !== undefined && STOP_STRIP_TOKENS.has(a)) {
      stopIdx = i;
      break;
    }
  }

  let changed = false;
  const rewritten: string[] = [];
  for (let i = 0; i < stopIdx; i++) {
    const orig = args[i] ?? '';
    const next = stripInteractiveArg(orig, isYarnOrPnpm);
    if (next !== orig) changed = true;
    if (next !== null) rewritten.push(next);
  }
  if (!changed) return;

  args.splice(0, stopIdx, ...rewritten);
  if (ctx?.payload.type === 'command') ctx.payload.args = args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripping interactive flag from ${cmdBasename} command... (Frictionless Recovery)`);
}
