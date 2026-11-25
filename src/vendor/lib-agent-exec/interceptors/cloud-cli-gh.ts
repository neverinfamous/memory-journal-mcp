// @ts-nocheck
import { match, P } from 'ts-pattern';
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

export function unpackGhShortCluster(
  arg: string,
  posArgs: readonly string[],
): { flags: string[]; consumesNext: boolean } | null {
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length < 3 || !/[a-zA-Z]/.test(arg[1] ?? '')) return null;
  const flags: string[] = [];
  for (let j = 1; j < arg.length; j++) {
    const ch = arg[j] ?? '';
    if (ch === '=' && j >= 2) {
      if (/^(?:false|0)$/i.test(arg.slice(j + 1))) flags.pop();
      return { flags, consumesNext: false };
    }
    if (!/[a-zA-Z]/.test(ch)) return null;
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
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tok)) return false;
  return /[A-Z]/.test(tok) || GH_LOWERCASE_JSON_FIELDS.has(tok);
}

export const GH_SUBCMD_BOOL_OVERLAP: ReadonlySet<string> = new Set(['-d', '-e', '-p', '-v', '-c', '-a', '-r', '-m']);

function hasGhSubcmdFlag(
  args: readonly string[],
  targets: ReadonlySet<string>,
  matchPrefix: boolean | 'truthy-bool' = false,
  posArgs: readonly string[] = [],
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
    const isBoolOverlap = isGhBooleanOverlap(a, posArgs);
    if (a.startsWith('-') && (GH_VALUE_FLAGS.has(a) || isGistFile || isRepoHome) && !isBoolOverlap) {
      i++;
    }
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

export function normalizeGhJsonAndJqArgs(args: string[], onSync?: () => void): void {
  const posArgs = collectCliSubcommands(args, GH_VALUE_FLAGS);
  const isSearchCmd = posArgs[0] === 'search';
  const ddIdx = args.indexOf('--');
  let limit = ddIdx === -1 ? args.length : ddIdx;
  for (let i = 0; i < limit; i++) {
    const currentArg = args[i];
    if (currentArg === undefined) continue;
    if (currentArg === '--') break;
    if (currentArg === '--json' && i + 1 < limit) {
      const fields: string[] = [];
      let j = i + 1;
      let sawCommaToken = false;
      while (j < limit) {
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
          limit -= fields.length - 1;
          onSync?.();
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${fields.join(' ')}' to '${normalized}'... (Frictionless Recovery)`);
        }
        i++;
      }
    } else if (currentArg.startsWith('--json=')) {
      const jsonVal = currentArg.slice('--json='.length);
      if (jsonVal.includes(' ') || jsonVal.includes(', ')) {
        const normalized = jsonVal.trim().split(/[\s,]+/).filter(Boolean).join(',');
        args[i] = `--json=${normalized}`;
        onSync?.();
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Normalizing gh --json fields from '${jsonVal}' to '${normalized}'... (Frictionless Recovery)`);
      }
    } else if (currentArg === '--jq' && i + 1 < limit) {
      const jqArg = args[i + 1];
      if (jqArg !== undefined && jqArg.includes('\\"')) {
        const normalized = unescapeJqQuotes(jqArg);
        if (normalized !== jqArg) {
          args[i + 1] = normalized;
          onSync?.();
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Healing escaped quotes in gh --jq expression from '${jqArg}' to '${normalized}'... (Frictionless Recovery)`);
        }
      }
      i++;
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
}

function exitBlockedGh(hint: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

function handleGhPrAndRepoCreateGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  preArgs: readonly string[],
  hasFlagWithPrefix: (flags: readonly string[]) => boolean,
): boolean {
  const subPos = [subCmd1, subCmd2].filter((s): s is string => s !== undefined);
  return match([subCmd1, subCmd2])
    .with(['pr', 'create'], () => {
      if (hasGhSubcmdFlag(preArgs, new Set(['-e', '--editor']), 'truthy-bool', subPos)) {
        exitBlockedGh(`'gh pr create -e/--editor' opens an interactive editor and will hang. Blocking execution.`);
      }
      const hasFill = hasGhSubcmdFlag(preArgs, new Set(['-f', '--fill', '--fill-first', '--fill-verbose']), false, subPos);
      if (!hasFill && !(hasFlagWithPrefix(['--title', '-t']) && hasFlagWithPrefix(['--body', '-b', '--body-file', '-F']))) {
        exitBlockedGh(`'gh pr create' is interactive without '--fill' ('-f'), or BOTH '--title' and '--body'. Blocking execution to prevent hanging.`);
      }
      return true;
    })
    .with(['pr', 'merge'], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--auto', '--merge', '-m', '--squash', '-s', '--rebase', '-r']), false, subPos)) {
        exitBlockedGh(`'gh pr merge' requires a merge strategy (--merge, --squash, --rebase, --auto) to be non-interactive. Blocking execution.`);
      }
      return true;
    })
    .with(['issue', 'create'], () => {
      if (hasGhSubcmdFlag(preArgs, new Set(['-e', '--editor']), 'truthy-bool', subPos)) {
        exitBlockedGh(`'gh issue create -e/--editor' opens an interactive editor and will hang. Blocking execution.`);
      }
      if (!(hasFlagWithPrefix(['--title', '-t']) && hasFlagWithPrefix(['--body', '-b', '--body-file', '-F']))) {
        exitBlockedGh(`'gh issue create' is interactive without BOTH '--title' and '--body'. Blocking execution to prevent hanging.`);
      }
      return true;
    })
    .with(['repo', 'create'], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--public', '--private', '--internal']), false, subPos)) {
        exitBlockedGh(`'gh repo create' is interactive without visibility flags (--public/--private). Blocking execution.`);
      }
      return true;
    })
    .with(['pr', 'review'], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--approve', '-a', '--request-changes', '-r', '--comment', '-c']), false, subPos)) {
        exitBlockedGh(`'gh pr review' is interactive without a review type flag (--approve/--request-changes/--comment). Blocking execution.`);
      }
      return true;
    })
    .otherwise(() => false);
}

