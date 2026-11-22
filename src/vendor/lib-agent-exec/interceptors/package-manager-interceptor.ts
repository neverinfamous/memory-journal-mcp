// @ts-nocheck
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext } from './types.js';
import { findFirstPkgSubcmdIndex, getPkgNonFlagArgs } from './utils.js';
import { resolvePackageProjectDir, rewriteJsPackageManager, stripScopedInteractiveFlags } from './package-manager-js-rewrites.js';
import { applyPackageManagerTimeouts } from './package-manager-timeouts.js';
import {
  healMissingAgentScriptArgs,
  rewriteToolBinary,
  rewriteTsxInvocation,
  splitJoinedTestTargetArgs,
  translateNativeOrDlxTool,
  tryAccelerateCommitForPm,
} from './package-manager-tool-rewrites.js';

const ALL_JS_PM_CMDS = new Set([
  'npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe',
  'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.cmd', 'bun.exe',
  'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe',
  'bunx', 'bunx.cmd', 'bunx.exe',
]);
const CORE_JS_PM_CMDS = new Set([
  'npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe',
  'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.cmd', 'bun.exe',
]);
const RUNNER_CMDS = new Set([
  'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe',
  'bunx', 'bunx.cmd', 'bunx.exe',
]);

function syncPmPayloadArgs(ctx: ExecutionContext, args: string[]): void {
  if ('command' in ctx.payload) ctx.payload.args = args;
}

function applySystemPackageFlags(ctx: ExecutionContext, cmdBasename: string, args: string[], envOverrides: Record<string, string>): void {
  if (['apt', 'apt-get'].includes(cmdBasename)) {
    envOverrides['DEBIAN_FRONTEND'] = 'noninteractive';
    if (!args.includes('-y') && !args.includes('--yes')) {
      args.unshift('-y');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into apt/apt-get command to prevent prompt hanging.... (Frictionless Recovery)`);
    }
    return;
  }
  if (cmdBasename === 'apk' && (args.includes('add') || args.includes('del')) && !args.includes('--no-interactive')) {
    args.push('--no-interactive');
    syncPmPayloadArgs(ctx, args);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-interactive' into apk command.... (Frictionless Recovery)`);
    return;
  }
  if (['pacman', 'pacman.exe'].includes(cmdBasename) && !args.includes('--noconfirm')) {
    args.push('--noconfirm');
    syncPmPayloadArgs(ctx, args);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--noconfirm' into pacman command.... (Frictionless Recovery)`);
    return;
  }
  if (['yum', 'dnf'].includes(cmdBasename) && !args.includes('-y')) {
    args.push('-y');
    syncPmPayloadArgs(ctx, args);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command.... (Frictionless Recovery)`);
    return;
  }
  if (['conda', 'conda.exe', 'mamba', 'mamba.exe'].includes(cmdBasename) && !args.includes('-y') && !args.includes('--yes')) {
    const subCmd = getPkgNonFlagArgs(args)[0];
    if (subCmd && ['install', 'create', 'update', 'upgrade', 'remove', 'uninstall'].includes(subCmd)) {
      args.push('-y');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
    }
    return;
  }
  const mIndex = args.indexOf('-m');
  const isPythonPip = ['python', 'python.exe', 'python3', 'python3.exe'].includes(cmdBasename) && mIndex !== -1 && args[mIndex + 1] === 'pip';
  if (['pip', 'pip3', 'pip.exe', 'pip3.exe'].includes(cmdBasename) || isPythonPip) {
    const pipArgs = isPythonPip ? args.slice(mIndex + 2) : args;
    const subCmd = pipArgs.filter(a => !a.startsWith('-'))[0];
    if (subCmd === 'uninstall' && !pipArgs.includes('-y') && !pipArgs.includes('--yes')) {
      args.push('-y');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into pip uninstall to prevent prompt hanging.... (Frictionless Recovery)`);
    }
  }
}

const BUN_TEST_VALUE_FLAGS = new Set(['-t', '--test-name-pattern', '--timeout', '--rerun-each', '--bail', '--max-concurrency', '--preload', '-r']);

function normalizeBunTestDotSlashPaths(ctx: ExecutionContext, cmdBasename: string, args: string[]): void {
  if (!cmdBasename.startsWith('bun')) return;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (BUN_TEST_VALUE_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    if (/^\.[a-zA-Z0-9_].*[/\\]/.test(arg)) {
      args[i] = `./${arg.replace(/\\/g, '/')}`;
    }
  }
  if ('command' in ctx.payload) ctx.payload.args = args;
}

