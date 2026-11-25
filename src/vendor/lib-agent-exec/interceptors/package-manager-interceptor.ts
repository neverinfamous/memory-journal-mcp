// @ts-nocheck
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { type ExecutionContext } from './types.js';
import { findFirstPkgSubcmdIndex } from './utils.js';
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

const PIP_VALUE_FLAGS = new Set([
  '--timeout', '--cache-dir', '-c', '--constraint', '-i', '--index-url', '--extra-index-url',
  '--proxy', '--cert', '--client-cert', '--trusted-host', '-r', '--requirement', '-e', '--editable', '-t', '--target',
  '--python', '--exists-action', '--log', '--config-file',
]);
const PYTHON_PRE_MODULE_VALUE_FLAGS = new Set(['-W', '-X', '--check-hash-based-pycs']);

function findPythonPipStartIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') return -1;
    if (PYTHON_PRE_MODULE_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('--')) continue;
    if (!a.startsWith('-')) return -1;
    for (let j = 1; j < a.length; j++) {
      const ch = a[j] ?? '';
      if (ch === 'c') return -1;
      if (ch === 'W' || ch === 'X') {
        if (j === a.length - 1) i++;
        break;
      }
      if (ch === 'm') {
        const rest = a.slice(j + 1);
        return rest.length > 0 ? (rest === 'pip' ? i + 1 : -1) : (args[i + 1] === 'pip' ? i + 2 : -1);
      }
    }
  }
  return -1;
}

function pushFlagBeforeDoubleDash(args: string[], flag: string): void {
  const ddIdx = args.indexOf('--');
  if (ddIdx !== -1) args.splice(ddIdx, 0, flag);
  else args.push(flag);
}

function preDashSlice(args: readonly string[]): readonly string[] {
  const ddIdx = args.indexOf('--');
  return ddIdx === -1 ? args : args.slice(0, ddIdx);
}

function findPipSubcommand(pipArgs: readonly string[]): string | undefined {
  for (let i = 0; i < pipArgs.length; i++) {
    const a = pipArgs[i];
    if (a === undefined || a === '--') break;
    if (PIP_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    return a;
  }
  return undefined;
}

const CONDA_INTERACTIVE_SUBCMDS: ReadonlySet<string> = new Set(['install', 'create', 'update', 'upgrade', 'remove', 'uninstall']);
const PYTHON_CLI_SET: ReadonlySet<string> = new Set(['python', 'python.exe', 'python3', 'python3.exe']);
const PIP_CLI_SET: ReadonlySet<string> = new Set(['pip', 'pip3', 'pip.exe', 'pip3.exe']);
const CONDA_CLI_SET: ReadonlySet<string> = new Set(['conda', 'conda.exe', 'mamba', 'mamba.exe']);
const PM_INIT_CREATE_SET: ReadonlySet<string> = new Set(['init', 'create']);
const PM_INSTALL_UPGRADE_SET: ReadonlySet<string> = new Set(['install', 'add', 'update', 'upgrade']);
const PM_PKG_RESOLUTION_SET: ReadonlySet<string> = new Set(['install', 'i', 'ci', 'add', 'update', 'up', 'upgrade', 'dedupe']);
const PM_PUBLISH_AUTH_SET: ReadonlySet<string> = new Set(['login', 'adduser', 'publish']);

const BUN_TEST_REL_PATH_RE = /^\.[a-zA-Z0-9_].*[/\\]/;

function applySystemPackageFlags(ctx: ExecutionContext, cmdBasename: string, args: string[], envOverrides: Record<string, string>): void {
  if (cmdBasename === 'apt' || cmdBasename === 'apt-get') {
    const preDd = preDashSlice(args);
    envOverrides['DEBIAN_FRONTEND'] = 'noninteractive';
    if (!preDd.includes('-y') && !preDd.includes('--yes')) {
      args.unshift('-y');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into apt/apt-get command to prevent prompt hanging.... (Frictionless Recovery)`);
    }
    return;
  }
  if (cmdBasename === 'apk') {
    const preDd = preDashSlice(args);
    if ((preDd.includes('add') || preDd.includes('del')) && !preDd.includes('--no-interactive')) {
      pushFlagBeforeDoubleDash(args, '--no-interactive');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-interactive' into apk command.... (Frictionless Recovery)`);
    }
    return;
  }
  if (cmdBasename === 'pacman' || cmdBasename === 'pacman.exe') {
    if (!preDashSlice(args).includes('--noconfirm')) {
      pushFlagBeforeDoubleDash(args, '--noconfirm');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--noconfirm' into pacman command.... (Frictionless Recovery)`);
    }
    return;
  }
  if (cmdBasename === 'yum' || cmdBasename === 'dnf') {
    if (!preDashSlice(args).includes('-y')) {
      pushFlagBeforeDoubleDash(args, '-y');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command.... (Frictionless Recovery)`);
    }
    return;
  }
  if (CONDA_CLI_SET.has(cmdBasename)) {
    const preDd = preDashSlice(args);
    if (!preDd.includes('-y') && !preDd.includes('--yes')) {
      const subCmd = getCorePmPositionals(cmdBasename, args)[0];
      if (subCmd && CONDA_INTERACTIVE_SUBCMDS.has(subCmd)) {
        pushFlagBeforeDoubleDash(args, '-y');
        syncPmPayloadArgs(ctx, args);
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
      }
    }
    return;
  }
  const isPythonCmd = PYTHON_CLI_SET.has(cmdBasename);
  const pipStartIdx = isPythonCmd ? findPythonPipStartIndex(args) : -1;
  const isPythonPip = pipStartIdx !== -1;
  if (PIP_CLI_SET.has(cmdBasename) || isPythonPip) {
    const pipArgs = isPythonPip ? args.slice(pipStartIdx) : args;
    const pipPreDd = preDashSlice(pipArgs);
    const subCmd = findPipSubcommand(pipArgs);
    if (subCmd === 'uninstall' && !pipPreDd.includes('-y') && !pipPreDd.includes('--yes')) {
      pushFlagBeforeDoubleDash(args, '-y');
      syncPmPayloadArgs(ctx, args);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into pip uninstall to prevent prompt hanging.... (Frictionless Recovery)`);
    }
  }
}

