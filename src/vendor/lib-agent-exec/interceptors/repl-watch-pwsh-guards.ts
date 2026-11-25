// @ts-nocheck
import { escapePwshSingleQuoted } from '../command-utils.js';
import { PWSH_UI_REGEX, findPwshCommandIndex } from './repl-tui-constants.js';
import { stripCommentAndQuoteSpansForShellScan } from './repl-script-scanner.js';
import type { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL, hasTailFollowFlag } from './utils.js';

const WATCH_NODE_BIN_SET: ReadonlySet<string> = new Set([
  'nodemon', 'nodemon.cmd', 'nodemon.exe', 'ts-node-dev', 'ts-node-dev.cmd', 'ts-node-dev.exe',
]);
const RUNNER_CMDS_FOR_WATCH: ReadonlySet<string> = new Set([
  'node', 'bun', 'deno', 'npx', 'pnpx', 'bunx', 'pnpm', 'npm', 'yarn', 'tsx', 'vitest', 'jest',
]);
const EXEC_RUNNER_BASES_SET: ReadonlySet<string> = new Set(['npx', 'pnpx', 'bunx']);
const PKG_RUNNER_BASES_SET: ReadonlySet<string> = new Set(['npx', 'pnpx', 'bunx', 'npm', 'pnpm', 'yarn']);
const TEST_FWD_POS_SET: ReadonlySet<string> = new Set(['test', 'vitest', 'jest']);
const PM_DELEGATE_SUBCMD_SET: ReadonlySet<string> = new Set(['exec', 'dlx', 'x']);
const PM2_BLOCKED_SUBCMD_SET: ReadonlySet<string> = new Set(['logs', 'monit', 'dash']);
const PWSH_CLI_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe']);
const RUNNER_PRE_FLAGS: ReadonlySet<string> = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader',
  '-C', '--conditions', '--input-type', '--env-file', '--env-file-if-exists',
  '--watch-path', '--redirect-warnings', '--diagnostic-dir', '--heapsnapshot-signal',
  '--openssl-config', '--icu-data-dir', '--title', '--max-old-space-size',
  '--dir', '--cwd', '--prefix', '--filter', '-F', '-c', '--config',
  '--tsconfig', '--tsconfig-override', '--userconfig', '-w', '--workspace',
]);

function blockWatchExecution(hint: string, details: readonly string[] = []): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  for (const line of details) console.error(`   ${line}`);
  process.exit(1);
}

const PWSH_EVAL_EQ_RE = /^--(?:eval|print)=/;
const SPACE_OR_TAB_RE = /[ \t]/;

function scanRunnerWatchContext(baseNoExt: string, args: readonly string[]): { positionals: string[]; sawPreWatch: boolean } {
  const positionals: string[] = [];
  let sawPreWatch = false;
  let pastDoubleDash = false;
  const isDirectTestRunner = baseNoExt === 'vitest' || baseNoExt === 'jest';
  const isExecRunner = EXEC_RUNNER_BASES_SET.has(baseNoExt);
  const isJsRuntime = baseNoExt === 'node' || baseNoExt === 'bun' || baseNoExt === 'deno';
  const isPkgRunner = PKG_RUNNER_BASES_SET.has(baseNoExt);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!pastDoubleDash && a === '--') { pastDoubleDash = true; continue; }
    if (pastDoubleDash) {
      const canForward = isDirectTestRunner || isExecRunner || positionals.some(p => TEST_FWD_POS_SET.has(p.toLowerCase()));
      if (!canForward) break;
      const lowPost = a.toLowerCase();
      if (lowPost === '--watch' || lowPost === '--watch=true' || lowPost === '--watch-path' || lowPost.startsWith('--watch-path=')) {
        sawPreWatch = true;
        break;
      }
      continue;
    }
    if (a.startsWith('-')) {
      const low = a.toLowerCase();
      if (low === '--watch' || low === '--watch=true' || low === '--watch-path' || low.startsWith('--watch-path=')) sawPreWatch = true;
      if (isJsRuntime && (low === '-e' || low === '--eval' || low === '-p' || low === '--print' || PWSH_EVAL_EQ_RE.test(low))) break;
      if (!a.includes('=') && (RUNNER_PRE_FLAGS.has(a) || (isPkgRunner && (a === '-p' || a === '--package')))) i++;
      continue;
    }
    positionals.push(a);
    const nextAfter = args[i + 1]?.toLowerCase();
    if (a.toLowerCase() === 'tsx' && (nextAfter === 'watch' || nextAfter === '--watch')) sawPreWatch = true;
    if (baseNoExt === 'node' && positionals.length === 1) break;
  }
  return { positionals, sawPreWatch };
}

