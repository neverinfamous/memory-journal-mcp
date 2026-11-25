// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import {
  GH_VALUE_FLAGS,
  collectCliSubcommands,
  handleGhCommandGuards,
  isGhBooleanOverlap,
  normalizeGhJsonAndJqArgs,
  unpackGhShortCluster,
} from './cloud-cli-gh.js';
import { type ExecutionContext } from './types.js';

const CLOUD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--config', '-c', '--cwd', '--env', '--profile', '--project', '--token', '--api-key', '--team',
]);
const GCLOUD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--project', '--configuration', '--account', '--impersonate-service-account', '--format', '--verbosity', '--billing-project',
]);
const CARGO_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--manifest-path', '--target-dir', '--package', '-p', '--features', '--bin',
]);
const AWS_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--profile', '--region', '--output', '--endpoint-url',
]);
const TF_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-chdir', '-var', '-var-file', '-target', '-replace', '-state', '-state-out', '-backup', '-lock-timeout', '-parallelism',
]);

function exitBlocked(hint: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

const CLOUD_CLI_BASE_CMDS = new Set([
  'wrangler', 'vercel', 'netlify', 'firebase', 'heroku', 'supabase', 'stripe', 'fly', 'flyctl', 'expo', 'eas',
]);
const TRACKER_BASE_CMDS = new Set(['jira', 'linear', 'slack']);

const ALL_CLOUD_INTERCEPTOR_CMDS: ReadonlySet<string> = new Set([
  ...CLOUD_CLI_BASE_CMDS,
  ...TRACKER_BASE_CMDS,
  'gh', 'az', 'ansible-vault', 'gcloud', 'terraform', 'tofu', 'cargo', 'aws',
]);
const CLOUD_INTERACTIVE_INIT_SET: ReadonlySet<string> = new Set(['init', 'create']);
const TF_APPLY_DESTROY_SET: ReadonlySet<string> = new Set(['apply', 'destroy']);
const AZ_IDENTITY_FLAGS: ReadonlySet<string> = new Set(['--service-principal', '--identity', '--managed-identity', '-i']);

const CLOUD_CMD_EXT_RE = /\.(?:exe|cmd)$/i;
const CLOUD_LOGIN_PREFIX_RE = /^login:/i;
const TRACKER_TOKEN_FLAGS: readonly string[] = ['--token'];
const ANSIBLE_SHORT_J_RE = /^-[v]*J[v]*$/;
const ANSIBLE_VAULT_PASS_FLAGS: readonly string[] = ['--vault-password-file', '--vault-id'];
const ANSIBLE_REKEY_PASS_FLAGS: readonly string[] = ['--new-vault-password-file', '--new-vault-id'];

function normalizeCloudBaseCmd(cmdBasename: string): string {
  return cmdBasename.toLowerCase().replace(CLOUD_CMD_EXT_RE, '');
}

function handleCloudAndPackageAuth(cmdBasename: string, baseCmd: string, args: string[], onSync?: () => void): void {
  const preDd = sliceBeforeDoubleDash(args);
  if (CLOUD_CLI_BASE_CMDS.has(baseCmd)) {
    const cloudPos = collectCliSubcommands(args, CLOUD_VALUE_FLAGS);
    const sub0 = cloudPos[0] ?? '';
    if (sub0 === 'login' || sub0 === 'auth:login' || CLOUD_LOGIN_PREFIX_RE.test(sub0) || (sub0 === 'auth' && cloudPos[1] === 'login')) {
      exitBlocked(`'${cmdBasename} ${sub0 || 'login'}' is highly interactive and will hang. Use API tokens via environment variables instead.`);
    }
    if (CLOUD_INTERACTIVE_INIT_SET.has(sub0) && !preDd.includes('-y') && !preDd.includes('--yes')) {
      const ddIdx = args.indexOf('--');
      if (ddIdx !== -1) args.splice(ddIdx, 0, '-y');
      else args.push('-y');
      onSync?.();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} ${sub0}' is highly interactive. Automatically injecting '-y' to prevent hanging... (Frictionless Recovery)`);
    }
  }

  if (TRACKER_BASE_CMDS.has(baseCmd)) {
    const trackerPos = collectCliSubcommands(args, CLOUD_VALUE_FLAGS);
    if ((trackerPos[0] === 'login' || trackerPos[0] === 'auth') && !hasAnyFlagOrPrefix(preDd, TRACKER_TOKEN_FLAGS)) {
      exitBlocked(`'${cmdBasename} login/auth' is interactive. Blocking execution. Use '--token' to bypass.`);
    }
  }

  if (baseCmd === 'cargo') {
    const cargoPos = collectCliSubcommands(args, CARGO_VALUE_FLAGS);
    if (cargoPos[0] === 'login' || cargoPos[0] === 'publish') {
      exitBlocked(`'cargo login/publish' is interactive. Blocking execution.`);
    }
  }

  if (baseCmd === 'aws') {
    const awsPos = collectCliSubcommands(args, AWS_VALUE_FLAGS);
    if (awsPos[0] === 'configure') {
      exitBlocked(`'aws configure' is interactive. Use environment variables instead.`);
    }
  }

  if (baseCmd === 'gcloud') {
    const gPos = collectCliSubcommands(args, GCLOUD_VALUE_FLAGS);
    const isInteractiveAuth = gPos[0] === 'auth' && (gPos[1] === 'login' || (gPos[1] === 'application-default' && gPos[2] !== 'print-access-token'));
    if (isInteractiveAuth) {
      exitBlocked(`'gcloud auth login' / 'application-default' is interactive. Use service accounts instead.`);
    }
  }

  if (baseCmd === 'terraform' || baseCmd === 'tofu') {
    const tfPos = collectCliSubcommands(args, TF_VALUE_FLAGS);
    const subCmd = tfPos[0] ?? '';
    const hasPlanFile = subCmd === 'apply' && tfPos.length > 1;
    if (TF_APPLY_DESTROY_SET.has(subCmd) && !hasPlanFile && !preDd.includes('-auto-approve')) {
      let subIdx = -1;
      for (let k = 0; k < args.length; k++) {
        const a = args[k];
        if (a === undefined || a === '--') break;
        if (TF_VALUE_FLAGS.has(a)) { k++; continue; }
        if (!a.startsWith('-')) { subIdx = k; break; }
      }
      args.splice(subIdx !== -1 ? subIdx + 1 : args.length, 0, '-auto-approve');
      onSync?.();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-auto-approve' into ${cmdBasename} ${subCmd} to prevent prompt hanging... (Frictionless Recovery)`);
    }
  }
}