const BUN_TEST_VALUE_FLAGS = new Set(['-e', '--eval', '-p', '--print', '-t', '--test-name-pattern', '--timeout', '--rerun-each', '--bail', '--max-concurrency', '--preload', '-r']);

function normalizeBunTestDotSlashPaths(ctx: ExecutionContext, cmdBasename: string, args: string[]): void {
  if (!cmdBasename.startsWith('bun')) return;
  let modified = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (BUN_TEST_VALUE_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    if (BUN_TEST_REL_PATH_RE.test(arg)) {
      args[i] = `./${arg.replace(/\\/g, '/')}`;
      modified = true;
    }
  }
  if (modified && 'command' in ctx.payload) ctx.payload.args = args;
}

const CORE_PM_VALUE_FLAGS = new Set([
  '--dir', '-C', '--cwd', '--prefix', '--filter', '-F', '--config', '-c',
  '--registry', '--userconfig', '--globalconfig', '--cache', '--store-dir',
  '--loglevel', '--reporter', '--mutex', '--network-timeout', '-w', '--workspace',
  '--tag', '--access', '--otp', '--scope', '--auth-type',
]);
const CONDA_VALUE_FLAGS = new Set(['-n', '--name', '-p', '--prefix']);
const BUN_EVAL_VALUE_FLAGS = new Set(['-e', '--eval', '-p', '--print']);

function getCorePmPositionals(cmdBasename: string, args: readonly string[]): string[] {
  const isBun = cmdBasename.startsWith('bun');
  const isConda = cmdBasename.startsWith('conda') || cmdBasename.startsWith('mamba');
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (CORE_PM_VALUE_FLAGS.has(a) || (isBun && out.length === 0 && BUN_EVAL_VALUE_FLAGS.has(a)) || (isConda && CONDA_VALUE_FLAGS.has(a))) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
}

const TEST_SUBCMD_RE = /^(?:vitest|jest|pytest|playwright|cypress|test(?::.*|-.*)?|coverage(?::.*)?)$/i;
const TEST_RUNNER_ARG_RE = /^(?:vitest|jest|pytest|playwright|cypress)$/i;

function hasTestRunnerInvocation(subCmd: string | undefined, nonFlagArgs: readonly string[]): boolean {
  if (subCmd !== undefined && TEST_SUBCMD_RE.test(subCmd)) return true;
  return (subCmd === 'exec' || subCmd === 'run') && nonFlagArgs[1] !== undefined && TEST_RUNNER_ARG_RE.test(nonFlagArgs[1]);
}