function handleCoreJsPm(ctx: ExecutionContext, rawCmd: string, args: string[], projectDir: string): void {
  const { cmdBasename, isYarn, isPnpm } = rewriteJsPackageManager(ctx, rawCmd, args, projectDir);
  ctx.envOverrides['CI'] = '1';
  ctx.envOverrides['PNPM_INTERACTIVE'] = 'false';

  const isYarnOrPnpm = isYarn || isPnpm || cmdBasename.includes('yarn') || cmdBasename.includes('pnpm');
  stripScopedInteractiveFlags(args, cmdBasename, isYarnOrPnpm, ctx);

  const nonFlagArgs = getPkgNonFlagArgs(args);
  const subCmd = nonFlagArgs[0];
  if (translateNativeOrDlxTool(ctx, cmdBasename, args, subCmd)) return;

  if (subCmd === 'upgrade-interactive') {
    console.error(`\n   💡 AGENT HINT: 'yarn upgrade-interactive' is a TUI tool and will hang. Use 'yarn upgrade' instead.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (
    subCmd !== undefined &&
    !cmdBasename.startsWith('pnpm') &&
    ['init', 'create'].includes(subCmd) &&
    !args.includes('-y') &&
    !args.includes('--yes')
  ) {
    args.push('-y');
    syncPmPayloadArgs(ctx, args);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
  }
  if (subCmd !== undefined && ['install', 'add', 'update', 'upgrade'].includes(subCmd) && cmdBasename.startsWith('npm')) {
    if (!args.includes('--no-fund')) args.push('--no-fund');
    if (!args.includes('--no-audit')) args.push('--no-audit');
  }
  if (args.some(a => path.basename(a).toLowerCase() === 'agent-exec.ts')) return;

  const isTestSubCmd = (subCmd && /^(?:vitest|jest|pytest|playwright|cypress|test(?::.*|-.*)?|coverage(?::.*)?)$/i.test(subCmd)) ||
    args.some(a => /^(?:vitest|jest|pytest|playwright|cypress)$/i.test(a));
  if (isTestSubCmd) {
    splitJoinedTestTargetArgs(ctx, args);
    normalizeBunTestDotSlashPaths(ctx, cmdBasename, args);
  }

  const tsxBin = (subCmd === 'tsx' || subCmd === 'ts-node')
    ? subCmd
    : ((subCmd === 'exec' || subCmd === 'run') && (nonFlagArgs[1] === 'tsx' || nonFlagArgs[1] === 'ts-node') ? nonFlagArgs[1] : undefined);
  if (tsxBin !== undefined) {
    const firstSubIdx = findFirstPkgSubcmdIndex(args);
    const tsxIdx = firstSubIdx === -1 ? -1 : (args[firstSubIdx] === tsxBin ? firstSubIdx : args.indexOf(tsxBin, firstSubIdx + 1));
    if (tsxIdx !== -1) rewriteTsxInvocation(ctx, tsxBin, args, tsxIdx + 1, toHostFsPathIfWin32(resolvePackageProjectDir(args, projectDir)));
  }

  const subCmdLower = subCmd !== undefined ? subCmd.toLowerCase() : (isYarn ? 'install' : '');
  const isPackageResolution = ['install', 'i', 'ci', 'add', 'update', 'up', 'dedupe'].includes(subCmdLower);
  const targetScript = (subCmd === 'run' || subCmd === 'exec') ? nonFlagArgs[1] : subCmd;
  applyPackageManagerTimeouts(ctx, cmdBasename, args, isPackageResolution, targetScript);

  if (subCmd !== undefined && ['login', 'adduser', 'publish'].includes(subCmd)) {
    const hasPublishToken = Boolean(
      ctx.payload.env?.['NPM_TOKEN'] ||
      ctx.payload.env?.['NODE_AUTH_TOKEN'] ||
      process.env['NPM_TOKEN'] ||
      process.env['NODE_AUTH_TOKEN']
    );
    if (!(subCmd === 'publish' && hasPublishToken)) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} ${subCmd}' may be highly interactive (e.g., OTP prompts, auth) and will hang. Please configure token-based authentication non-interactively.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }
}

const RUNNER_VALUE_FLAGS = new Set(['-p', '--package', '-c', '--call', '--userconfig', '--cwd']);
const PNPM_COMPAT_VALUE_PREFIX_FLAGS = new Set(['--dir', '-C', '--cwd', '--prefix', '--filter', '-F']);
const PM_HELP_VALUE_FLAGS = new Set([...RUNNER_VALUE_FLAGS, ...PNPM_COMPAT_VALUE_PREFIX_FLAGS, '--config']);

const NON_HELP_PASSTHROUGH_SUBCMDS = new Set(['exec', 'dlx', 'x', 'run', 'tsx', 'ts-node']);

function hasPackageManagerHelpFlag(args: readonly string[], cmdBasename: string): boolean {
  let subCmd: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (PM_HELP_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a === '-h') return subCmd === undefined;
    if (a === '--help') {
      return subCmd === undefined || (!RUNNER_CMDS.has(cmdBasename) && !NON_HELP_PASSTHROUGH_SUBCMDS.has(subCmd));
    }
    if (a.startsWith('-')) continue;
    if (subCmd === undefined) {
      subCmd = a;
      if (RUNNER_CMDS.has(cmdBasename) || NON_HELP_PASSTHROUGH_SUBCMDS.has(subCmd)) break;
      continue;
    }
    break;
  }
  return false;
}

function collectPnpmCompatPrefixFlags(args: readonly string[], limitIdx: number): string[] {
  const compat: string[] = [];
  for (let i = 0; i < limitIdx; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (PNPM_COMPAT_VALUE_PREFIX_FLAGS.has(a)) {
      if (i + 1 < limitIdx) {
        const nextVal = args[i + 1];
        if (nextVal !== undefined) compat.push(a, nextVal);
        i++;
      }
      continue;
    }
    if (/^(?:--dir|-C|--cwd|--prefix|--filter)=/.test(a)) {
      compat.push(a);
      continue;
    }
    if (RUNNER_VALUE_FLAGS.has(a)) { i++; }
  }
  return compat;
}

function toHostFsPathIfWin32(p: string): string {
  return process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(p) ? convertToWindowsPath(p) : p;
}

function findRunnerTargetIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (PM_HELP_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    return i;
  }
  return -1;
}

function handleRunnerPm(ctx: ExecutionContext, cmdBasename: string, args: string[], projectDir: string): void {
  const firstNonFlagIdx = findRunnerTargetIndex(args);
  const runnerTarget = firstNonFlagIdx !== -1 ? args[firstNonFlagIdx] : undefined;
  if (runnerTarget === 'rg' || runnerTarget === 'ripgrep' || runnerTarget === 'fd' || runnerTarget === 'fdfind') {
    rewriteToolBinary(ctx, cmdBasename, args, runnerTarget, firstNonFlagIdx);
    return;
  }
  if (cmdBasename.startsWith('npx') && runnerTarget === 'tsx') {
    const prefixFlags = collectPnpmCompatPrefixFlags(args, firstNonFlagIdx);
    ctx.cmdBasename = process.platform === 'win32' && ctx.payload.target !== 'wsl2' ? 'pnpm.cmd' : 'pnpm';
    args.splice(0, firstNonFlagIdx, ...prefixFlags, 'exec');
    if ('command' in ctx.payload) {
      ctx.payload.command = ctx.cmdBasename;
      ctx.payload.args = args;
    }
    ctx.envOverrides['CI'] = '1';
    const tsxStartIdx = prefixFlags.length + 2;
    rewriteTsxInvocation(ctx, 'tsx', args, tsxStartIdx, toHostFsPathIfWin32(resolvePackageProjectDir(args, projectDir)));
    applyPackageManagerTimeouts(ctx, ctx.cmdBasename, args, false, 'tsx');
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'npx tsx' to 'pnpm exec tsx' to prevent interactive installation prompts... (Frictionless Recovery)\x1b[0m`);
    return;
  }
  ctx.envOverrides['CI'] = '1';
  if (args.some(a => /^(?:vitest|jest|pytest|playwright|cypress)$/i.test(a))) {
    splitJoinedTestTargetArgs(ctx, args);
  }
  applyPackageManagerTimeouts(ctx, cmdBasename, args, false, undefined);
  if (cmdBasename.startsWith('npx') && !args.includes('-y') && !args.includes('--yes')) {
    args.unshift('-y');
    if ('command' in ctx.payload) ctx.payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command to prevent installation prompts from hanging.... (Frictionless Recovery)`);
  }
}

export function packageManagerInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, envOverrides, args } = ctx;

  const isPosixWslCwd =
    ctx.payload.target === 'wsl2' &&
    ctx.payload.cwd !== undefined &&
    (ctx.payload.cwd.startsWith('/') || ctx.payload.cwd.startsWith('~'));
  const projectDir =
    ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
      ? (isPosixWslCwd ? ctx.payload.cwd : path.resolve(ctx.payload.cwd))
      : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());

  if (ALL_JS_PM_CMDS.has(cmdBasename)) {
    healMissingAgentScriptArgs(args, toHostFsPathIfWin32(resolvePackageProjectDir(args, projectDir)), ctx.payload);
    if (tryAccelerateCommitForPm(ctx, cmdBasename, args, toHostFsPathIfWin32(projectDir))) return;
  }

  if (hasPackageManagerHelpFlag(args, cmdBasename)) return;

  applySystemPackageFlags(ctx, cmdBasename, args, envOverrides);

  if (CORE_JS_PM_CMDS.has(cmdBasename)) {
    handleCoreJsPm(ctx, cmdBasename, args, projectDir);
  } else if (RUNNER_CMDS.has(cmdBasename)) {
    handleRunnerPm(ctx, cmdBasename, args, projectDir);
  }

  if (['corepack', 'corepack.cmd', 'corepack.exe'].includes(cmdBasename)) {
    envOverrides['COREPACK_ENABLE_DOWNLOAD_PROMPT'] = '0';
    envOverrides['COREPACK_ENABLE_STRICT'] = '0';
  }
  if (['uv', 'uv.exe', 'uvx', 'uvx.exe'].includes(cmdBasename)) {
    envOverrides['UV_NO_PROGRESS'] = '1';
  }
}
