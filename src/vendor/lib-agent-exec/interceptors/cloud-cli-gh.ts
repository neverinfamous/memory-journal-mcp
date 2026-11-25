// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';

export const GH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-R', '--repo', '--hostname',
  '-r', '--repos', '-v', '--visibility', '-a', '--app',
  '-e', '--env', '-o', '--org', '-D', '--dir', '-p', '--pattern',
  '-n', '--name', '--notes', '--notes-file', '-F', '-j', '--job',
  '-b', '--body', '--body-file', '--branch', '-B', '--base', '-H', '--head',
  '-d', '--desc', '--description', '-t', '--title', '-T', '--template',
  '-c', '--color', '-m', '--milestone', '-l', '--label', '-q', '--jq', '--json',
  '--worktree', '--filename',
]);

const GH_LOWERCASE_JSON_FIELDS: ReadonlySet<string> = new Set([
  'additions', 'assignees', 'assets', 'author', 'body', 'closed', 'comments', 'commits',
  'conclusion', 'created', 'deletions', 'description', 'digest', 'email', 'environment',
  'event', 'files', 'id', 'jobs', 'labels', 'language', 'languages', 'license', 'lines',
  'login', 'merged', 'milestone', 'name', 'number', 'owner', 'parent', 'path', 'project',
  'reactions', 'ref', 'repository', 'reviews', 'sha', 'size', 'state', 'status', 'tag',
  'title', 'topics', 'type', 'updated', 'url', 'user', 'value', 'values', 'version',
  'visibility', 'watchers', 'workflow',
]);

export function isGhHomepageShortFlag(flag: string, posArgs: readonly string[]): boolean {
  return flag === '-h' && posArgs[0] === 'repo' && (posArgs[1] === 'create' || posArgs[1] === 'edit');
}

export function isGhBooleanOverlap(arg: string, pos: readonly string[]): boolean {
  const s1 = pos[0];
  const s2 = pos[1];
  if (arg === '-d') return (s1 === 'run' && s2 === 'rerun') || (s1 === 'pr' && (s2 === 'merge' || s2 === 'create' || s2 === 'list' || s2 === 'ls' || s2 === 'close')) || (s1 === 'release' && s2 === 'create');
  if (arg === '-e') return (s1 === 'pr' || s1 === 'issue') && s2 === 'create';
  if (arg === '-p') return (s1 === 'gist' || s1 === 'release') && s2 === 'create';
  if (arg === '-m' || arg === '-r') return s1 === 'pr' && s2 === 'merge';
  if (arg === '-v') return s1 === 'run' && s2 === 'view';
  if (arg === '-c') return (s1 === 'pr' && (s2 === 'review' || s2 === 'view' || s2 === 'status')) || (s1 === 'issue' && s2 === 'view') || (s1 === 'repo' && s2 === 'create');
  if (s1 === 'pr' && s2 === 'review') return arg === '-a' || arg === '-r';
  return false;
}

const GH_ALPHA_CHAR_RE = /[a-zA-Z]/;
const GH_FALSY_BOOL_RE = /^(?:false|0)$/i;
const GH_IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const GH_UPPER_CHAR_RE = /[A-Z]/;
const GH_JSON_FIELD_GROUP_RE = /^[a-zA-Z][a-zA-Z0-9_]*(?:(?:\s*,\s*|\s+)[a-zA-Z][a-zA-Z0-9_]*)*,?$/;
const GH_JSON_SPLIT_RE = /[\s,]+/;

export function unpackGhShortCluster(
  arg: string,
  posArgs: readonly string[],
): { flags: string[]; consumesNext: boolean } | null {
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length < 3 || !GH_ALPHA_CHAR_RE.test(arg[1] ?? '')) return null;
  const flags: string[] = [];
  for (let j = 1; j < arg.length; j++) {
    const ch = arg[j] ?? '';
    if (ch === '=' && j >= 2) {
      if (GH_FALSY_BOOL_RE.test(arg.slice(j + 1))) flags.pop();
      return { flags, consumesNext: false };
    }
    if (!GH_ALPHA_CHAR_RE.test(ch)) return null;
    const flag = `-${ch}`;
    flags.push(flag);
    const isGistFile = posArgs[0] === 'gist' && posArgs[1] === 'create' && flag === '-f';
    const isRepoHome = isGhHomepageShortFlag(flag, posArgs);
    if ((GH_VALUE_FLAGS.has(flag) || isGistFile || isRepoHome) && !isGhBooleanOverlap(flag, posArgs)) {
      return { flags, consumesNext: j === arg.length - 1 };
    }
  }
  return { flags, consumesNext: false };
}

