// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import {
  GH_SUBCMD_BOOL_OVERLAP,
  GH_VALUE_FLAGS,
  collectCliSubcommands,
  handleGhCommandGuards,
  normalizeGhJsonAndJqArgs,
} from './cloud-cli-gh.js';
import { ExecutionContext } from './types.js';

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

function normalizeCloudBaseCmd(cmdBasename: string): string {
  return cmdBasename.toLowerCase().replace(/\.(?:exe|cmd)$/i, '');
}

function handleCloudAndPackageAuth(cmdBasename: string, args: string[], onSync?: () => void): void {
  const preDd = sliceBeforeDoubleDash(args);
  const baseCmd = normalizeCloudBaseCmd(cmdBasename);
  if (CLOUD_CLI_BASE_CMDS.has(baseCmd)) {
    const cloudPos = collectCliSubcommands(args, CLOUD_VALUE_FLAGS);
    const sub0 = cloudPos[0] ?? '';
    if (sub0 === 'login' || sub0 === 'auth:login' || /^login:/i.test(sub0) || (sub0 === 'auth' && cloudPos[1] === 'login')) {
      exitBlocked(`'${cmdBasename} ${sub0 || 'login'}' is highly interactive and will hang. Use API tokens via environment variables instead.`);
    }
    if (['init', 'create'].includes(sub0) && !preDd.includes('-y') && !preDd.includes('--yes')) {
      const ddIdx = args.indexOf('--');
      if (ddIdx !== -1) args.splice(ddIdx, 0, '-y');
      else args.push('-y');
      onSync?.();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} ${sub0}' is highly interactive. Automatically injecting '-y' to prevent hanging... (Frictionless Recovery)`);
    }
  }

  if (TRACKER_BASE_CMDS.has(baseCmd)) {
    const trackerPos = collectCliSubcommands(args, CLOUD_VALUE_FLAGS);
    if ((trackerPos[0] === 'login' || trackerPos[0] === 'auth') && !hasAnyFlagOrPrefix(preDd, ['--token'])) {
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
    if (['apply', 'destroy'].includes(subCmd) && !hasPlanFile && !preDd.includes('-auto-approve')) {
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

function resolveValueFlagsForHelp(cmdBasename: string): ReadonlySet<string> {
  const baseCmd = normalizeCloudBaseCmd(cmdBasename);
  if (baseCmd === 'gh') return GH_VALUE_FLAGS;
  if (baseCmd === 'az') return AZ_VALUE_FLAGS;
  if (baseCmd === 'ansible-vault') return ANSIBLE_VAULT_VALUE_FLAGS;
  if (baseCmd === 'gcloud') return GCLOUD_VALUE_FLAGS;
  if (baseCmd === 'terraform' || baseCmd === 'tofu') return TF_VALUE_FLAGS;
  if (baseCmd === 'cargo') return CARGO_VALUE_FLAGS;
  if (baseCmd === 'aws') return AWS_VALUE_FLAGS;
  return CLOUD_VALUE_FLAGS;
}

function hasPreDashHelpFlag(args: readonly string[], valueFlags: ReadonlySet<string>): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--help' || arg === '-h') return true;
    const next = args[i + 1] ?? '';
    const isBoolOverlap = valueFlags === GH_VALUE_FLAGS && GH_SUBCMD_BOOL_OVERLAP.has(arg) && next.startsWith('-');
    if (arg.startsWith('-') && valueFlags.has(arg) && !isBoolOverlap) i++;
  }
  return false;
}

function handleInfraAuthGuards(cmdBasename: string, args: readonly string[], envOverrides: Record<string, string>): void {
  if (['az', 'az.cmd', 'az.exe'].includes(cmdBasename)) {
    envOverrides['AZURE_CORE_NO_COLOR'] = '1';
    envOverrides['AZURE_CORE_COLLECT_TELEMETRY'] = '0';
    const subCmd = collectCliSubcommands(args, AZ_VALUE_FLAGS)[0];
    if (subCmd === 'interactive') exitBlocked(`'az interactive' opens an interactive shell and will hang. Blocking execution.`);
    if (subCmd === 'login') {
      const loginFlags = sliceBeforeDoubleDash(args);
      if (!loginFlags.some(a => ['--service-principal', '--identity', '--managed-identity', '-i'].includes(a))) {
        exitBlocked(`'az login' without --service-principal/--identity is interactive. Blocking execution.`);
      }
    }
  }

  if (['ansible-vault', 'ansible-vault.exe'].includes(cmdBasename)) {
    const avFlags = sliceBeforeDoubleDash(args);
    if (avFlags.includes('--version')) return;
    if (avFlags.some(a => a === '--ask-vault-pass' || a === '--ask-vault-password' || a === '-J')) {
      exitBlocked(`'ansible-vault --ask-vault-pass/-J' prompts interactively for a password. Use '--vault-password-file' or '--vault-id'.`);
    }
    if (!hasAnyFlagOrPrefix(avFlags, ['--vault-password-file', '--vault-id'])) {
      exitBlocked(`'ansible-vault' without --vault-password-file or --vault-id will prompt for a password. Blocking execution.`);
    }
    const avPos = collectCliSubcommands(args, ANSIBLE_VAULT_VALUE_FLAGS);
    if (avPos[0] === 'rekey' && !hasAnyFlagOrPrefix(avFlags, ['--new-vault-password-file', '--new-vault-id'])) {
      exitBlocked(`'ansible-vault rekey' without --new-vault-password-file or --new-vault-id will prompt for the new password. Blocking execution.`);
    }
  }
}

function hasPreDashGhWebFlag(args: readonly string[], posArgs: readonly string[]): boolean {
  const isRunListWorkflow = posArgs[0] === 'run' && posArgs[1] === 'list';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--web' || (arg === '-w' && !isRunListWorkflow)) return true;
    const next = args[i + 1] ?? '';
    if (isRunListWorkflow && arg === '-w' && !next.startsWith('-')) {
      i++;
      continue;
    }
    const isBoolOverlap = GH_SUBCMD_BOOL_OVERLAP.has(arg) && next.startsWith('-');
    if (arg.startsWith('-') && GH_VALUE_FLAGS.has(arg) && !isBoolOverlap) i++;
  }
  return false;
}

export function cloudCliInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  const safeArgs = args;
  if (hasPreDashHelpFlag(safeArgs, resolveValueFlagsForHelp(cmdBasename))) return;
  const syncArgs = (): void => { if (payload.type === 'command') payload.args = safeArgs; };

  handleCloudAndPackageAuth(cmdBasename, safeArgs, syncArgs);

  const ghCmds = ['gh', 'gh.exe', 'gh.cmd'];
  if (ghCmds.includes(cmdBasename) && payload.type === 'command') {
    envOverrides['GH_PROMPT_DISABLED'] = '1';
    envOverrides['GH_NO_UPDATE_NOTIFIER'] = '1';
    envOverrides['NO_COLOR'] = '1';
    envOverrides['GH_PAGER'] = '';
    const posArgs = collectCliSubcommands(safeArgs, GH_VALUE_FLAGS);
    if (hasPreDashGhWebFlag(safeArgs, posArgs)) exitBlocked(`'gh ... --web/-w' attempts to open a browser window and will hang indefinitely. Blocking execution.`);
    normalizeGhJsonAndJqArgs(safeArgs, syncArgs);
    handleGhCommandGuards(safeArgs, posArgs, payload.stdin, syncArgs);
  }

  handleInfraAuthGuards(cmdBasename, safeArgs, envOverrides);
}