export function checkPriorityWatchAndShellGuards(ctx: ExecutionContext): void {
  const { cmdBasename, args, envOverrides, payload } = ctx;
  const lower = cmdBasename.toLowerCase();
  const baseNoExt = lower.replace(/\.(?:exe|cmd)$/, '');

  if (WATCH_NODE_BIN_SET.has(lower)) {
    blockWatchExecution(`'${cmdBasename}' runs indefinitely in watch mode. Blocking execution.`);
  }
  if (RUNNER_CMDS_FOR_WATCH.has(baseNoExt)) {
    const { positionals, sawPreWatch } = scanRunnerWatchContext(baseNoExt, args);
    const [pos0, pos1] = positionals;
    if (baseNoExt === 'tsx' && (pos0 === 'watch' || sawPreWatch)) {
      blockWatchExecution(`'tsx ${sawPreWatch ? '--watch' : 'watch'}' runs indefinitely. Blocking execution.`);
    }
    if (payload.type === 'command') {
      const delegated = EXEC_RUNNER_BASES_SET.has(baseNoExt) ? pos0 : (pos0 !== undefined && PM_DELEGATE_SUBCMD_SET.has(pos0) ? pos1 : pos0);
      if (delegated === 'nodemon' || delegated === 'ts-node-dev') {
        blockWatchExecution(`'${delegated}' runs indefinitely in watch mode. Blocking execution to prevent hanging.`);
      }
      if (sawPreWatch) {
        blockWatchExecution(`'${cmdBasename} --watch' runs indefinitely.`, ['Because \'agent-exec.ts\' is non-interactive, this will hang until timeout.', 'Please use standard execution without watch mode.']);
      }
    }
    if ((baseNoExt === 'bun' || baseNoExt === 'deno') && pos0 === 'repl') {
      blockWatchExecution(`'${baseNoExt} repl' is interactive and will hang indefinitely. Blocking execution.`);
    }
  }
  if (baseNoExt === 'pm2') {
    const ddIdx = args.indexOf('--');
    const pre = ddIdx === -1 ? args : args.slice(0, ddIdx);
    const firstPm2Sub = pre.find(a => !a.startsWith('-'));
    if (firstPm2Sub !== undefined && PM2_BLOCKED_SUBCMD_SET.has(firstPm2Sub)) {
      blockWatchExecution(`'pm2 ${firstPm2Sub}' is interactive/runs indefinitely. Blocking execution.`);
    }
  }
  if (lower === 'watch' || lower === 'watch.exe') blockWatchExecution(`'watch' runs indefinitely. Blocking execution.`);
  if ((lower === 'tail' || lower === 'tail.exe') && hasTailFollowFlag(args)) {
    blockWatchExecution(`'tail -f' runs indefinitely. Blocking execution.`);
  }
  if (PWSH_CLI_SET.has(lower)) {
    envOverrides['POWERSHELL_TELEMETRY_OPTOUT'] = '1';
    envOverrides['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1';
    const { cmdIdx, boundary } = findPwshCommandIndex(args);
    if (args.slice(0, boundary).some(a => a.toLowerCase() === '-noexit')) {
      blockWatchExecution(`'pwsh -NoExit' prevents the shell from exiting and will hang indefinitely. Blocking execution.`);
    }
    if (cmdIdx !== -1) {
      const cmdTok = args[cmdIdx] ?? '';
      const inlineBody = cmdTok.includes(':') ? [cmdTok.slice(cmdTok.indexOf(':') + 1), ...args.slice(cmdIdx + 1)].join(' ') : args.slice(cmdIdx + 1).join(' ');
      if (inlineBody.length > 0 && PWSH_UI_REGEX.test(stripCommentAndQuoteSpansForShellScan(inlineBody))) {
        blockWatchExecution(`PowerShell UI cmdlets like Get-Credential or Out-GridView will hang headlessly. Blocking execution.`);
      }
    }
  }
}

export function encodeInlinePwshInvocation(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  if (payload.type !== 'command' || payload.target === 'wsl2') return;
  if (!PWSH_CLI_SET.has(cmdBasename.toLowerCase())) return;

  const { cmdIdx: cIndex } = findPwshCommandIndex(args);
  const cmdTok = cIndex !== -1 ? (args[cIndex] ?? '') : '';
  const colonBody = cmdTok.includes(':') ? cmdTok.slice(cmdTok.indexOf(':') + 1) : '';
  const isStdinDashCommand = colonBody.length === 0 && args[cIndex + 1] === '-' && cIndex + 2 === args.length;
  if (cIndex !== -1 && !isStdinDashCommand && (colonBody.length > 0 || cIndex + 1 < args.length)) {
    const scriptArgs = colonBody.length > 0 ? [colonBody, ...args.slice(cIndex + 1)] : args.slice(cIndex + 1);
    const safeArgs = scriptArgs.map((a) => (!SPACE_OR_TAB_RE.test(a) || (a.startsWith("'") && a.endsWith("'")) || (a.startsWith('"') && a.endsWith('"')) || a.startsWith('$(') || a.startsWith('@(') ? a : `'${escapePwshSingleQuoted(a)}'`));
    const scriptBody = scriptArgs.length === 1 ? (scriptArgs[0] ?? '') : safeArgs.join(' ');
    const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n` + scriptBody;
    const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
    args.splice(cIndex, args.length - cIndex, '-EncodedCommand', encoded);
    payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Intercepted inline PowerShell command. Converting to Base64 -EncodedCommand to prevent quote parsing failures... (Frictionless Recovery)`);
  }

  const { boundary: flagBoundary } = findPwshCommandIndex(args);
  const lowerHeads = args.slice(0, flagBoundary).map((a) => {
    const low = a.toLowerCase();
    return low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
  });
  const newArgs: string[] = [];
  if (!lowerHeads.includes('-executionpolicy') && !lowerHeads.includes('-ep')) newArgs.push('-ExecutionPolicy', 'Bypass');
  if (!lowerHeads.includes('-noninteractive')) newArgs.push('-NonInteractive');
  if (!lowerHeads.includes('-noprofile')) newArgs.push('-NoProfile');
  if (newArgs.length > 0) {
    args.unshift(...newArgs);
    payload.args = args;
    console.error(`\n   💡 AGENT HINT: Automatically injected [${newArgs.join(', ')}] into ${cmdBasename} command to prevent hanging.`);
  }
}
