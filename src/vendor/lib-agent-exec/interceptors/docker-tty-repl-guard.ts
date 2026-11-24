// @ts-nocheck
import path from 'node:path';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { TUI_COMMANDS } from './repl-tui-constants.js';
import type { ExecutionContext } from './types.js';

const CONTAINER_TUI_COMMANDS: ReadonlySet<string> = new Set(
  TUI_COMMANDS.map(c => c.toLowerCase().replace(/\.exe$/, '')),
);

export const DOCKER_VALUE_FLAGS: readonly string[] = [
  '-a', '--attach', '--index',
  '-v', '--volume', '-p', '--publish', '--name', '-e', '--env', '--env-file',
  '--build-arg', '-f', '--file', '-w', '--workdir', '-u', '--user', '--network',
  '--entrypoint', '-m', '--memory', '--memory-swap', '--memory-reservation',
  '-c', '--cpu-shares', '--cpu-quota', '--cpu-period', '--cpuset-cpus', '--cpus',
  '--pids-limit', '--oom-score-adj', '--label', '--hostname', '--add-host',
  '--dns', '--cap-add', '--cap-drop', '--device', '--log-driver', '--log-opt',
  '--restart', '--mount', '--tmpfs', '--ulimit', '--pid', '--ipc', '--uts',
  '--userns', '--cgroupns', '--runtime', '--isolation', '--security-opt',
  '--storage-opt', '--sysctl', '--link', '--health-cmd', '--health-interval',
  '--health-retries', '--health-timeout', '--health-start-period', '--stop-signal', '--stop-timeout',
  '--shm-size', '--gpus', '--ip', '--ip6', '--mac-address',
  '--platform', '--pull', '-l', '-h', '--group-add', '--expose', '--domainname',
  '--blkio-weight', '--cidfile', '--cgroup-parent',
  '--detach-keys', '--volumes-from', '--label-file', '--dns-opt', '--dns-search', '--annotation',
];

const DOCKER_VALUE_FLAG_SET: ReadonlySet<string> = new Set(DOCKER_VALUE_FLAGS);
const DEFAULT_DB_CONN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-h', '-p', '-a', '-n', '-u', '-P', '-D', '-U', '-d',
  '--host', '--port', '--user', '--socket', '--database', '--dbname',
]);
const MONGO_CONN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  ...DEFAULT_DB_CONN_VALUE_FLAGS,
  '--username', '--password', '--authenticationDatabase', '--authenticationMechanism',
  '--tlsCAFile', '--tlsCertificateKeyFile',
]);
const DB_CONN_VALUE_FLAGS_BY_CMD: Readonly<Record<string, ReadonlySet<string>>> = {
  sqlite3: new Set(['-separator', '-nullvalue', '-newline', '-init', '-cmd', '-vfs']),
  'redis-cli': new Set(['-h', '-p', '-s', '-a', '-u', '--user', '--pass', '-n', '-r', '-i', '-d', '--ldb', '--cacert', '--cert', '--key', '--sni']),
  mongosh: MONGO_CONN_VALUE_FLAGS,
  mongo: MONGO_CONN_VALUE_FLAGS,
};

const CONTAINER_SHELLS = new Set(['bash', 'sh', 'zsh', 'ash', 'dash', 'fish', 'csh', 'tcsh', 'ksh']);
const CONTAINER_JS_RUNTIMES = new Set(['node', 'bun', 'deno', 'tsx', 'ts-node']);
const CONTAINER_PYTHON = new Set(['python', 'python3', 'pypy', 'pypy3']);
const CONTAINER_RUBY = new Set(['ruby', 'irb']);
const CONTAINER_PERL = new Set(['perl']);
const CONTAINER_PHP = new Set(['php']);
const CONTAINER_OTHER_REPLS = new Set(['ghci', 'erl', 'iex', 'scala', 'clojure', 'r', 'lua']);
const CONTAINER_DB_REPLS = new Set(['psql', 'mysql', 'sqlite3', 'mongo', 'mongosh', 'redis-cli']);

