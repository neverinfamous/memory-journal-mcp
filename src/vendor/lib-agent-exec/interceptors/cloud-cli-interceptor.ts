// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';

const CLOUD_VALUE_FLAGS = new Set([
  '--config', '-c', '--cwd', '--env', '--profile', '--project', '--token', '--api-key', '--team',
]);
const GCLOUD_VALUE_FLAGS = new Set([
  '--project', '--configuration', '--account', '--impersonate-service-account', '--format', '--verbosity', '--billing-project',
]);
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);

function collectSubcommands(args: readonly string[], valueFlags: ReadonlySet<string>): string[] {
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-')) {
      if (valueFlags.has(arg) && i + 1 < args.length && !(args[i + 1] ?? '').startsWith('-')) {
        i++;
      }
      continue;
    }
    pos.push(arg);
  }
  return pos;
}

function handleCloudAndPackageAuth(cmdBasename: string, args: string[]): void {
  const cloudCliCmds = [
    'wrangler', 'vercel', 'netlify', 'firebase', 'heroku', 'supabase', 'stripe', 'fly', 'flyctl', 'expo', 'eas',
    'wrangler.cmd', 'vercel.cmd', 'netlify.cmd', 'firebase.cmd', 'heroku.cmd', 'supabase.cmd',
    'stripe.exe', 'fly.exe', 'flyctl.exe', 'expo.cmd', 'eas.cmd',
  ];
  const cloudPos = collectSubcommands(args, CLOUD_VALUE_FLAGS);
  if (cloudCliCmds.includes(cmdBasename)) {
    if (cloudPos[0] === 'login' || (cloudPos[0] === 'auth' && cloudPos[1] === 'login')) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} login' is highly interactive and will hang. Use API tokens via environment variables instead.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    const subCmd = cloudPos[0] ?? '';
    if (['init', 'create'].includes(subCmd) && !args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} ${subCmd}' is highly interactive. Automatically injecting '-y' to prevent hanging... (Frictionless Recovery)`);
      args.push('-y');
    }
  }

  const trackerCmds = ['jira', 'jira.exe', 'jira.cmd', 'linear', 'linear.exe', 'linear.cmd', 'slack', 'slack.exe', 'slack.cmd'];
  if (trackerCmds.includes(cmdBasename)) {
    const trackerPos = collectSubcommands(args, CLOUD_VALUE_FLAGS);
    if ((trackerPos[0] === 'login' || trackerPos[0] === 'auth') && !args.includes('--token')) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} login/auth' is interactive. Blocking execution. Use '--token' to bypass.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }

  if (['cargo', 'cargo.exe'].includes(cmdBasename)) {
    const cargoPos = collectSubcommands(args, new Set(['--manifest-path', '--target-dir', '--package', '-p', '--features', '--bin']));
    if (cargoPos[0] === 'login' || cargoPos[0] === 'publish') {
      console.error(`\n   💡 AGENT HINT: 'cargo login/publish' is interactive. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }

  if (['aws', 'aws.exe', 'aws.cmd'].includes(cmdBasename)) {
    const awsPos = collectSubcommands(args, new Set(['--profile', '--region', '--output', '--endpoint-url']));
    if (awsPos[0] === 'configure') {
      console.error(`\n   💡 AGENT HINT: 'aws configure' is interactive. Use environment variables instead.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }

  if (['gcloud', 'gcloud.cmd'].includes(cmdBasename)) {
    const gPos = collectSubcommands(args, GCLOUD_VALUE_FLAGS);
    const isInteractiveAuth = gPos[0] === 'auth' && (gPos[1] === 'login' || (gPos[1] === 'application-default' && gPos[2] !== 'print-access-token'));
    if (isInteractiveAuth) {
      console.error(`\n   💡 AGENT HINT: 'gcloud auth login' / 'application-default' is interactive. Use service accounts instead.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }

  if (['terraform', 'terraform.exe', 'tofu', 'tofu.exe'].includes(cmdBasename)) {
    const tfPos = collectSubcommands(args, new Set(['-chdir']));
    const subCmd = tfPos[0] ?? '';
    if (['apply', 'destroy'].includes(subCmd) && !args.includes('-auto-approve')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-auto-approve' into ${cmdBasename} ${subCmd} to prevent prompt hanging... (Frictionless Recovery)`);
      args.push('-auto-approve');
    }
  }
}

function normalizeGhJsonAndJqArgs(args: string[]): void {
  for (let i = 0; i < args.length; i++) {
    const currentArg = args[i];
    if (currentArg === undefined) continue;
    if (currentArg === '--json' && i + 1 < args.length) {
      const fields: string[] = [];
      let j = i + 1;
      let sawCommaToken = false;
      while (j < args.length) {
        const tok = args[j];
        if (tok === undefined || tok.startsWith('-') || /^\d+$/.test(tok) || /^https?:\/\//i.test(tok)) break;
        fields.push(tok);
        j++;
        if (tok.includes(',')) sawCommaToken = true;
        if (sawCommaToken && !tok.endsWith(',')) break;
      }
      if (fields.length > 0) {
        const rawJoined = fields.join(',');
        const normalized = rawJoined.trim().split(/[\s,]+/).filter(Boolean).join(',');
        if (fields.length > 1 || rawJoined !== normalized) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${fields.join(' ')}' to '${normalized}'... (Frictionless Recovery)`);
          args.splice(i + 1, fields.length, normalized);
        }
      }
    } else if (currentArg.startsWith('--json=')) {
      const jsonVal = currentArg.slice('--json='.length);
      if (jsonVal.includes(' ') || jsonVal.includes(', ')) {
        const normalized = jsonVal.trim().split(/[\s,]+/).filter(Boolean).join(',');
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${jsonVal}' to '${normalized}'... (Frictionless Recovery)`);
        args[i] = `--json=${normalized}`;
      }
    } else if (currentArg === '--jq' && i + 1 < args.length) {
      const jqArg = args[i + 1];
      if (jqArg !== undefined && jqArg.includes('\\"')) {
        const normalized = jqArg.replace(/\\"/g, '"');
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqArg}' to '${normalized}'... (Frictionless Recovery)`);
        args[i + 1] = normalized;
      }
    } else if (currentArg.startsWith('--jq=')) {
      const jqVal = currentArg.slice('--jq='.length);
      if (jqVal.includes('\\"')) {
        const normalized = jqVal.replace(/\\"/g, '"');
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqVal}' to '${normalized}'... (Frictionless Recovery)`);
        args[i] = `--jq=${normalized}`;
      }
    }
  }
}

function exitBlockedGh(hint: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

function handleGhPrAndRepoCreateGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: readonly string[],
  hasFlagWithPrefix: (flags: readonly string[]) => boolean,
): boolean {
  return match([subCmd1, subCmd2])
    .with(['pr', 'create'], () => {
      const hasFill = args.includes('--fill') || args.includes('--fill-first') || args.includes('--fill-verbose');
      if (!hasFill && !(hasFlagWithPrefix(['--title', '-t']) && hasFlagWithPrefix(['--body', '-b', '--body-file', '-F']))) {
        exitBlockedGh(`'gh pr create' is interactive without '--fill', or BOTH '--title' and '--body'. Blocking execution to prevent hanging.`);
      }
      return true;
    })
    .with(['pr', 'merge'], () => {
      if (!args.includes('--auto') && !args.includes('--merge') && !args.includes('--squash') && !args.includes('--rebase')) {
        exitBlockedGh(`'gh pr merge' requires a merge strategy (--merge, --squash, --rebase, --auto) to be non-interactive. Blocking execution.`);
      }
      return true;
    })
    .with(['issue', 'create'], () => {
      if (!(hasFlagWithPrefix(['--title', '-t']) && hasFlagWithPrefix(['--body', '-b', '--body-file', '-F']))) {
        exitBlockedGh(`'gh issue create' is interactive without BOTH '--title' and '--body'. Blocking execution to prevent hanging.`);
      }
      return true;
    })
    .with(['repo', 'create'], () => {
      if (!args.includes('--public') && !args.includes('--private') && !args.includes('--internal')) {
        exitBlockedGh(`'gh repo create' is interactive without visibility flags (--public/--private). Blocking execution.`);
      }
      return true;
    })
    .with(['pr', 'review'], () => {
      if (!args.includes('--approve') && !args.includes('--request-changes') && !args.includes('--comment')) {
        exitBlockedGh(`'gh pr review' is interactive without a review type flag (--approve/--request-changes/--comment). Blocking execution.`);
      }
      return true;
    })
    .otherwise(() => false);
}

function handleGhReleaseRepoSecretGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: readonly string[],
  posArgs: readonly string[],
  stdin: string | undefined,
  hasFlagWithPrefix: (flags: readonly string[]) => boolean,
): boolean {
  return match([subCmd1, subCmd2])
    .with(['auth', P.union('login', 'refresh')], () => {
      if (!args.includes('--with-token')) {
        exitBlockedGh(`'gh auth ${subCmd2}' is highly interactive. Provide a token via stdin and use '--with-token'.`);
      }
      return true;
    })
    .with(['release', 'create'], () => {
      const releaseFlags = ['--title', '-t', '--notes', '-n', '--notes-file', '-F'];
      if (!hasFlagWithPrefix(releaseFlags) && !args.includes('--generate-notes') && !args.includes('--notes-from-tag')) {
        exitBlockedGh(`'gh release create' is interactive without release notes flags (--title, --notes, --notes-file, -F, -t, -n, --generate-notes, --notes-from-tag). Blocking execution.`);
      }
      return true;
    })
    .with(['release', 'delete'], () => {
      if (!args.includes('-y') && !args.includes('--yes')) exitBlockedGh(`'gh release delete' is interactive without '--yes'. Blocking execution.`);
      return true;
    })
    .with(['repo', 'delete'], () => {
      if (!args.includes('--yes')) exitBlockedGh(`'gh repo delete' is interactive without '--yes'. Blocking execution.`);
      return true;
    })
    .with([P.union('secret', 'variable'), 'set'], () => {
      const hasValueFlag = hasFlagWithPrefix(['--body', '-b', '--env-file', '-f']);
      const hasStdin = stdin !== undefined && stdin.length > 0;
      const hasPositionalVarValue = subCmd1 === 'variable' && posArgs.length >= 4;
      if (!hasValueFlag && !hasStdin && !hasPositionalVarValue) {
        exitBlockedGh(`'gh ${subCmd1} set' requires '--body'/'-b', '--env-file'/'-f', or stdin. Blocking execution to prevent interactive prompt.`);
      }
      return true;
    })
    .otherwise(() => false);
}

function handleGhEditAndRunGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: string[],
  posArgs: readonly string[],
  stdin: string | undefined,
  hasFlagWithPrefix: (flags: readonly string[]) => boolean,
): boolean {
  return match([subCmd1, subCmd2])
    .with(['run', 'view'], () => {
      if (args.includes('--log')) {
        console.error(`\n   💡 AGENT HINT: If the job is still in progress, 'gh run view --log' will fail with code 1. Do NOT poll in a tight loop. Instead, use your 'schedule' tool to set a 60-second timer to wait asynchronously.\n`);
        process.exit(1);
      }
      if (!args.includes('--json') && !args.includes('--log-failed') && !args.includes('--exit-status') && !args.some(a => a === '-v' || a.startsWith('--verbose'))) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh run view command to output structured data... (Frictionless Recovery)`);
        args.push('--json', 'databaseId,name,status,conclusion,url');
      }
      return true;
    })
    .with(['run', 'watch'], () => exitBlockedGh(`'gh run watch' is interactive/runs indefinitely. Blocking execution.`))
    .with(['issue', 'edit'], () => {
      const issueEditFlags = ['--title', '-t', '--body', '-b', '--body-file', '-F', '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--add-project', '--remove-project', '--milestone', '-m', '--remove-milestone'];
      if (!hasFlagWithPrefix(issueEditFlags)) exitBlockedGh(`'gh issue edit' is interactive without modification flags. Blocking execution.`);
      return true;
    })
    .with(['pr', 'edit'], () => {
      const prEditFlags = ['--title', '-t', '--body', '-b', '--body-file', '-F', '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--add-reviewer', '--remove-reviewer', '--add-project', '--remove-project', '--milestone', '-m', '--remove-milestone', '--base', '-B'];
      if (!hasFlagWithPrefix(prEditFlags)) exitBlockedGh(`'gh pr edit' is interactive without modification flags. Blocking execution.`);
      return true;
    })
    .with(['run', P.union('rerun', 'download')], ([, action]) => {
      if (args.length <= 2) exitBlockedGh(`'gh run ${action}' is interactive without a run ID. Blocking execution.`);
      return true;
    })
    .with(['issue', 'transfer'], () => {
      if (args.length <= 3) exitBlockedGh(`'gh issue transfer' is interactive without issue and repo args. Blocking execution.`);
      return true;
    })
    .with(['codespace', 'ssh'], () => exitBlockedGh(`'gh codespace ssh' runs an interactive shell. Blocking execution.`))
    .with(['gist', 'create'], () => {
      if (args.length <= 2 && !stdin) exitBlockedGh(`'gh gist create' is interactive without files or stdin. Blocking execution.`);
      return true;
    })
    .otherwise(() => false);
}

function handleGhReadJsonGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: string[],
  posArgs: readonly string[],
): void {
  match([subCmd1, subCmd2])
    .with(['pr', 'checkout'], () => {
      if (posArgs.length <= 2) exitBlockedGh(`'gh pr checkout' without a PR number opens an interactive picker. Blocking execution.`);
    })
    .with(['browse', P._], () => exitBlockedGh(`'gh browse' opens a browser window which is not available in headless mode. Blocking execution.`))
    .with(['label', 'create'], () => {
      if (!args.includes('--name') && !args.some(a => a.startsWith('--name=')) && posArgs.length <= 2) {
        exitBlockedGh(`'gh label create' is interactive without a label name. Blocking execution.`);
      }
    })
    .with([P.union('pr', 'issue', 'repo', 'run', 'release'), P.union('list', 'status', 'view')], () => {
      if (!args.some(a => a === '--json' || a.startsWith('--json='))) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh command to output structured data... (Frictionless Recovery)`);
        let jsonFields = 'url';
        if (subCmd1 === 'pr' || subCmd1 === 'issue') jsonFields = 'number,title,state,url';
        if (subCmd1 === 'repo') jsonFields = 'name,owner,url';
        if (subCmd1 === 'run') jsonFields = 'databaseId,name,status,conclusion,url';
        if (subCmd1 === 'release') jsonFields = 'tagName,name,createdAt,isDraft,isPrerelease';
        args.push('--json', jsonFields);
      }
    })
    .with(['search', P._], () => {
      if (!args.some(a => a === '--json' || a.startsWith('--json='))) {
        exitBlockedGh(`'gh search' requires '--json' to output structured data. Blocking execution.`);
      }
    })
    .otherwise(() => {});
}