function handleCoreJsPm(ctx: ExecutionContext, rawCmd: string, args: string[], projectDir: string, preResolvedHostDir?: string): void {
  const { cmdBasename, isYarn, isPnpm, hostEffectiveDir } = rewriteJsPackageManager(ctx, rawCmd, args, projectDir, preResolvedHostDir);
  ctx.envOverrides['CI'] = '1';
  ctx.envOverrides['PNPM_INTERACTIVE'] = 'false';

  const isYarnOrPnpm = isYarn || isPnpm || cmdBasename.includes('yarn') || cmdBasename.includes('pnpm');
  const initialPositionals = getCorePmPositionals(cmdBasename, args);
  stripScopedInteractiveFlags(args, cmdBasename, isYarnOrPnpm, ctx, initialPositionals);

  const nonFlagArgs = initialPositionals;
  const subCmd = nonFlagArgs[0];
  if (translateNativeOrDlxTool(ctx, cmdBasename, args, subCmd)) return;

  if (subCmd === 'upgrade-interactive') {
    console.error(`\n   💡 AGENT HINT: 'yarn upgrade-interactive' is a TUI tool and will hang. Use 'yarn upgrade' instead.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  const preDd = preDashSlice(args);
  if (
    subCmd !== undefined &&
    !cmdBasename.startsWith('pnpm') &&
    PM_INIT_CREATE_SET.has(subCmd) &&
    !preDd.includes('-y') &&
    !preDd.includes('--yes')
  ) {
    pushFlagBeforeDoubleDash(args, '-y');
    syncPmPayloadArgs(ctx, args);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
  }
  if (subCmd !== undefined && PM_INSTALL_UPGRADE_SET.has(subCmd) && cmdBasename.startsWith('npm')) {
    let addedNpmFlag = false;
    const npmPreDd = preDashSlice(args);
    if (!npmPreDd.includes('--no-fund')) { pushFlagBeforeDoubleDash(args, '--no-fund'); addedNpmFlag = true; }
    if (!npmPreDd.includes('--no-audit')) { pushFlagBeforeDoubleDash(args, '--no-audit'); addedNpmFlag = true; }
    if (addedNpmFlag) syncPmPayloadArgs(ctx, args);
  }
  if (args.some(a => path.basename(a).toLowerCase() === 'agent-exec.ts')) return;

  if (hasTestRunnerInvocation(subCmd, nonFlagArgs)) {
    splitJoinedTestTargetArgs(ctx, args);
    normalizeBunTestDotSlashPaths(ctx, cmdBasename, args);
  }

  const tsxBin = (subCmd === 'tsx' || subCmd === 'ts-node')
    ? subCmd
    : ((subCmd === 'exec' || subCmd === 'run') && (nonFlagArgs[1] === 'tsx' || nonFlagArgs[1] === 'ts-node') ? nonFlagArgs[1] : undefined);
  if (tsxBin !== undefined) {
    const firstSubIdx = findFirstPkgSubcmdIndex(args);
    const tsxIdx = firstSubIdx === -1 ? -1 : (args[firstSubIdx] === tsxBin ? firstSubIdx : args.indexOf(tsxBin, firstSubIdx + 1));
    if (tsxIdx !== -1) rewriteTsxInvocation(ctx, tsxBin, args, tsxIdx + 1, hostEffectiveDir);
  }

  const subCmdLower = subCmd !== undefined ? subCmd.toLowerCase() : (isYarn ? 'install' : '');
  const isPackageResolution = PM_PKG_RESOLUTION_SET.has(subCmdLower);
  const targetScript = (subCmd === 'run' || subCmd === 'exec') ? nonFlagArgs[1] : subCmd;
  applyPackageManagerTimeouts(ctx, cmdBasename, args, isPackageResolution, targetScript);

  if (subCmd !== undefined && PM_PUBLISH_AUTH_SET.has(subCmd)) {
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

const PM_COMPAT_PREFIX_EQ_RE = /^(?:--dir|-C|--prefix|--filter)=/;

function collectPnpmCompatPrefixFlags(args: readonly string[], limitIdx: number): string[] {
  const compat: string[] = [];
  for (let i = 0; i < limitIdx; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (PNPM_COMPAT_VALUE_PREFIX_FLAGS.has(a)) {
      const nextVal = i + 1 < limitIdx ? args[i + 1] : undefined;
      const mapped = a === '--cwd' ? '--dir' : a;
      if (nextVal !== undefined) compat.push(mapped, nextVal);
      if (i + 1 < limitIdx) i++;
      continue;
    }
    if (a.startsWith('--cwd=')) {
      compat.push(`--dir=${a.slice('--cwd='.length)}`);
      continue;
    }
    if (PM_COMPAT_PREFIX_EQ_RE.test(a)) {
      compat.push(a);
      continue;
    }
    if (RUNNER_VALUE_FLAGS.has(a)) { i++; }
  }
  return compat;
}

const MNT_DRIVE_RE = /^\/mnt\/[a-zA-Z](?:\/|$)/;

function toHostFsPathIfWin32(p: string): string {
  return process.platform === 'win32' && MNT_DRIVE_RE.test(p) ? convertToWindowsPath(p) : p;
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

function handleRunnerPm(ctx: ExecutionContext, cmdBasename: string, args: string[], projectDir: string, preResolvedHostDir?: string): void {
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
    rewriteTsxInvocation(ctx, 'tsx', args, tsxStartIdx, preResolvedHostDir ?? toHostFsPathIfWin32(resolvePackageProjectDir(args, projectDir)));
    applyPackageManagerTimeouts(ctx, ctx.cmdBasename, args, false, 'tsx');
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'npx tsx' to 'pnpm exec tsx' to prevent interactive installation prompts... (Frictionless Recovery)`);
    return;
  }
  ctx.envOverrides['CI'] = '1';
  if (runnerTarget !== undefined && TEST_RUNNER_ARG_RE.test(runnerTarget)) {
    splitJoinedTestTargetArgs(ctx, args);
  }
  applyPackageManagerTimeouts(ctx, cmdBasename, args, false, undefined);
  const runnerPreDd = preDashSlice(args);
  const npxOwnFlags = firstNonFlagIdx !== -1 ? args.slice(0, firstNonFlagIdx) : runnerPreDd;
  if (cmdBasename.startsWith('npx') && !npxOwnFlags.includes('-y') && !npxOwnFlags.includes('--yes')) {
    args.unshift('-y');
    if ('command' in ctx.payload) ctx.payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command to prevent installation prompts from hanging.... (Frictionless Recovery)`);
  }
}

const ALL_PM_INTERCEPTOR_CMDS: ReadonlySet<string> = new Set([
  ...ALL_JS_PM_CMDS,
  'apt', 'apt-get', 'apk', 'pacman', 'pacman.exe', 'yum', 'dnf',
  'conda', 'conda.exe', 'mamba', 'mamba.exe',
  'pip', 'pip3', 'pip.exe', 'pip3.exe',
  'python', 'python.exe', 'python3', 'python3.exe',
  'corepack', 'corepack.cmd', 'corepack.exe',
  'uv', 'uv.exe', 'uvx', 'uvx.exe',
]);

export function packageManagerInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, envOverrides, args } = ctx;
  if (!ALL_PM_INTERCEPTOR_CMDS.has(cmdBasename)) return;

  const isPosixWslCwd =
    ctx.payload.target === 'wsl2' &&
    ctx.payload.cwd !== undefined &&
    (ctx.payload.cwd.startsWith('/') || ctx.payload.cwd.startsWith('~'));
  const projectDir =
    ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
      ? (isPosixWslCwd ? ctx.payload.cwd : path.resolve(ctx.payload.cwd))
      : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());

  let targetProjectDir: string | undefined;
  if (ALL_JS_PM_CMDS.has(cmdBasename)) {
    targetProjectDir = toHostFsPathIfWin32(resolvePackageProjectDir(args, projectDir));
    healMissingAgentScriptArgs(args, targetProjectDir, ctx.payload);
    if (tryAccelerateCommitForPm(ctx, cmdBasename, args, targetProjectDir)) return;
  }

  if (hasPackageManagerHelpFlag(args, cmdBasename)) return;

  applySystemPackageFlags(ctx, cmdBasename, args, envOverrides);

  if (CORE_JS_PM_CMDS.has(cmdBasename)) {
    handleCoreJsPm(ctx, cmdBasename, args, projectDir, targetProjectDir);
  } else if (RUNNER_CMDS.has(cmdBasename)) {
    handleRunnerPm(ctx, cmdBasename, args, projectDir, targetProjectDir);
  }

  if (cmdBasename === 'corepack' || cmdBasename === 'corepack.cmd' || cmdBasename === 'corepack.exe') {
    envOverrides['COREPACK_ENABLE_DOWNLOAD_PROMPT'] = '0';
    envOverrides['COREPACK_ENABLE_STRICT'] = '0';
  }
  if (cmdBasename === 'uv' || cmdBasename === 'uv.exe' || cmdBasename === 'uvx' || cmdBasename === 'uvx.exe') {
    envOverrides['UV_NO_PROGRESS'] = '1';
  }
}