function sliceBeforeDoubleDash(args: readonly string[]): readonly string[] {
  const ddIdx = args.indexOf('--');
  return ddIdx === -1 ? args : args.slice(0, ddIdx);
}

function hasAnyFlagOrPrefix(flags: readonly string[], names: readonly string[]): boolean {
  return flags.some(a => names.some(f => a === f || a.startsWith(`${f}=`)));
}

const AZ_VALUE_FLAGS: ReadonlySet<string> = new Set(['--subscription', '--output', '-o', '--query']);
const ANSIBLE_VAULT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--vault-password-file', '--vault-id', '--new-vault-password-file', '--new-vault-id', '--output',
]);

function resolveValueFlagsForHelp(baseCmd: string): ReadonlySet<string> {
  if (baseCmd === 'gh') return GH_VALUE_FLAGS;
  if (baseCmd === 'az') return AZ_VALUE_FLAGS;
  if (baseCmd === 'ansible-vault') return ANSIBLE_VAULT_VALUE_FLAGS;
  if (baseCmd === 'gcloud') return GCLOUD_VALUE_FLAGS;
  if (baseCmd === 'terraform' || baseCmd === 'tofu') return TF_VALUE_FLAGS;
  if (baseCmd === 'cargo') return CARGO_VALUE_FLAGS;
  if (baseCmd === 'aws') return AWS_VALUE_FLAGS;
  return CLOUD_VALUE_FLAGS;
}

function hasPreDashHelpFlag(args: readonly string[], valueFlags: ReadonlySet<string>, ghPosArgs: readonly string[]): boolean {
  const isGh = valueFlags === GH_VALUE_FLAGS;
  const isRepoHomepage = isGh && ghPosArgs[0] === 'repo' && (ghPosArgs[1] === 'create' || ghPosArgs[1] === 'edit');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--help' || (arg === '-h' && !isRepoHomepage)) return true;
    if (isGh) {
      const cluster = unpackGhShortCluster(arg, ghPosArgs);
      if (cluster !== null) {
        if (!isRepoHomepage && cluster.flags.includes('-h')) return true;
        if (cluster.consumesNext) i++;
        continue;
      }
    }
    const isBoolOverlap = isGh && isGhBooleanOverlap(arg, ghPosArgs);
    if (arg.startsWith('-') && (valueFlags.has(arg) || (isRepoHomepage && arg === '-h')) && !isBoolOverlap) i++;
  }
  return false;
}