function handleGhReleaseRepoSecretGuards(
  subCmd1: string | undefined,
  subCmd2: string | undefined,
  preArgs: readonly string[],
  posArgs: readonly string[],
  stdin: string | undefined,
  hasFlagWithPrefix: (flags: readonly string[]) => boolean,
): boolean {
  return match([subCmd1, subCmd2])
    .with(['auth', P.union('login', 'refresh')], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--with-token']), false, posArgs)) {
        exitBlockedGh(`'gh auth ${subCmd2}' is highly interactive. Provide a token via stdin and use '--with-token'.`);
      }
      return true;
    })
    .with(['release', 'create'], () => {
      const releaseFlags = ['--title', '-t', '--notes', '-n', '--notes-file', '-F'];
      if (!hasFlagWithPrefix(releaseFlags) && !hasGhSubcmdFlag(preArgs, new Set(['--generate-notes', '--notes-from-tag']), false, posArgs)) {
        exitBlockedGh(`'gh release create' is interactive without release notes flags (--title, --notes, --notes-file, -F, -t, -n, --generate-notes, --notes-from-tag). Blocking execution.`);
      }
      return true;
    })
    .with(['release', 'delete'], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['-y', '--yes']), false, posArgs)) exitBlockedGh(`'gh release delete' is interactive without '--yes'. Blocking execution.`);
      return true;
    })
    .with(['repo', 'delete'], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--yes']), false, posArgs)) exitBlockedGh(`'gh repo delete' is interactive without '--yes'. Blocking execution.`);
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
  preArgs: readonly string[],
  posArgs: readonly string[],
  stdin: string | undefined,
  hasFlagWithPrefix: (flags: readonly string[]) => boolean,
  onSync?: () => void,
): boolean {
  return match([subCmd1, subCmd2])
    .with(['run', 'view'], () => {
      if (hasGhSubcmdFlag(preArgs, new Set(['--log']), 'truthy-bool', posArgs)) {
        console.error(`\n   💡 AGENT HINT: If the job is still in progress, 'gh run view --log' will fail with code 1. Do NOT poll in a tight loop. Instead, use your 'schedule' tool to set a 60-second timer to wait asynchronously.\n`);
        process.exit(1);
      }
      if (!hasFlagWithPrefix(['--json']) && !hasGhSubcmdFlag(preArgs, new Set(['--log-failed', '--exit-status', '-v', '--verbose']), true, posArgs)) {
        pushGhFlagsBeforeDash(args, '--json', 'databaseId,name,status,conclusion,url');
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
  preArgs: readonly string[],
  posArgs: readonly string[],
  onSync?: () => void,
): void {
  match([subCmd1, subCmd2])
    .with(['pr', 'checkout'], () => {
      if (posArgs.length <= 2) exitBlockedGh(`'gh pr checkout' without a PR number opens an interactive picker. Blocking execution.`);
    })
    .with(['browse', P._], () => exitBlockedGh(`'gh browse' opens a browser window which is not available in headless mode. Blocking execution.`))
    .with(['label', 'create'], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--name']), true, posArgs) && posArgs.length <= 2) {
        exitBlockedGh(`'gh label create' is interactive without a label name. Blocking execution.`);
      }
    })
    .with([P.union('pr', 'issue', 'repo', 'run', 'release'), P.union('list', 'status', 'view')], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--json']), true, posArgs)) {
        let jsonFields = 'url';
        if (subCmd1 === 'pr' || subCmd1 === 'issue') jsonFields = 'number,title,state,url';
        if (subCmd1 === 'repo') jsonFields = 'name,owner,url';
        if (subCmd1 === 'run') jsonFields = 'databaseId,name,status,conclusion,url';
        if (subCmd1 === 'release') jsonFields = 'tagName,name,createdAt,isDraft,isPrerelease';
        pushGhFlagsBeforeDash(args, '--json', jsonFields);
        onSync?.();
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--json' into gh command to output structured data... (Frictionless Recovery)`);
      }
    })
    .with(['search', P._], () => {
      if (!hasGhSubcmdFlag(preArgs, new Set(['--json']), true, posArgs)) {
        exitBlockedGh(`'gh search' requires '--json' to output structured data. Blocking execution.`);
      }
    })
    .otherwise(() => {});
}

export function handleGhCommandGuards(args: string[], posArgs: string[], stdin: string | undefined, onSync?: () => void): void {
  const subCmd1 = posArgs[0];
  const subCmd2 = posArgs[1];
  const preArgs = preDashArgs(args);
  const hasFlagWithPrefix = (flags: readonly string[]): boolean =>
    hasGhSubcmdFlag(preArgs, new Set(flags), true, posArgs);
  if (handleGhPrAndRepoCreateGuards(subCmd1, subCmd2, preArgs, hasFlagWithPrefix)) return;
  if (handleGhReleaseRepoSecretGuards(subCmd1, subCmd2, preArgs, posArgs, stdin, hasFlagWithPrefix)) return;
  if (handleGhEditAndRunGuards(subCmd1, subCmd2, args, preArgs, posArgs, stdin, hasFlagWithPrefix, onSync)) return;
  handleGhReadJsonGuards(subCmd1, subCmd2, args, preArgs, posArgs, onSync);
}
