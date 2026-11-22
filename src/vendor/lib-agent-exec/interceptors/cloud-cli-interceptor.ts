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
const GH_VALUE_FLAGS = new Set([
  '-R', '--repo', '--hostname',
  '-r', '--repos', '-v', '--visibility', '-a', '--app',
  '-e', '--env', '-o', '--org', '-D', '--dir', '-p', '--pattern',
  '-n', '--name', '-j', '--job', '-b', '--branch', '-d', '--desc', '--description',
  '-c', '--color',
]);
const TF_VALUE_FLAGS = new Set([
  '-chdir', '-var', '-var-file', '-target', '-replace', '-state', '-state-out', '-backup', '-lock-timeout', '-parallelism',
]);

function unescapeJqQuotes(raw: string): string {
  return raw.replace(/(\\*)\\"/g, (fullMatch, slashes: string) => (slashes.length % 2 === 0 ? `${slashes}"` : fullMatch));
}

function exitBlocked(hint: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

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

const CLOUD_CLI_CMDS = new Set([
  'wrangler', 'vercel', 'netlify', 'firebase', 'heroku', 'supabase', 'stripe', 'fly', 'flyctl', 'expo', 'eas',
  'wrangler.cmd', 'vercel.cmd', 'netlify.cmd', 'firebase.cmd', 'heroku.cmd', 'supabase.cmd',
  'stripe.exe', 'fly.exe', 'flyctl.exe', 'expo.cmd', 'eas.cmd',
]);
const TRACKER_CMDS = new Set(['jira', 'jira.exe', 'jira.cmd', 'linear', 'linear.exe', 'linear.cmd', 'slack', 'slack.exe', 'slack.cmd']);

function handleCloudAndPackageAuth(cmdBasename: string, args: string[], onSync?: () => void): void {
  if (CLOUD_CLI_CMDS.has(cmdBasename)) {
    const cloudPos = collectSubcommands(args, CLOUD_VALUE_FLAGS);
    if (cloudPos[0] === 'login' || (cloudPos[0] === 'auth' && cloudPos[1] === 'login')) {
      exitBlocked(`'${cmdBasename} login' is highly interactive and will hang. Use API tokens via environment variables instead.`);
    }
    const subCmd = cloudPos[0] ?? '';
    if (['init', 'create'].includes(subCmd) && !args.includes('-y') && !args.includes('--yes')) {
      args.push('-y');
      onSync?.();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} ${subCmd}' is highly interactive. Automatically injecting '-y' to prevent hanging... (Frictionless Recovery)`);
    }
  }

  if (TRACKER_CMDS.has(cmdBasename)) {
    const trackerPos = collectSubcommands(args, CLOUD_VALUE_FLAGS);
    if ((trackerPos[0] === 'login' || trackerPos[0] === 'auth') && !args.includes('--token')) {
      exitBlocked(`'${cmdBasename} login/auth' is interactive. Blocking execution. Use '--token' to bypass.`);
    }
  }

  if (['cargo', 'cargo.exe'].includes(cmdBasename)) {
    const cargoPos = collectSubcommands(args, new Set(['--manifest-path', '--target-dir', '--package', '-p', '--features', '--bin']));
    if (cargoPos[0] === 'login' || cargoPos[0] === 'publish') {
      exitBlocked(`'cargo login/publish' is interactive. Blocking execution.`);
    }
  }

  if (['aws', 'aws.exe', 'aws.cmd'].includes(cmdBasename)) {
    const awsPos = collectSubcommands(args, new Set(['--profile', '--region', '--output', '--endpoint-url']));
    if (awsPos[0] === 'configure') {
      exitBlocked(`'aws configure' is interactive. Use environment variables instead.`);
    }
  }

  if (['gcloud', 'gcloud.cmd'].includes(cmdBasename)) {
    const gPos = collectSubcommands(args, GCLOUD_VALUE_FLAGS);
    const isInteractiveAuth = gPos[0] === 'auth' && (gPos[1] === 'login' || (gPos[1] === 'application-default' && gPos[2] !== 'print-access-token'));
    if (isInteractiveAuth) {
      exitBlocked(`'gcloud auth login' / 'application-default' is interactive. Use service accounts instead.`);
    }
  }

  if (['terraform', 'terraform.exe', 'tofu', 'tofu.exe'].includes(cmdBasename)) {
    const tfPos = collectSubcommands(args, TF_VALUE_FLAGS);
    const subCmd = tfPos[0] ?? '';
    const hasPlanFile = subCmd === 'apply' && tfPos.length > 1;
    if (['apply', 'destroy'].includes(subCmd) && !hasPlanFile && !args.includes('-auto-approve')) {
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

const GH_LOWERCASE_JSON_FIELDS = new Set([
  'additions', 'assignees', 'assets', 'author', 'body', 'closed', 'comments', 'commits',
  'conclusion', 'created', 'deletions', 'description', 'digest', 'email', 'environment',
  'event', 'files', 'id', 'jobs', 'labels', 'language', 'languages', 'license', 'lines',
  'login', 'merged', 'milestone', 'name', 'number', 'owner', 'parent', 'path', 'project',
  'reactions', 'ref', 'repository', 'reviews', 'sha', 'size', 'state', 'status', 'tag',
  'title', 'topics', 'type', 'updated', 'url', 'user', 'value', 'values', 'version',
  'visibility', 'watchers', 'workflow',
]);

function isLikelyGhJsonFieldToken(tok: string): boolean {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tok)) return false;
  return /[A-Z]/.test(tok) || GH_LOWERCASE_JSON_FIELDS.has(tok);
}

