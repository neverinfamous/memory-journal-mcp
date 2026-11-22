// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { ExecutionContext } from './types.js';
import { findFirstPkgSubcmdIndex, getPkgNonFlagArgs } from './utils.js';

const LOCKFILE_DIR_FLAGS = new Set(['--dir', '-C', '--cwd', '--prefix']);
const NON_DIR_PKG_VALUE_FLAGS = new Set(['--filter', '-F', '--config', '-c']);
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
    if (!args.includes('--frozen-lockfile')) args.push('--frozen-lockfile');
  }
  if (isYarn && !subCmd && args.length === 0) args.push('install');
}

function platformPmBinary(base: 'pnpm' | 'bun', target: ExecutionContext['payload']['target']): string {
  if (process.platform === 'win32' && target !== 'wsl2') {
    return base === 'bun' ? 'bun.exe' : 'pnpm.cmd';
  }
  return base;
}

function applyNpmOrYarnToPnpm(
  args: string[],
  nonFlagArgs: readonly string[],
  firstPosIdx: number,
  isNpm: boolean,
  isYarn: boolean,
): boolean {
  const subCmd = nonFlagArgs[0];
  if (isNpm) {
    if (subCmd === 'install' && nonFlagArgs.length === 1) return true;
    if (subCmd === 'install' && nonFlagArgs.length > 1 && firstPosIdx !== -1) { args[firstPosIdx] = 'add'; return true; }
    if (subCmd === 'uninstall' && nonFlagArgs.length > 1 && firstPosIdx !== -1) { args[firstPosIdx] = 'remove'; return true; }
    if (subCmd !== undefined && ['run', 'test', 'start'].includes(subCmd)) return true;
    if (subCmd === 'ci' && firstPosIdx !== -1) {
      args[firstPosIdx] = 'install';
      if (!args.includes('--frozen-lockfile')) args.push('--frozen-lockfile');
      return true;
    }
    return false;
  }
  if (isYarn) {
    if (!subCmd && args.length === 0) { args.push('install'); return true; }
    if (subCmd !== undefined && ['add', 'remove'].includes(subCmd) && nonFlagArgs.length > 1) return true;
  }
  return false;
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

  const hasFlagToStrip = args.slice(0, stopIdx).some(
    a => a === '--interactive' || (isYarnOrPnpm && a === '-i')
  );
  if (!hasFlagToStrip) return;

  for (let i = stopIdx - 1; i >= 0; i--) {
    if (args[i] === '--interactive' || (isYarnOrPnpm && args[i] === '-i')) {
      args.splice(i, 1);
    }
  }
  if (ctx?.payload.type === 'command') ctx.payload.args = args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripping interactive flag from ${cmdBasename} command... (Frictionless Recovery)`);
}