const ALL_CONTAINER_REPLS: ReadonlySet<string> = new Set([
  ...CONTAINER_SHELLS,
  ...CONTAINER_JS_RUNTIMES,
  ...CONTAINER_PYTHON,
  ...CONTAINER_RUBY,
  ...CONTAINER_PERL,
  ...CONTAINER_PHP,
  ...CONTAINER_OTHER_REPLS,
  ...CONTAINER_DB_REPLS,
]);

const DOCKER_SHORT_VALUE_FLAG_SET: ReadonlySet<string> = new Set(
  DOCKER_VALUE_FLAGS.filter(f => f.length === 2 && f.startsWith('-') && !f.startsWith('--')),
);

export function stripDockerTtyFlags(
  args: string[],
  hasStdin: boolean,
  onSync?: () => void,
  runExecIdx?: number,
): void {
  let stopStripping = false;
  let seenRunOrExec = false;
  const newArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (stopStripping) { newArgs.push(arg); continue; }
    if (!seenRunOrExec) {
      if (runExecIdx !== undefined ? i === runExecIdx : (arg === 'run' || arg === 'exec')) {
        seenRunOrExec = true;
      }
      newArgs.push(arg);
      continue;
    }
    if (arg === '--') {
      stopStripping = true;
      newArgs.push(arg);
      continue;
    }
    if (!arg.startsWith('-')) {
      const prev = newArgs[newArgs.length - 1] ?? '';
      const prevTakesVal = DOCKER_VALUE_FLAG_SET.has(prev) || (prev.length === 2 && DOCKER_SHORT_VALUE_FLAG_SET.has(prev));
      if (!prevTakesVal) stopStripping = true;
      newArgs.push(arg);
      continue;
    }
    if (DOCKER_VALUE_FLAG_SET.has(arg) || (arg.length > 2 && DOCKER_SHORT_VALUE_FLAG_SET.has(arg.slice(0, 2)))) {
      newArgs.push(arg);
      continue;
    }
    if (arg === '--tty' || arg === '-t' || arg.startsWith('--tty=')) continue;
    if (arg === '--interactive' || arg === '-i' || arg.startsWith('--interactive=')) {
      if (hasStdin) newArgs.push(arg);
      continue;
    }
    if (/^-([a-zA-Z]*[ti][a-zA-Z]*)$/.test(arg)) {
      let newArg = arg.replace(/t/g, '');
      if (!hasStdin) newArg = newArg.replace(/i/g, '');
      if (newArg !== '-') newArgs.push(newArg);
      continue;
    }
    newArgs.push(arg);
  }

  const changed = newArgs.length !== args.length || newArgs.some((v, idx) => v !== args[idx]);
  if (!changed) return;

  args.length = 0;
  args.push(...newArgs);
  onSync?.();
  console.error(`\n   🛠️ AUTONOMOUS HEALING: You attempted to run a Docker command with a TTY flag. Because 'agent-exec.ts' uses \`shell: false\` and pipes stdio, TTY allocation is NOT supported. Automatically stripping TTY flags (-t, --tty) to prevent process hanging... (Frictionless Recovery)`);
  if (!hasStdin) {
    console.error(`   Also stripping interactive flags (-i, --interactive) since no stdin payload was provided.`);
  }
}

function collectNonConnDbPositionals(baseCmd: string, args: readonly string[]): string[] {
  const connValueFlags = Object.hasOwn(DB_CONN_VALUE_FLAGS_BY_CMD, baseCmd)
    ? (DB_CONN_VALUE_FLAGS_BY_CMD[baseCmd] ?? DEFAULT_DB_CONN_VALUE_FLAGS)
    : DEFAULT_DB_CONN_VALUE_FLAGS;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('-')) {
      if (connValueFlags.has(a) && i + 1 < args.length) i++;
      continue;
    }
    pos.push(a);
  }
  return pos;
}

