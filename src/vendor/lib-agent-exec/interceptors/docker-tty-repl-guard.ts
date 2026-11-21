// @ts-nocheck
import path from 'node:path';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import type { ExecutionContext } from './types.js';

export const DOCKER_VALUE_FLAGS: readonly string[] = [
  '-v', '--volume', '-p', '--publish', '--name', '-e', '--env', '--env-file',
  '--build-arg', '-f', '--file', '-w', '--workdir', '-u', '--user', '--network',
  '--entrypoint', '-m', '--memory', '--cpus', '--label', '--hostname', '--add-host',
  '--dns', '--cap-add', '--cap-drop', '--device', '--log-driver', '--log-opt',
  '--restart', '--mount', '--tmpfs', '--ulimit', '--pid', '--ipc', '--uts',
  '--userns', '--cgroupns', '--runtime', '--isolation', '--security-opt',
  '--storage-opt', '--sysctl', '--link', '--health-cmd', '--health-interval',
  '--health-retries', '--health-timeout', '--stop-signal', '--stop-timeout',
  '--shm-size', '--gpus', '--ip', '--ip6', '--mac-address',
  '--platform', '--pull', '-l', '-h', '--group-add', '--expose', '--domainname',
  '--blkio-weight', '--cidfile', '--cgroup-parent',
];

const DOCKER_VALUE_FLAG_SET: ReadonlySet<string> = new Set(DOCKER_VALUE_FLAGS);

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

export function stripDockerTtyFlags(
  args: string[],
  hasStdin: boolean,
): void {
  const hasTtyFlag = args.some(arg =>
    /^-([a-zA-Z]*[ti][a-zA-Z]*)$/.test(arg) ||
    arg.startsWith('--tty') ||
    arg.startsWith('--interactive')
  );
  if (!hasTtyFlag) return;

  console.error(`\n   🛠️ AUTONOMOUS HEALING: You attempted to run a Docker command with a TTY flag. Because 'agent-exec.ts' uses \`shell: false\` and pipes stdio, TTY allocation is NOT supported. Automatically stripping TTY flags (-t, --tty) to prevent process hanging... (Frictionless Recovery)`);
  if (!hasStdin) {
    console.error(`   Also stripping interactive flags (-i, --interactive) since no stdin payload was provided.`);
  }

  let stopStripping = false;
  let seenRunOrExec = false;
  const newArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (stopStripping) { newArgs.push(arg); continue; }
    if (!seenRunOrExec) {
      if (arg === 'run' || arg === 'exec') seenRunOrExec = true;
      newArgs.push(arg);
      continue;
    }
    if (!arg.startsWith('-')) {
      const prev = args[i - 1] ?? '';
      if (!DOCKER_VALUE_FLAG_SET.has(prev)) stopStripping = true;
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

  args.length = 0;
  args.push(...newArgs);
}

export function extractDockerRunExecCommand(args: readonly string[]): { containerCmd: string; containerCmdArgs: string[] } | null {
  let foundRunExec = false;
  let skipNextValue = false;
  let containerName: string | null = null;
  let containerCmd: string | null = null;
  const containerCmdArgs: string[] = [];

  for (const arg of args) {
    if (!foundRunExec) {
      if (arg === 'run' || arg === 'exec') foundRunExec = true;
      continue;
    }
    if (skipNextValue) { skipNextValue = false; continue; }
    if (arg === '-T' || arg === '--no-TTY') continue;
    if (!containerCmd && arg.startsWith('-')) {
      if (DOCKER_VALUE_FLAG_SET.has(arg) || (arg.startsWith('--') && arg.includes('='))) {
        if (!arg.includes('=')) skipNextValue = true;
      }
      continue;
    }
    if (!containerName) { containerName = arg; continue; }
    if (!containerCmd) { containerCmd = arg; continue; }
    containerCmdArgs.push(arg);
  }

  if (containerCmd === null) return null;
  return { containerCmd, containerCmdArgs };
}

function isContainerCmdNonInteractive(
  baseCmd: string,
  containerCmdArgs: readonly string[],
  hasStdin: boolean,
): boolean {
  if (hasStdin) return true;
  if (containerCmdArgs.length === 0) return false;
  if (CONTAINER_SHELLS.has(baseCmd)) {
    return containerCmdArgs.some(a => ['-c', '--command'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
  }
  if (CONTAINER_JS_RUNTIMES.has(baseCmd)) {
    return containerCmdArgs.some(a => ['-e', '--eval', '--print', '-p', '-v', '--version', '-h', '--help'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
  }
  if (CONTAINER_PYTHON.has(baseCmd)) {
    return containerCmdArgs.some(a => ['-c', '-m', '-v', '--version', '-h', '--help'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
  }
  if (CONTAINER_RUBY.has(baseCmd)) {
    return containerCmdArgs.some(a => ['-e', '-v', '--version', '-h', '--help'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
  }
  if (CONTAINER_PERL.has(baseCmd)) {
    return containerCmdArgs.some(a => ['-e', '-E', '-v', '--version', '-h', '--help'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
  }
  if (CONTAINER_PHP.has(baseCmd)) {
    return containerCmdArgs.some(a => ['-r', '-v', '--version', '-h', '--help'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
  }
  if (CONTAINER_DB_REPLS.has(baseCmd)) {
    const dbExecFlags = ['-c', '--command', '-e', '--execute', '--eval', '-f', '--file', '-v', '--version', '-h', '--help'];
    if (containerCmdArgs.some(a => dbExecFlags.includes(a))) return true;
    if (baseCmd === 'sqlite3' && containerCmdArgs.filter(a => !a.startsWith('-')).length >= 2) return true;
    if (baseCmd === 'redis-cli' && containerCmdArgs.filter(a => !a.startsWith('-')).length >= 1) return true;
    return false;
  }
  return containerCmdArgs.some(a => ['-e', '-v', '--version', '-h', '--help'].includes(a)) || containerCmdArgs.some(a => !a.startsWith('-'));
}

export function guardDockerTtyAndRepl(
  ctx: ExecutionContext,
  isComposeExec: boolean,
  isComposeRun: boolean,
): void {
  const { args, payload } = ctx;
  stripDockerTtyFlags(args, Boolean(payload.stdin));

  if ((isComposeExec || isComposeRun) && !args.includes('-T')) {
    const targetCmd = isComposeExec ? 'exec' : 'run';
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-T' into docker compose ${targetCmd} to forcefully disable TTY allocation... (Frictionless Recovery)`);
    const targetIndex = args.indexOf(targetCmd);
    if (targetIndex !== -1) args.splice(targetIndex + 1, 0, '-T');
  }

  const parsed = extractDockerRunExecCommand(args);
  if (parsed === null) return;
  const baseCmd = path.posix.basename(parsed.containerCmd.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
  if (!ALL_CONTAINER_REPLS.has(baseCmd)) return;

  if (!isContainerCmdNonInteractive(baseCmd, parsed.containerCmdArgs, Boolean(payload.stdin))) {
    console.error(`\n   💡 AGENT HINT: 'docker ... ${parsed.containerCmd}' targets an interactive shell/REPL inside the container.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Without execution flags (e.g., -c 'command') or a script file or stdin, it will hang indefinitely.`);
    console.error(`   Please provide a command or script to execute: e.g., docker exec <container> ${parsed.containerCmd} -c 'your command'`);
    process.exit(1);
  }
}