export function collectCliSubcommands(args: readonly string[], valueFlags: ReadonlySet<string>): string[] {
  const pos: string[] = [];
  const isGhContext = valueFlags === GH_VALUE_FLAGS;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-')) {
      pos.push(arg);
      continue;
    }
    const cluster = isGhContext ? unpackGhShortCluster(arg, pos) : null;
    if (cluster !== null) {
      if (cluster.consumesNext && i + 1 < args.length) i++;
      continue;
    }
    const isGistFile = isGhContext && pos[0] === 'gist' && pos[1] === 'create' && arg === '-f';
    const isRepoHome = isGhContext && isGhHomepageShortFlag(arg, pos);
    const isBoolOverlap = isGhContext && isGhBooleanOverlap(arg, pos);
    if (!isBoolOverlap && (valueFlags.has(arg) || isGistFile || isRepoHome) && i + 1 < args.length && !(args[i + 1] ?? '').startsWith('-')) {
      i++;
    }
  }
  return pos;
}

function unescapeJqQuotes(raw: string): string {
  // Linear scan handles arbitrary backslash runs without regex backtracking.
  let out = '';
  let slashes = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      slashes++;
      continue;
    }
    if (ch === '"' && slashes > 0) {
      out += '\\'.repeat(slashes - (slashes % 2 === 1 ? 1 : 0)) + '"';
      slashes = 0;
      continue;
    }
    if (slashes > 0) {
      out += '\\'.repeat(slashes);
      slashes = 0;
    }
    out += ch ?? '';
  }
  if (slashes > 0) out += '\\'.repeat(slashes);
  return out;
}

function isLikelyGhJsonFieldToken(tok: string): boolean {
  return GH_IDENT_RE.test(tok) && (GH_UPPER_CHAR_RE.test(tok) || GH_LOWERCASE_JSON_FIELDS.has(tok));
}

export const GH_SUBCMD_BOOL_OVERLAP: ReadonlySet<string> = new Set(['-d', '-e', '-p', '-v', '-c', '-a', '-r', '-m']);

function hasGhSubcmdFlag(
  args: readonly string[], targets: ReadonlySet<string>, matchPrefix: boolean | 'truthy-bool' = false, posArgs: readonly string[] = [],
): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (targets.has(a)) return true;
    if (matchPrefix !== false) {
      const eqIdx = a.indexOf('=');
      if (eqIdx > 0) {
        const key = a.slice(0, eqIdx);
        const lowVal = a.slice(eqIdx + 1).toLowerCase();
        if (matchPrefix === true && targets.has(key)) return true;
        if (matchPrefix === 'truthy-bool' && targets.has(key.toLowerCase()) && lowVal !== 'false' && lowVal !== '0') return true;
      }
    }
    const cluster = unpackGhShortCluster(a, posArgs);
    if (cluster !== null) {
      if (cluster.flags.some(f => targets.has(f))) return true;
      if (cluster.consumesNext) i++;
      continue;
    }
    const isGistFile = posArgs[0] === 'gist' && posArgs[1] === 'create' && a === '-f';
    const isRepoHome = isGhHomepageShortFlag(a, posArgs);
    if (a.startsWith('-') && (GH_VALUE_FLAGS.has(a) || isGistFile || isRepoHome) && !isGhBooleanOverlap(a, posArgs)) i++;
  }
  return false;
}

function preDashArgs(args: readonly string[]): readonly string[] {
  const ddIdx = args.indexOf('--');
  return ddIdx === -1 ? args : args.slice(0, ddIdx);
}

function pushGhFlagsBeforeDash(args: string[], ...flags: string[]): void {
  const ddIdx = args.indexOf('--');
  if (ddIdx !== -1) args.splice(ddIdx, 0, ...flags);
  else args.push(...flags);
}