function absorbsNextDockerShortValue(arg: string): boolean {
  if (arg.startsWith('--') || arg.length <= 2) return false;
  for (let j = 1; j < arg.length; j++) {
    if (DOCKER_SHORT_VALUE_FLAG_SET.has(`-${arg[j] ?? ''}`)) {
      return j === arg.length - 1;
    }
  }
  return false;
}

export function extractDockerRunExecCommand(args: readonly string[], runExecIdx?: number): { containerCmd: string; containerCmdArgs: string[] } | null {
  let foundRunExec = false;
  let skipNextValue = false;
  let capturedEntrypoint: string | null = null;
  let expectingEntrypointVal = false;
  let containerName: string | null = null;
  let containerCmd: string | null = null;
  let pastDoubleDash = false;
  const containerCmdArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!foundRunExec) {
      if (runExecIdx !== undefined ? i === runExecIdx : (arg === 'run' || arg === 'exec')) foundRunExec = true;
      continue;
    }
    if (expectingEntrypointVal) {
      expectingEntrypointVal = false;
      if (arg.trim().length > 0) capturedEntrypoint = arg;
      continue;
    }
    if (skipNextValue) { skipNextValue = false; continue; }
    if (!pastDoubleDash && arg === '--') {
      pastDoubleDash = true;
      continue;
    }
    if (!pastDoubleDash && !containerName && (arg === '-T' || arg === '--no-TTY')) continue;
    if (!pastDoubleDash && !containerName && arg.startsWith('-')) {
      if (arg === '--entrypoint') {
        expectingEntrypointVal = true;
      } else if (arg.startsWith('--entrypoint=')) {
        const val = arg.slice('--entrypoint='.length);
        if (val.trim().length > 0) capturedEntrypoint = val;
      } else if (DOCKER_VALUE_FLAG_SET.has(arg) || (arg.startsWith('--') && arg.includes('='))) {
        if (!arg.includes('=')) skipNextValue = true;
      } else if (absorbsNextDockerShortValue(arg)) {
        skipNextValue = true;
      }
      continue;
    }
    if (!containerName) {
      containerName = arg;
      if (capturedEntrypoint !== null) containerCmd = capturedEntrypoint;
      continue;
    }
    if (!containerCmd) { containerCmd = arg; continue; }
    containerCmdArgs.push(arg);
  }

  if (containerCmd === null) return null;
  return { containerCmd, containerCmdArgs };
}

function matchesContainerFlagOrPrefix(arg: string, exactFlags: readonly string[], allowShortPrefix = true): boolean {
  for (const flag of exactFlags) {
    if (arg === flag || arg.startsWith(`${flag}=`)) return true;
    if (allowShortPrefix && flag.length === 2 && flag.startsWith('-') && !flag.startsWith('--') && arg.startsWith(flag) && arg.length > 2) return true;
  }
  return false;
}

function isContainerDbNonInteractive(baseCmd: string, containerCmdArgs: readonly string[]): boolean {
  if (baseCmd === 'sqlite3') {
    if (containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-cmd', '-batch', '--batch', '-version', '--version', '-help', '--help'], false))) {
      return true;
    }
    return collectNonConnDbPositionals(baseCmd, containerCmdArgs).length >= 2;
  }
  if (baseCmd === 'redis-cli') {
    if (containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['--eval', '-v', '--version', '--help'], false))) {
      return true;
    }
    return collectNonConnDbPositionals(baseCmd, containerCmdArgs).length >= 1;
  }
  if (baseCmd === 'mongosh' || baseCmd === 'mongo') {
    if (containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['--eval', '-f', '--file', '--version', '--help'], false))) {
      return true;
    }
    const mongoPos = collectNonConnDbPositionals(baseCmd, containerCmdArgs);
    return mongoPos.length >= 2 || mongoPos.some(p => !/^mongodb(?:\+srv)?:\/\//i.test(p) && /\.(?:[cm]?js)$/i.test(p));
  }
  if (baseCmd === 'psql') {
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-c', '--command', '-f', '--file', '-V', '--version', '--help']));
  }
  if (baseCmd === 'mysql') {
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-e', '--execute', '-V', '--version', '--help']));
  }
  return false;
}

