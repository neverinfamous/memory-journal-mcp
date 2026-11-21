// @ts-nocheck
import path from 'node:path';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext } from './types.js';
import { getPkgNonFlagArgs } from './utils.js';
import { rewriteJsPackageManager, stripScopedInteractiveFlags } from './package-manager-js-rewrites.js';
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

function applySystemPackageFlags(cmdBasename: string, args: string[], envOverrides: Record<string, string>): void {
  if (['apt', 'apt-get'].includes(cmdBasename)) {
    envOverrides['DEBIAN_FRONTEND'] = 'noninteractive';
    if (!args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into apt/apt-get command to prevent prompt hanging.... (Frictionless Recovery)`);
      args.unshift('-y');
    }
    return;
  }
  if (cmdBasename === 'apk' && (args.includes('add') || args.includes('del')) && !args.includes('--no-interactive')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-interactive' into apk command.... (Frictionless Recovery)`);
    args.push('--no-interactive');
    return;
  }
  if (['pacman', 'pacman.exe'].includes(cmdBasename) && !args.includes('--noconfirm')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--noconfirm' into pacman command.... (Frictionless Recovery)`);
    args.push('--noconfirm');
    return;
  }
  if (['yum', 'dnf'].includes(cmdBasename) && !args.includes('-y')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command.... (Frictionless Recovery)`);
    args.push('-y');
    return;
  }
  if (['conda', 'conda.exe', 'mamba', 'mamba.exe'].includes(cmdBasename) && !args.includes('-y') && !args.includes('--yes')) {
    const subCmd = getPkgNonFlagArgs(args)[0];
    if (subCmd && ['install', 'create', 'update', 'upgrade', 'remove', 'uninstall'].includes(subCmd)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
      args.push('-y');
    }
    return;
  }
  const mIndex = args.indexOf('-m');
  const isPythonPip = ['python', 'python.exe', 'python3', 'python3.exe'].includes(cmdBasename) && mIndex !== -1 && args[mIndex + 1] === 'pip';
  if (['pip', 'pip3', 'pip.exe', 'pip3.exe'].includes(cmdBasename) || isPythonPip) {
    const pipArgs = isPythonPip ? args.slice(mIndex + 2) : args;
    const subCmd = pipArgs.filter(a => !a.startsWith('-'))[0];
    if (subCmd === 'uninstall' && !pipArgs.includes('-y') && !pipArgs.includes('--yes')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into pip uninstall to prevent prompt hanging.... (Frictionless Recovery)`);
      args.push('-y');
    }
  }
}

function normalizeBunTestDotSlashPaths(ctx: ExecutionContext, cmdBasename: string, args: string[]): void {
  if (!cmdBasename.startsWith('bun')) return;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== undefined && /^\.[a-zA-Z0-9_].*[/\\]/.test(arg)) {
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
  stripScopedInteractiveFlags(args, cmdBasename, isYarnOrPnpm);

  const nonFlagArgs = getPkgNonFlagArgs(args);
  const subCmd = nonFlagArgs[0];
  if (translateNativeOrDlxTool(ctx, cmdBasename, args, subCmd)) return;

  if (subCmd === 'upgrade-interactive') {
    console.error(`\n   💡 AGENT HINT: 'yarn upgrade-interactive' is a TUI tool and will hang. Use 'yarn upgrade' instead.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (subCmd !== undefined && ['init', 'create', 'dlx', 'x'].includes(subCmd) && !args.includes('-y') && !args.includes('--yes')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
    if (subCmd === 'dlx' || subCmd === 'x') args.splice(args.indexOf(subCmd) + 1, 0, '-y');
    else args.push('-y');
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
    const tsxIdx = args.indexOf(tsxBin);
    if (tsxIdx !== -1) rewriteTsxInvocation(ctx, tsxBin, args, tsxIdx + 1, projectDir);
  }

  const subCmdLower = subCmd !== undefined ? subCmd.toLowerCase() : (isYarn ? 'install' : '');
  const isPackageResolution = ['install', 'i', 'ci', 'add', 'update', 'up', 'dedupe'].includes(subCmdLower);
  const targetScript = (subCmd === 'run' || subCmd === 'exec') ? nonFlagArgs[1] : subCmd;
  applyPackageManagerTimeouts(ctx, cmdBasename, args, isPackageResolution, targetScript);

  if (subCmd !== undefined && ['login', 'adduser', 'publish'].includes(subCmd)) {
    if (!(subCmd === 'publish' && process.env['NPM_TOKEN'])) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} ${subCmd}' may be highly interactive (e.g., OTP prompts, auth) and will hang. Please configure token-based authentication non-interactively.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }
}

function handleRunnerPm(ctx: ExecutionContext, cmdBasename: string, args: string[], projectDir: string): void {
  const firstNonFlagIdx = args.findIndex(a => !a.startsWith('-'));
  const runnerTarget = firstNonFlagIdx !== -1 ? args[firstNonFlagIdx] : undefined;
  if (runnerTarget === 'rg' || runnerTarget === 'ripgrep' || runnerTarget === 'fd' || runnerTarget === 'fdfind') {
    rewriteToolBinary(ctx, cmdBasename, args, runnerTarget, firstNonFlagIdx);
    return;
  }
  if (cmdBasename.startsWith('npx') && args[0] === 'tsx') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'npx tsx' to 'pnpm exec tsx' to prevent interactive installation prompts... (Frictionless Recovery)\x1b[0m`);
    ctx.cmdBasename = process.platform === 'win32' && ctx.payload.target !== 'wsl2' ? 'pnpm.cmd' : 'pnpm';
    if ('command' in ctx.payload) ctx.payload.command = ctx.cmdBasename;
    args.unshift('exec');
    rewriteTsxInvocation(ctx, 'tsx', args, args.indexOf('tsx') + 1, projectDir);
    return;
  }
  ctx.envOverrides['CI'] = '1';
  if (args.some(a => /^(?:vitest|jest|pytest|playwright|cypress)$/i.test(a))) {
    splitJoinedTestTargetArgs(ctx, args);
  }
  applyPackageManagerTimeouts(ctx, cmdBasename, args, false, undefined);
  if (!args.includes('-y') && !args.includes('--yes')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command to prevent installation prompts from hanging.... (Frictionless Recovery)`);
    args.unshift('-y');
  }
}

export function packageManagerInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, envOverrides } = ctx;
  let { args } = ctx;
  if (!args) args = [];

  const projectDir = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
    ? path.resolve(ctx.payload.cwd)
    : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());

  if (ALL_JS_PM_CMDS.has(cmdBasename)) {
    healMissingAgentScriptArgs(args, projectDir, ctx.payload);
    if (tryAccelerateCommitForPm(ctx, cmdBasename, args, projectDir)) return;
  }

  if (args.includes('--help') || args.includes('-h')) return;

  applySystemPackageFlags(cmdBasename, args, envOverrides);

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