function normalizeSpaceSeparatedJsonFields(
  args: string[], startIdx: number, limit: number, isSearchCmd: boolean, onSync?: () => void,
): { nextLimit: number; spliced: boolean } {
  const fields: string[] = [];
  let j = startIdx + 1;
  let sawCommaToken = false;
  while (j < limit) {
    const tok = args[j];
    if (tok === undefined || !GH_JSON_FIELD_GROUP_RE.test(tok)) break;
    const prevTok = fields[fields.length - 1];
    if (prevTok !== undefined && !prevTok.endsWith(',') && (isSearchCmd || !isLikelyGhJsonFieldToken(tok))) break;
    fields.push(tok);
    j++;
    if (tok.includes(',')) sawCommaToken = true;
    if (sawCommaToken && !tok.endsWith(',')) break;
  }
  if (fields.length === 0) return { nextLimit: limit, spliced: false };
  const rawJoined = fields.join(',');
  const normalized = rawJoined.trim().split(GH_JSON_SPLIT_RE).filter(Boolean).join(',');
  if (fields.length === 1 && rawJoined === normalized) return { nextLimit: limit, spliced: false };
  args.splice(startIdx + 1, fields.length, normalized);
  onSync?.();
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${fields.join(' ')}' to '${normalized}'... (Frictionless Recovery)`);
  return { nextLimit: limit - (fields.length - 1), spliced: fields.length > 1 };
}

export function normalizeGhJsonAndJqArgs(args: string[], onSync?: () => void, precomputedPosArgs?: readonly string[]): boolean {
  const posArgs = precomputedPosArgs ?? collectCliSubcommands(args, GH_VALUE_FLAGS);
  const isSearchCmd = posArgs[0] === 'search';
  const ddIdx = args.indexOf('--');
  let limit = ddIdx === -1 ? args.length : ddIdx;
  let splicedTokens = false;
  for (let i = 0; i < limit; i++) {
    const currentArg = args[i];
    if (currentArg === undefined) continue;
    if (currentArg === '--') break;
    if (currentArg === '--json' && i + 1 < limit) {
      const res = normalizeSpaceSeparatedJsonFields(args, i, limit, isSearchCmd, onSync);
      limit = res.nextLimit;
      if (res.spliced) splicedTokens = true;
      if (i + 1 < limit) i++;
    } else if (currentArg.startsWith('--json=')) {
      const jsonVal = currentArg.slice('--json='.length);
      if (jsonVal.includes(' ') || jsonVal.includes(', ')) {
        const normalized = jsonVal.trim().split(GH_JSON_SPLIT_RE).filter(Boolean).join(',');
        args[i] = `--json=${normalized}`;
        onSync?.();
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${jsonVal}' to '${normalized}'... (Frictionless Recovery)`);
      }
    } else if (currentArg === '--jq' && i + 1 < limit) {
      const jqArg = args[i + 1];
      if (jqArg !== undefined && jqArg.includes('\\"')) {
        const normalized = unescapeJqQuotes(jqArg);
        if (normalized !== jqArg) { args[i + 1] = normalized; onSync?.(); console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqArg}' to '${normalized}'... (Frictionless Recovery)`); }
      }
      i++;
    } else if (currentArg.startsWith('--jq=')) {
      const jqVal = currentArg.slice('--jq='.length);
      if (jqVal.includes('\\"')) {
        const normalized = unescapeJqQuotes(jqVal);
        if (normalized !== jqVal) { args[i] = `--jq=${normalized}`; onSync?.(); console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqVal}' to '${normalized}'... (Frictionless Recovery)`); }
      }
    } else if (currentArg.startsWith('-')) {
      const cluster = unpackGhShortCluster(currentArg, posArgs);
      if (cluster !== null) {
        if (cluster.consumesNext && i + 1 < limit) i++;
      } else if (GH_VALUE_FLAGS.has(currentArg) && i + 1 < limit) {
        const nextTok = args[i + 1] ?? '';
        const isBoolOverlap = isGhBooleanOverlap(currentArg, posArgs) || (GH_SUBCMD_BOOL_OVERLAP.has(currentArg) && nextTok.startsWith('-'));
        if (!isBoolOverlap) i++;
      }
    }
  }
  return splicedTokens;
}