function normalizeGhJsonAndJqArgs(args: string[], onSync?: () => void): void {
  const isSearchCmd = args.find(a => !a.startsWith('-')) === 'search';
  for (let i = 0; i < args.length; i++) {
    const currentArg = args[i];
    if (currentArg === undefined) continue;
    if (currentArg === '--json' && i + 1 < args.length) {
      const fields: string[] = [];
      let j = i + 1;
      let sawCommaToken = false;
      while (j < args.length) {
        const tok = args[j];
        if (tok === undefined || !/^[a-zA-Z][a-zA-Z0-9_]*(?:(?:\s*,\s*|\s+)[a-zA-Z][a-zA-Z0-9_]*)*,?$/.test(tok)) break;
        const prevTok = fields[fields.length - 1];
        if (prevTok !== undefined && !prevTok.endsWith(',') && (isSearchCmd || !isLikelyGhJsonFieldToken(tok))) break;
        fields.push(tok);
        j++;
        if (tok.includes(',')) sawCommaToken = true;
        if (sawCommaToken && !tok.endsWith(',')) break;
      }
      if (fields.length > 0) {
        const rawJoined = fields.join(',');
        const normalized = rawJoined.trim().split(/[\s,]+/).filter(Boolean).join(',');
        if (fields.length > 1 || rawJoined !== normalized) {
          args.splice(i + 1, fields.length, normalized);
          onSync?.();
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${fields.join(' ')}' to '${normalized}'... (Frictionless Recovery)`);
        }
      }
    } else if (currentArg.startsWith('--json=')) {
      const jsonVal = currentArg.slice('--json='.length);
      if (jsonVal.includes(' ') || jsonVal.includes(', ')) {
        const normalized = jsonVal.trim().split(/[\s,]+/).filter(Boolean).join(',');
        args[i] = `--json=${normalized}`;
        onSync?.();
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${jsonVal}' to '${normalized}'... (Frictionless Recovery)`);
      }
    } else if (currentArg === '--jq' && i + 1 < args.length) {
      const jqArg = args[i + 1];
      if (jqArg !== undefined && jqArg.includes('\\"')) {
        const normalized = unescapeJqQuotes(jqArg);
        if (normalized !== jqArg) {
          args[i + 1] = normalized;
          onSync?.();
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqArg}' to '${normalized}'... (Frictionless Recovery)`);
        }
      }
    } else if (currentArg.startsWith('--jq=')) {
      const jqVal = currentArg.slice('--jq='.length);
      if (jqVal.includes('\\"')) {
        const normalized = unescapeJqQuotes(jqVal);
        if (normalized !== jqVal) {
          args[i] = `--jq=${normalized}`;
          onSync?.();
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqVal}' to '${normalized}'... (Frictionless Recovery)`);
        }
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
  onSync?: () => void,
): boolean {
  return match([subCmd1, subCmd2])
    .with(['run', 'view'], () => {
      if (args.includes('--log')) {
        console.error(`\n   💡 AGENT HINT: If the job is still in progress, 'gh run view --log' will fail with code 1. Do NOT poll in a tight loop. Instead, use your 'schedule' tool to set a 60-second timer to wait asynchronously.\n`);
        process.exit(1);
      }
      if (!args.some((a) => a === '--json' || a.startsWith('--json=')) && !args.includes('--log-failed') && !args.includes('--exit-status') && !args.some(a => a === '-v' || a.startsWith('--verbose'))) {
        args.push('--json', 'databaseId,name,status,conclusion,url');
        onSync?.();
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh run view command to output structured data... (Frictionless Recovery)`);
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
      const nonInteractiveByFlag = action === 'download'
        ? hasFlagWithPrefix(['-n', '--name', '-p', '--pattern'])
        : hasFlagWithPrefix(['-j', '--job']);
      if (!nonInteractiveByFlag && posArgs.length <= 2) {
        exitBlockedGh(`'gh run ${action}' is interactive without a run ID. Blocking execution.`);
      }
      return true;
    })
    .with(['issue', 'transfer'], () => {
      if (posArgs.length <= 3) exitBlockedGh(`'gh issue transfer' is interactive without issue and repo args. Blocking execution.`);
      return true;
    })
    .with(['codespace', 'ssh'], () => exitBlockedGh(`'gh codespace ssh' runs an interactive shell. Blocking execution.`))
    .with(['gist', 'create'], () => {
      if (posArgs.length <= 2 && (stdin === undefined || stdin.length === 0)) exitBlockedGh(`'gh gist create' is interactive without files or stdin. Blocking execution.`);
      return true;
    })
    .otherwise(() => false);
}

function handleGhReadJsonGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: string[],
  posArgs: readonly string[],
  onSync?: () => void,
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
        let jsonFields = 'url';
        if (subCmd1 === 'pr' || subCmd1 === 'issue') jsonFields = 'number,title,state,url';
        if (subCmd1 === 'repo') jsonFields = 'name,owner,url';
        if (subCmd1 === 'run') jsonFields = 'databaseId,name,status,conclusion,url';
        if (subCmd1 === 'release') jsonFields = 'tagName,name,createdAt,isDraft,isPrerelease';
        args.push('--json', jsonFields);
        onSync?.();
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh command to output structured data... (Frictionless Recovery)`);
      }
    })
    .with(['search', P._], () => {
      if (!args.some(a => a === '--json' || a.startsWith('--json='))) {
        exitBlockedGh(`'gh search' requires '--json' to output structured data. Blocking execution.`);
      }
    })
    .otherwise(() => {});
}