function handleInfraAuthGuards(baseCmd: string, args: readonly string[], envOverrides: Record<string, string>): void {
  if (baseCmd === 'az') {
    envOverrides['AZURE_CORE_NO_COLOR'] = '1';
    envOverrides['AZURE_CORE_COLLECT_TELEMETRY'] = '0';
    const subCmd = collectCliSubcommands(args, AZ_VALUE_FLAGS)[0];
    if (subCmd === 'interactive') exitBlocked(`'az interactive' opens an interactive shell and will hang. Blocking execution.`);
    if (subCmd === 'login') {
      const loginFlags = sliceBeforeDoubleDash(args);
      if (!loginFlags.some(a => AZ_IDENTITY_FLAGS.has(a))) {
        exitBlocked(`'az login' without --service-principal/--identity is interactive. Blocking execution.`);
      }
    }
  }

  if (baseCmd === 'ansible-vault') {
    const avFlags = sliceBeforeDoubleDash(args);
    if (avFlags.includes('--version')) return;
    if (avFlags.some(a => a === '--ask-vault-pass' || a === '--ask-vault-password' || a === '-J' || (!a.startsWith('--') && ANSIBLE_SHORT_J_RE.test(a)))) {
      exitBlocked(`'ansible-vault --ask-vault-pass/-J' prompts interactively for a password. Use '--vault-password-file' or '--vault-id'.`);
    }
    if (!hasAnyFlagOrPrefix(avFlags, ANSIBLE_VAULT_PASS_FLAGS)) {
      exitBlocked(`'ansible-vault' without --vault-password-file or --vault-id will prompt for a password. Blocking execution.`);
    }
    const avPos = collectCliSubcommands(args, ANSIBLE_VAULT_VALUE_FLAGS);
    if (avPos[0] === 'edit' || avPos[0] === 'create') {
      exitBlocked(`'ansible-vault ${avPos[0]}' opens an interactive editor ($EDITOR) and will hang headlessly. Blocking execution.`);
    }
    if (avPos[0] === 'rekey' && !hasAnyFlagOrPrefix(avFlags, ANSIBLE_REKEY_PASS_FLAGS)) {
      exitBlocked(`'ansible-vault rekey' without --new-vault-password-file or --new-vault-id will prompt for the new password. Blocking execution.`);
    }
  }
}

function hasPreDashGhWebFlag(args: readonly string[], posArgs: readonly string[]): boolean {
  const isRunListWorkflow = posArgs[0] === 'run' && posArgs[1] === 'list';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    const lowArg = arg.toLowerCase();
    const isTruthyWebEq = (lowArg.startsWith('--web=') && lowArg !== '--web=false' && lowArg !== '--web=0')
      || (!isRunListWorkflow && arg.startsWith('-w=') && lowArg !== '-w=false' && lowArg !== '-w=0');
    if (arg === '--web' || isTruthyWebEq || (arg === '-w' && !isRunListWorkflow)) return true;
    const next = args[i + 1] ?? '';
    const cluster = unpackGhShortCluster(arg, posArgs);
    if (cluster !== null) {
      if (!isRunListWorkflow && cluster.flags.includes('-w')) return true;
      if (cluster.consumesNext || (isRunListWorkflow && cluster.flags[cluster.flags.length - 1] === '-w' && !next.startsWith('-'))) {
        i++;
      }
      continue;
    }
    if (isRunListWorkflow && arg === '-w' && !next.startsWith('-')) {
      i++;
      continue;
    }
    const isBoolOverlap = isGhBooleanOverlap(arg, posArgs);
    if (arg.startsWith('-') && GH_VALUE_FLAGS.has(arg) && !isBoolOverlap) i++;
  }
  return false;
}

export function cloudCliInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  const baseCmd = normalizeCloudBaseCmd(cmdBasename);
  if (!ALL_CLOUD_INTERCEPTOR_CMDS.has(baseCmd)) return;
  const safeArgs = args;
  const ghPosArgs = baseCmd === 'gh' ? collectCliSubcommands(safeArgs, GH_VALUE_FLAGS) : [];
  if (hasPreDashHelpFlag(safeArgs, resolveValueFlagsForHelp(baseCmd), ghPosArgs)) return;
  const syncArgs = (): void => { if (payload.type === 'command') payload.args = safeArgs; };

  handleCloudAndPackageAuth(cmdBasename, baseCmd, safeArgs, syncArgs);

  if (baseCmd === 'gh' && payload.type === 'command') {
    envOverrides['GH_PROMPT_DISABLED'] = '1';
    envOverrides['GH_NO_UPDATE_NOTIFIER'] = '1';
    envOverrides['NO_COLOR'] = '1';
    envOverrides['GH_PAGER'] = '';
    if (hasPreDashGhWebFlag(safeArgs, ghPosArgs)) exitBlocked(`'gh ... --web/-w' attempts to open a browser window and will hang indefinitely. Blocking execution.`);
    const jsonChangedPos = normalizeGhJsonAndJqArgs(safeArgs, syncArgs, ghPosArgs);
    const activePosArgs = jsonChangedPos ? collectCliSubcommands(safeArgs, GH_VALUE_FLAGS) : ghPosArgs;
    handleGhCommandGuards(safeArgs, activePosArgs, payload.stdin, syncArgs);
  }

  handleInfraAuthGuards(baseCmd, safeArgs, envOverrides);
}