const SHELL_VALUE_FLAGS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const JS_RUNTIME_VALUE_FLAGS = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '--preload',
  '--env-file', '--env-file-if-exists', '-C', '--conditions', '--input-type', '--max-old-space-size', '--title',
  '-e', '--eval', '-p', '--print',
]);
const PYTHON_VALUE_FLAGS = new Set(['-W', '-X', '--check-hash-based-pycs']);
const RUBY_VALUE_FLAGS = new Set(['-r', '-I', '-C', '-E', '-K', '-F', '-0']);
const PERL_VALUE_FLAGS = new Set(['-I', '-M', '-m', '-C', '-x', '-0']);
const PHP_VALUE_FLAGS = new Set(['-c', '-d', '-z', '-B', '-R', '-F', '-E']);

function hasContainerScriptPositional(args: readonly string[], valueFlags: ReadonlySet<string>): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--') return i + 1 < args.length;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    return true;
  }
  return false;
}

function hasPythonInteractiveFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--' || a === '-c' || a === '-m' || a.startsWith('-c') || a.startsWith('-m')) break;
    if (PYTHON_VALUE_FLAGS.has(a)) { i++; continue; }
    if (!a.startsWith('-')) break;
    if (!a.startsWith('--') && /^-[a-zA-Z]*i[a-zA-Z]*$/.test(a)) return true;
  }
  return false;
}