function exitBlockedGh(hint: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

const GH_EDITOR_FLAGS: ReadonlySet<string> = new Set(['-e', '--editor']);
const GH_FILL_FLAGS: ReadonlySet<string> = new Set(['-f', '--fill', '--fill-first', '--fill-verbose']);
const GH_TITLE_FLAG_SET: ReadonlySet<string> = new Set(['--title', '-t']);
const GH_BODY_FLAG_SET: ReadonlySet<string> = new Set(['--body', '-b', '--body-file', '-F']);
const GH_MERGE_FLAGS: ReadonlySet<string> = new Set(['--auto', '--merge', '-m', '--squash', '-s', '--rebase', '-r']);
const GH_VISIBILITY_FLAGS: ReadonlySet<string> = new Set(['--public', '--private', '--internal']);
const GH_REVIEW_FLAGS: ReadonlySet<string> = new Set(['--approve', '-a', '--request-changes', '-r', '--comment', '-c']);
const GH_WITH_TOKEN_FLAGS: ReadonlySet<string> = new Set(['--with-token']);
const GH_RELEASE_FLAG_SET: ReadonlySet<string> = new Set(['--title', '-t', '--notes', '-n', '--notes-file', '-F']);
const GH_NOTES_GEN_FLAGS: ReadonlySet<string> = new Set(['--generate-notes', '--notes-from-tag']);
const GH_YES_SHORT_LONG_FLAGS: ReadonlySet<string> = new Set(['-y', '--yes']);
const GH_YES_LONG_FLAGS: ReadonlySet<string> = new Set(['--yes']);
const GH_SECRET_VALUE_FLAG_SET: ReadonlySet<string> = new Set(['--body', '-b', '--env-file', '-f']);
const GH_LOG_FLAGS: ReadonlySet<string> = new Set(['--log']);
const GH_JSON_SET_FLAGS: ReadonlySet<string> = new Set(['--json']);
const GH_RUN_VIEW_BYPASS_FLAGS: ReadonlySet<string> = new Set(['--log-failed', '--exit-status', '-v', '--verbose']);
const GH_ISSUE_EDIT_FLAG_LIST = ['--title', '-t', '--body', '-b', '--body-file', '-F', '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--add-project', '--remove-project', '--milestone', '-m', '--remove-milestone'] as const;
const GH_ISSUE_EDIT_FLAG_SET: ReadonlySet<string> = new Set(GH_ISSUE_EDIT_FLAG_LIST);
const GH_PR_EDIT_FLAG_SET: ReadonlySet<string> = new Set([...GH_ISSUE_EDIT_FLAG_LIST, '--add-reviewer', '--remove-reviewer', '--base', '-B']);
const GH_DOWNLOAD_FLAG_SET: ReadonlySet<string> = new Set(['-n', '--name', '-p', '--pattern']);
const GH_RERUN_JOB_FLAG_SET: ReadonlySet<string> = new Set(['-j', '--job']);
const GH_NAME_FLAGS: ReadonlySet<string> = new Set(['--name']);
const GH_JSON_READ_SUBCMDS: ReadonlySet<string> = new Set(['pr', 'issue', 'repo', 'run', 'release']);
const GH_JSON_READ_ACTIONS: ReadonlySet<string> = new Set(['list', 'status', 'view']);

function handleGhPrAndRepoCreateGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  preArgs: readonly string[],
  hasFlagWithPrefix: (flags: ReadonlySet<string>) => boolean,
): boolean {
  const subPos = [subCmd1, subCmd2].filter((s): s is string => s !== undefined);
  if (subCmd1 === 'pr' && subCmd2 === 'create') {
    if (hasGhSubcmdFlag(preArgs, GH_EDITOR_FLAGS, 'truthy-bool', subPos)) exitBlockedGh(`'gh pr create -e/--editor' opens an interactive editor and will hang. Blocking execution.`);
    const hasFill = hasGhSubcmdFlag(preArgs, GH_FILL_FLAGS, false, subPos);
    if (!hasFill && !(hasFlagWithPrefix(GH_TITLE_FLAG_SET) && hasFlagWithPrefix(GH_BODY_FLAG_SET))) exitBlockedGh(`'gh pr create' is interactive without '--fill' ('-f'), or BOTH '--title' and '--body'. Blocking execution to prevent hanging.`);
    return true;
  }
  if (subCmd1 === 'pr' && subCmd2 === 'merge') {
    if (!hasGhSubcmdFlag(preArgs, GH_MERGE_FLAGS, false, subPos)) exitBlockedGh(`'gh pr merge' requires a merge strategy (--merge, --squash, --rebase, --auto) to be non-interactive. Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'issue' && subCmd2 === 'create') {
    if (hasGhSubcmdFlag(preArgs, GH_EDITOR_FLAGS, 'truthy-bool', subPos)) exitBlockedGh(`'gh issue create -e/--editor' opens an interactive editor and will hang. Blocking execution.`);
    if (!(hasFlagWithPrefix(GH_TITLE_FLAG_SET) && hasFlagWithPrefix(GH_BODY_FLAG_SET))) exitBlockedGh(`'gh issue create' is interactive without BOTH '--title' and '--body'. Blocking execution to prevent hanging.`);
    return true;
  }
  if (subCmd1 === 'repo' && subCmd2 === 'create') {
    if (!hasGhSubcmdFlag(preArgs, GH_VISIBILITY_FLAGS, false, subPos)) exitBlockedGh(`'gh repo create' is interactive without visibility flags (--public/--private). Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'pr' && subCmd2 === 'review') {
    if (!hasGhSubcmdFlag(preArgs, GH_REVIEW_FLAGS, false, subPos)) exitBlockedGh(`'gh pr review' is interactive without a review type flag (--approve/--request-changes/--comment). Blocking execution.`);
    return true;
  }
  return false;
}

function handleGhReleaseRepoSecretGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  preArgs: readonly string[],
  posArgs: readonly string[],
  stdin: string | undefined,
  hasFlagWithPrefix: (flags: ReadonlySet<string>) => boolean,
): boolean {
  if (subCmd1 === 'auth' && (subCmd2 === 'login' || subCmd2 === 'refresh')) {
    if (!hasGhSubcmdFlag(preArgs, GH_WITH_TOKEN_FLAGS, false, posArgs)) exitBlockedGh(`'gh auth ${subCmd2}' is highly interactive. Provide a token via stdin and use '--with-token'.`);
    return true;
  }
  if (subCmd1 === 'release' && subCmd2 === 'create') {
    if (!hasFlagWithPrefix(GH_RELEASE_FLAG_SET) && !hasGhSubcmdFlag(preArgs, GH_NOTES_GEN_FLAGS, false, posArgs)) exitBlockedGh(`'gh release create' is interactive without release notes flags (--title, --notes, --notes-file, -F, -t, -n, --generate-notes, --notes-from-tag). Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'release' && subCmd2 === 'delete') {
    if (!hasGhSubcmdFlag(preArgs, GH_YES_SHORT_LONG_FLAGS, false, posArgs)) exitBlockedGh(`'gh release delete' is interactive without '--yes'. Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'repo' && subCmd2 === 'delete') {
    if (!hasGhSubcmdFlag(preArgs, GH_YES_LONG_FLAGS, false, posArgs)) exitBlockedGh(`'gh repo delete' is interactive without '--yes'. Blocking execution.`);
    return true;
  }
  if ((subCmd1 === 'secret' || subCmd1 === 'variable') && subCmd2 === 'set') {
    const hasValueFlag = hasFlagWithPrefix(GH_SECRET_VALUE_FLAG_SET);
    const hasStdin = stdin !== undefined && stdin.length > 0;
    const hasPositionalVarValue = subCmd1 === 'variable' && posArgs.length >= 4;
    if (!hasValueFlag && !hasStdin && !hasPositionalVarValue) exitBlockedGh(`'gh ${subCmd1} set' requires '--body'/'-b', '--env-file'/'-f', or stdin. Blocking execution to prevent interactive prompt.`);
    return true;
  }
  return false;
}

function handleGhEditAndRunGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: string[],
  preArgs: readonly string[],
  posArgs: readonly string[],
  stdin: string | undefined,
  hasFlagWithPrefix: (flags: ReadonlySet<string>) => boolean,
  onSync?: () => void,
): boolean {
  if (subCmd1 === 'run' && subCmd2 === 'view') {
    if (hasGhSubcmdFlag(preArgs, GH_LOG_FLAGS, 'truthy-bool', posArgs)) {
      console.error(`\n   💡 AGENT HINT: If the job is still in progress, 'gh run view --log' will fail with code 1. Do NOT poll in a tight loop. Instead, use your 'schedule' tool to set a 60-second timer to wait asynchronously.\n`);
      process.exit(1);
    }
    if (!hasFlagWithPrefix(GH_JSON_SET_FLAGS) && !hasGhSubcmdFlag(preArgs, GH_RUN_VIEW_BYPASS_FLAGS, true, posArgs)) {
      pushGhFlagsBeforeDash(args, '--json', 'databaseId,name,status,conclusion,url');
      onSync?.();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh run view command to output structured data... (Frictionless Recovery)`);
    }
    return true;
  }
  if (subCmd1 === 'run' && subCmd2 === 'watch') exitBlockedGh(`'gh run watch' is interactive/runs indefinitely. Blocking execution.`);
  if (subCmd1 === 'issue' && subCmd2 === 'edit') {
    if (!hasFlagWithPrefix(GH_ISSUE_EDIT_FLAG_SET)) exitBlockedGh(`'gh issue edit' is interactive without modification flags. Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'pr' && subCmd2 === 'edit') {
    if (!hasFlagWithPrefix(GH_PR_EDIT_FLAG_SET)) exitBlockedGh(`'gh pr edit' is interactive without modification flags. Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'run' && (subCmd2 === 'rerun' || subCmd2 === 'download')) {
    const hasIdFlag = subCmd2 === 'download' ? hasFlagWithPrefix(GH_DOWNLOAD_FLAG_SET) : hasFlagWithPrefix(GH_RERUN_JOB_FLAG_SET);
    if (!hasIdFlag && posArgs.length <= 2) exitBlockedGh(`'gh run ${subCmd2}' is interactive without a run ID. Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'issue' && subCmd2 === 'transfer') {
    if (posArgs.length <= 3) exitBlockedGh(`'gh issue transfer' is interactive without issue and repo args. Blocking execution.`);
    return true;
  }
  if (subCmd1 === 'codespace' && subCmd2 === 'ssh') exitBlockedGh(`'gh codespace ssh' runs an interactive shell. Blocking execution.`);
  if (subCmd1 === 'gist' && subCmd2 === 'create') {
    if (posArgs.length <= 2 && (stdin === undefined || stdin.length === 0)) exitBlockedGh(`'gh gist create' is interactive without files or stdin. Blocking execution.`);
    return true;
  }
  return false;
}

function handleGhReadJsonGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  args: string[],
  preArgs: readonly string[],
  posArgs: readonly string[],
  onSync?: () => void,
): void {
  if (subCmd1 === 'pr' && subCmd2 === 'checkout' && posArgs.length <= 2) exitBlockedGh(`'gh pr checkout' without a PR number opens an interactive picker. Blocking execution.`);
  if (subCmd1 === 'browse') exitBlockedGh(`'gh browse' opens a browser window which is not available in headless mode. Blocking execution.`);
  if (subCmd1 === 'label' && subCmd2 === 'create') {
    if (!hasGhSubcmdFlag(preArgs, GH_NAME_FLAGS, true, posArgs) && posArgs.length <= 2) exitBlockedGh(`'gh label create' is interactive without a label name. Blocking execution.`);
    return;
  }
  if (subCmd1 !== undefined && subCmd2 !== undefined && GH_JSON_READ_SUBCMDS.has(subCmd1) && GH_JSON_READ_ACTIONS.has(subCmd2)) {
    if (hasGhSubcmdFlag(preArgs, GH_JSON_SET_FLAGS, true, posArgs)) return;
    let jsonFields = 'url';
    if (subCmd1 === 'pr' || subCmd1 === 'issue') jsonFields = 'number,title,state,url';
    else if (subCmd1 === 'repo') jsonFields = 'name,owner,url';
    else if (subCmd1 === 'run') jsonFields = 'databaseId,name,status,conclusion,url';
    else if (subCmd1 === 'release') jsonFields = 'tagName,name,createdAt,isDraft,isPrerelease';
    pushGhFlagsBeforeDash(args, '--json', jsonFields);
    onSync?.();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh command to output structured data... (Frictionless Recovery)`);
    return;
  }
  if (subCmd1 === 'search' && !hasGhSubcmdFlag(preArgs, GH_JSON_SET_FLAGS, true, posArgs)) {
    exitBlockedGh(`'gh search' requires '--json' to output structured data. Blocking execution.`);
  }
}

export function handleGhCommandGuards(args: string[], posArgs: string[], stdin: string | undefined, onSync?: () => void): void {
  const [subCmd1, subCmd2] = posArgs;
  const preArgs = preDashArgs(args);
  const hasFlagWithPrefix = (flags: ReadonlySet<string>): boolean => hasGhSubcmdFlag(preArgs, flags, true, posArgs);
  if (handleGhPrAndRepoCreateGuards(subCmd1, subCmd2, preArgs, hasFlagWithPrefix)) return;
  if (handleGhReleaseRepoSecretGuards(subCmd1, subCmd2, preArgs, posArgs, stdin, hasFlagWithPrefix)) return;
  if (handleGhEditAndRunGuards(subCmd1, subCmd2, args, preArgs, posArgs, stdin, hasFlagWithPrefix, onSync)) return;
  handleGhReadJsonGuards(subCmd1, subCmd2, args, preArgs, posArgs, onSync);
}
