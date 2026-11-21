// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { ExecutionContext } from './types.js';
import { getPkgNonFlagArgs } from './utils.js';

const LOCKFILE_DIR_FLAGS = new Set(['--dir', '-C', '--cwd', '--prefix']);
const LOCKFILE_DIR_EQ_RE = /^(?:--dir|--cwd|--prefix|-C)=(.+)$/;
const INTERACTIVE_STRIP_SUBCMDS = new Set([
  'update', 'up', 'upgrade', 'outdated', 'init',
  'add', 'install', 'i', 'remove', 'rm', 'uninstall',
]);
const STOP_STRIP_TOKENS = new Set(['--', 'exec', 'dlx', 'x', 'run']);

export function resolvePackageProjectDir(args: readonly string[], defaultDir: string): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    const eqMatch = a.match(LOCKFILE_DIR_EQ_RE);
    if (eqMatch?.[1] !== undefined) {
      return path.resolve(defaultDir, eqMatch[1]);
    }
    if (LOCKFILE_DIR_FLAGS.has(a) && i + 1 < args.length) {
      const nextVal = args[i + 1];
      if (nextVal !== undefined && nextVal.length > 0) {
        return path.resolve(defaultDir, nextVal);
      }
    }
  }
  return defaultDir;
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
  isNpm: boolean,
  isYarn: boolean,
): boolean {
  const subCmd = nonFlagArgs[0];
  if (isNpm) {
    if (subCmd === 'install' && nonFlagArgs.length === 1) return true;
    if (subCmd === 'install' && nonFlagArgs.length > 1) { args[args.indexOf('install')] = 'add'; return true; }
    if (subCmd === 'uninstall' && nonFlagArgs.length > 1) { args[args.indexOf('uninstall')] = 'remove'; return true; }
    if (subCmd !== undefined && ['run', 'test', 'start'].includes(subCmd)) return true;
    if (subCmd === 'ci') {
      args[args.indexOf('ci')] = 'install';
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

export function rewriteJsPackageManager(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  projectDir: string,
): { cmdBasename: string; isYarn: boolean; isPnpm: boolean } {
  const effectiveDir = resolvePackageProjectDir(args, projectDir);
  // [INVARIANT]: Detect both modern text lockfile ('bun.lock') and legacy binary lockfile ('bun.lockb').
  const isBunProject = fs.existsSync(path.join(effectiveDir, 'bun.lock')) || fs.existsSync(path.join(effectiveDir, 'bun.lockb'));
  const isNpm = cmdBasename.startsWith('npm');
  const isYarn = cmdBasename.startsWith('yarn');
  const isPnpm = cmdBasename.startsWith('pnpm');

  let nextCmd = cmdBasename;
  const nonFlagArgs = getPkgNonFlagArgs(args);
  const subCmd = nonFlagArgs[0];

  if (!isBunProject && (isNpm || isYarn)) {
    if (applyNpmOrYarnToPnpm(args, nonFlagArgs, isNpm, isYarn)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting '${`${cmdBasename} ${subCmd ?? ''}`.trim()}' to pnpm... (Frictionless Recovery)`);
      nextCmd = platformPmBinary('pnpm', ctx.payload.target);
      ctx.cmdBasename = nextCmd;
      if ('command' in ctx.payload) ctx.payload.command = nextCmd;
    }
  } else if (isBunProject && (isNpm || isYarn || isPnpm)) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Bun project detected. Transparently rewriting '${`${cmdBasename} ${subCmd ?? ''}`.trim()}' to bun... (Frictionless Recovery)`);
    if (isNpm && subCmd === 'uninstall') args[args.indexOf('uninstall')] = 'remove';
    if (isNpm && subCmd === 'ci') {
      args[args.indexOf('ci')] = 'install';
      if (!args.includes('--frozen-lockfile')) args.push('--frozen-lockfile');
    }
    if (isYarn && !subCmd && args.length === 0) args.push('install');
    nextCmd = platformPmBinary('bun', ctx.payload.target);
    ctx.cmdBasename = nextCmd;
    if ('command' in ctx.payload) ctx.payload.command = nextCmd;
  }

  return { cmdBasename: nextCmd, isYarn, isPnpm };
}

export function stripScopedInteractiveFlags(
  args: string[],
  cmdBasename: string,
  isYarnOrPnpm: boolean,
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

  console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripping interactive flag from ${cmdBasename} command... (Frictionless Recovery)`);
  for (let i = stopIdx - 1; i >= 0; i--) {
    if (args[i] === '--interactive' || (isYarnOrPnpm && args[i] === '-i')) {
      args.splice(i, 1);
    }
  }
}