function isContainerCmdNonInteractive(
  baseCmd: string,
  containerCmdArgs: readonly string[],
  hasStdin: boolean,
): boolean {
  if (hasStdin) return true;
  if (containerCmdArgs.length === 0) return false;
  if (CONTAINER_SHELLS.has(baseCmd)) {
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-c', '--command'])) || hasContainerScriptPositional(containerCmdArgs, SHELL_VALUE_FLAGS);
  }
  if (CONTAINER_JS_RUNTIMES.has(baseCmd)) {
    const ddIdx = containerCmdArgs.indexOf('--');
    const preDd = ddIdx === -1 ? containerCmdArgs : containerCmdArgs.slice(0, ddIdx);
    let firstPos: string | undefined;
    for (let i = 0; i < preDd.length; i++) {
      const a = preDd[i];
      if (a === undefined) continue;
      if (
        a === '--watch' || a.startsWith('--watch=')
        || a === '--watch-path' || a.startsWith('--watch-path=')
        || a === '--inspect' || a.startsWith('--inspect=')
        || a === '--inspect-brk' || a.startsWith('--inspect-brk=')
        || a === '--inspect-wait' || a.startsWith('--inspect-wait=')
      ) {
        return false;
      }
      if (JS_RUNTIME_VALUE_FLAGS.has(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      if (firstPos === undefined) firstPos = a;
    }
    if ((baseCmd === 'bun' && firstPos === 'repl') || (baseCmd === 'deno' && firstPos === 'repl') || (baseCmd === 'tsx' && firstPos === 'watch') || (baseCmd === 'node' && firstPos === 'inspect')) {
      return false;
    }
    return preDd.some(a => matchesContainerFlagOrPrefix(a, ['-e', '--eval', '--print', '-p', '-v', '--version', '-h', '--help'])) || hasContainerScriptPositional(containerCmdArgs, JS_RUNTIME_VALUE_FLAGS);
  }
  if (CONTAINER_PYTHON.has(baseCmd)) {
    const endIdx = containerCmdArgs.findIndex((a, i) => a === '--' || a === '-c' || a.startsWith('-c') || (a === '-m' && containerCmdArgs[i + 1] !== 'pdb'));
    const pre = endIdx === -1 ? containerCmdArgs : containerCmdArgs.slice(0, endIdx);
    if (hasPythonInteractiveFlag(containerCmdArgs) || pre.some((a, i) => a === '-mpdb' || (a === '-m' && pre[i + 1] === 'pdb'))) return false;
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-c', '-m', '-V', '--version', '-h', '--help'])) || hasContainerScriptPositional(containerCmdArgs, PYTHON_VALUE_FLAGS);
  }
  if (CONTAINER_RUBY.has(baseCmd)) {
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-e', '-v', '--version', '-h', '--help'])) || hasContainerScriptPositional(containerCmdArgs, RUBY_VALUE_FLAGS);
  }
  if (CONTAINER_PERL.has(baseCmd)) {
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-e', '-E', '-v', '--version', '-h', '--help'])) || hasContainerScriptPositional(containerCmdArgs, PERL_VALUE_FLAGS);
  }
  if (CONTAINER_PHP.has(baseCmd)) {
    return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-r', '-f', '--file', '-v', '--version', '-h', '--help'])) || hasContainerScriptPositional(containerCmdArgs, PHP_VALUE_FLAGS);
  }
  if (CONTAINER_DB_REPLS.has(baseCmd)) {
    return isContainerDbNonInteractive(baseCmd, containerCmdArgs);
  }
  return containerCmdArgs.some(a => matchesContainerFlagOrPrefix(a, ['-e', '-v', '--version', '-h', '--help'])) || containerCmdArgs.some(a => !a.startsWith('-'));
}

function hasComposeNoTtyBeforeService(args: readonly string[], targetIdx: number): boolean {
  for (let i = targetIdx + 1; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-T' || a === '--no-TTY') return true;
    if (a.startsWith('-')) {
      if (DOCKER_VALUE_FLAG_SET.has(a) && i + 1 < args.length) i++;
      continue;
    }
    break;
  }
  return false;
}

export function guardDockerTtyAndRepl(
  ctx: ExecutionContext,
  isComposeExec: boolean,
  isComposeRun: boolean,
  runExecIdx?: number,
): void {
  const { args, payload } = ctx;
  stripDockerTtyFlags(args, Boolean(payload.stdin), () => {
    if (payload.type === 'command') payload.args = args;
  }, runExecIdx);

  if (isComposeExec || isComposeRun) {
    const targetCmd = isComposeExec ? 'exec' : 'run';
    const targetIndex = runExecIdx !== undefined && runExecIdx >= 0 ? runExecIdx : args.indexOf(targetCmd);
    if (targetIndex !== -1 && !hasComposeNoTtyBeforeService(args, targetIndex)) {
      args.splice(targetIndex + 1, 0, '-T');
      if (payload.type === 'command') payload.args = args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-T' into docker compose ${targetCmd} to forcefully disable TTY allocation... (Frictionless Recovery)`);
    }
  }

  const parsed = extractDockerRunExecCommand(args, runExecIdx);
  if (parsed === null) return;
  const baseCmd = path.posix.basename(parsed.containerCmd.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
  if (CONTAINER_TUI_COMMANDS.has(baseCmd)) {
    const ddIdx = parsed.containerCmdArgs.indexOf('--');
    const preDd = ddIdx === -1 ? parsed.containerCmdArgs : parsed.containerCmdArgs.slice(0, ddIdx);
    const hasMetaHelp = preDd.some(a => ['--help', '-h', '--version', '-V'].includes(a));
    if (!hasMetaHelp) {
      console.error(`\n   💡 AGENT HINT: 'docker ... ${parsed.containerCmd}' launches an interactive TUI application inside the container.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
      process.exit(1);
    }
    return;
  }
  if (!ALL_CONTAINER_REPLS.has(baseCmd)) return;

  if (!isContainerCmdNonInteractive(baseCmd, parsed.containerCmdArgs, Boolean(payload.stdin))) {
    console.error(`\n   💡 AGENT HINT: 'docker ... ${parsed.containerCmd}' targets an interactive shell/REPL inside the container.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Without execution flags (e.g., -c 'command') or a script file or stdin, it will hang indefinitely.`);
    console.error(`   Please provide a command or script to execute: e.g., docker exec <container> ${parsed.containerCmd} -c 'your command'`);
    process.exit(1);
  }
}