function handleGhCommandGuards(args: string[], posArgs: string[], stdin: string | undefined): void {
  const subCmd1 = posArgs[0];
  const subCmd2 = posArgs[1];
  const hasFlagWithPrefix = (flags: readonly string[]): boolean =>
    args.some(a => flags.includes(a) || flags.some(f => a.startsWith(`${f}=`)));
  if (handleGhPrAndRepoCreateGuards(subCmd1, subCmd2, args, hasFlagWithPrefix)) return;
  if (handleGhReleaseRepoSecretGuards(subCmd1, subCmd2, args, posArgs, stdin, hasFlagWithPrefix)) return;
  if (handleGhEditAndRunGuards(subCmd1, subCmd2, args, posArgs, stdin, hasFlagWithPrefix)) return;
  handleGhReadJsonGuards(subCmd1, subCmd2, args, posArgs);
}

function handleInfraAuthGuards(cmdBasename: string, args: readonly string[], envOverrides: Record<string, string>): void {
  if (['az', 'az.cmd', 'az.exe'].includes(cmdBasename)) {
    envOverrides['AZURE_CORE_NO_COLOR'] = '1';
    envOverrides['AZURE_CORE_COLLECT_TELEMETRY'] = '0';
    const azPos = collectSubcommands(args, new Set(['--subscription', '--output', '-o', '--query']));
    const subCmd = azPos[0];
    if (subCmd === 'interactive') {
      console.error(`\n   💡 AGENT HINT: 'az interactive' opens an interactive shell and will hang. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    if (subCmd === 'login') {
      const hasServicePrincipal = args.includes('--service-principal') || args.includes('--identity') || args.includes('--managed-identity');
      if (!hasServicePrincipal) {
        console.error(`\n   💡 AGENT HINT: 'az login' without --service-principal/--identity is interactive. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
        process.exit(1);
      }
    }
  }

  if (['ansible-vault', 'ansible-vault.exe'].includes(cmdBasename)) {
    if (args.includes('--ask-vault-pass')) {
      console.error(`\n   💡 AGENT HINT: 'ansible-vault --ask-vault-pass' prompts interactively for a password. Use '--vault-password-file' or '--vault-id'.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    const hasPasswordSource = args.some(
      a => a === '--vault-password-file' || a.startsWith('--vault-password-file=') || a === '--vault-id' || a.startsWith('--vault-id='),
    );
    if (!hasPasswordSource) {
      console.error(`\n   💡 AGENT HINT: 'ansible-vault' without --vault-password-file or --vault-id will prompt for a password. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }
}

export function cloudCliInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  const safeArgs = args;
  if (safeArgs.includes('--help') || safeArgs.includes('-h')) return;

  handleCloudAndPackageAuth(cmdBasename, safeArgs);

  const ghCmds = ['gh', 'gh.exe', 'gh.cmd'];
  if (ghCmds.includes(cmdBasename) && payload.type === 'command') {
    envOverrides['GH_PROMPT_DISABLED'] = '1';
    envOverrides['GH_NO_UPDATE_NOTIFIER'] = '1';
    envOverrides['NO_COLOR'] = '1';
    envOverrides['GH_PAGER'] = '';
    if (safeArgs.includes('--web')) {
      console.error(`\n   💡 AGENT HINT: 'gh ... --web' attempts to open a browser window and will hang indefinitely. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    normalizeGhJsonAndJqArgs(safeArgs);
    const posArgs = collectSubcommands(safeArgs, GH_VALUE_FLAGS);
    handleGhCommandGuards(safeArgs, posArgs, payload.stdin);
  }

  handleInfraAuthGuards(cmdBasename, safeArgs, envOverrides);
}