function handleGhCommandGuards(args: string[], posArgs: string[], stdin: string | undefined, onSync?: () => void): void {
  const subCmd1 = posArgs[0];
  const subCmd2 = posArgs[1];
  const hasFlagWithPrefix = (flags: readonly string[]): boolean =>
    args.some(a => flags.includes(a) || flags.some(f => a.startsWith(`${f}=`)));
  if (handleGhPrAndRepoCreateGuards(subCmd1, subCmd2, args, hasFlagWithPrefix)) return;
  if (handleGhReleaseRepoSecretGuards(subCmd1, subCmd2, args, posArgs, stdin, hasFlagWithPrefix)) return;
  if (handleGhEditAndRunGuards(subCmd1, subCmd2, args, posArgs, stdin, hasFlagWithPrefix, onSync)) return;
  handleGhReadJsonGuards(subCmd1, subCmd2, args, posArgs, onSync);
}

function sliceBeforeDoubleDash(args: readonly string[]): readonly string[] {
  const ddIdx = args.indexOf('--');
  return ddIdx === -1 ? args : args.slice(0, ddIdx);
}

function hasAnyFlagOrPrefix(flags: readonly string[], names: readonly string[]): boolean {
  return flags.some(a => names.some(f => a === f || a.startsWith(`${f}=`)));
}

function handleInfraAuthGuards(cmdBasename: string, args: readonly string[], envOverrides: Record<string, string>): void {
  if (['az', 'az.cmd', 'az.exe'].includes(cmdBasename)) {
    envOverrides['AZURE_CORE_NO_COLOR'] = '1';
    envOverrides['AZURE_CORE_COLLECT_TELEMETRY'] = '0';
    const subCmd = collectSubcommands(args, new Set(['--subscription', '--output', '-o', '--query']))[0];
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
    const avPos = collectSubcommands(args, new Set(['--vault-password-file', '--vault-id', '--new-vault-password-file', '--new-vault-id', '--output']));
    if (avPos[0] === 'rekey' && !hasAnyFlagOrPrefix(avFlags, ['--new-vault-password-file', '--new-vault-id'])) {
      exitBlocked(`'ansible-vault rekey' without --new-vault-password-file or --new-vault-id will prompt for the new password. Blocking execution.`);
    }
  }
}

export function cloudCliInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  const safeArgs = args;
  if (safeArgs.includes('--help') || safeArgs.includes('-h')) return;
  const syncArgs = (): void => { if (payload.type === 'command') payload.args = safeArgs; };

  handleCloudAndPackageAuth(cmdBasename, safeArgs, syncArgs);

  const ghCmds = ['gh', 'gh.exe', 'gh.cmd'];
  if (ghCmds.includes(cmdBasename) && payload.type === 'command') {
    envOverrides['GH_PROMPT_DISABLED'] = '1';
    envOverrides['GH_NO_UPDATE_NOTIFIER'] = '1';
    envOverrides['NO_COLOR'] = '1';
    envOverrides['GH_PAGER'] = '';
    if (safeArgs.includes('--web')) exitBlocked(`'gh ... --web' attempts to open a browser window and will hang indefinitely. Blocking execution.`);
    normalizeGhJsonAndJqArgs(safeArgs, syncArgs);
    const posArgs = collectSubcommands(safeArgs, GH_VALUE_FLAGS);
    handleGhCommandGuards(safeArgs, posArgs, payload.stdin, syncArgs);
  }

  handleInfraAuthGuards(cmdBasename, safeArgs, envOverrides);
}
