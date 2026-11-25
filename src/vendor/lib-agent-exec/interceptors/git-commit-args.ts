// @ts-nocheck
const COMMIT_READONLY_FLAGS = new Set(['--dry-run', '--short', '--porcelain', '--long']);
const GIT_TOP_VALUE_FLAGS = new Set([
  '-C', '-c', '--attr-source', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix',
]);
const SHORT_BOOL_FLAGS = new Set(['a', 's', 'n', 'q', 'v', 'o', 'i', 'e', 'p', 'z']);
const SHORT_REQ_VALUE_FLAGS = new Set(['m', 'F', 'C', 'c', 't', 'U']);
const SHORT_OPT_ATTACHED_FLAGS = new Set(['S', 'u']);
const FIXUP_INTERACTIVE_RE = /^(?:amend|reword):/;

interface LongOptionSpec {
  readonly full: string;
  readonly minPrefix: string;
}

/**
 * [INVARIANT]: Unambiguous `git commit` long value-option prefixes accepted by Git's `parse_options`
 * (excluding `--message`, `--file`, and `--pathspec-from-file`, handled separately).
 */
const LONG_VALUE_OPTIONS: readonly LongOptionSpec[] = [
  { full: '--reuse-message', minPrefix: '--reu' },
  { full: '--reedit-message', minPrefix: '--ree' },
  { full: '--fixup', minPrefix: '--fix' },
  { full: '--squash', minPrefix: '--sq' },
  { full: '--author', minPrefix: '--au' },
  { full: '--date', minPrefix: '--da' },
  { full: '--template', minPrefix: '--te' },
  { full: '--cleanup', minPrefix: '--c' },
  { full: '--trailer', minPrefix: '--tr' },
  { full: '--unified', minPrefix: '--uni' },
  { full: '--inter-hunk-context', minPrefix: '--inter-' },
];

export interface GitTopLevelPrefix {
  commitStartIdx: number;
  gitDir: string | undefined;
  workTree: string | undefined;
}

export interface ParsedGitCommitArgs {
  message: string | undefined;
  hasAmend: boolean;
  hasAll: boolean;
  hasMessageFile: boolean;
  hasInteractiveOrPatch: boolean;
  hasNonInteractiveMsgSource: boolean;
  isDryRun: boolean;
  hasPathspecFromFile: boolean;
  pathspecs: string[];
  gitDir: string | undefined;
  workTree: string | undefined;
}

interface CommitParseState {
  messages: string[];
  pathspecs: string[];
  hasAll: boolean;
  hasMessageFile: boolean;
  hasInteractiveOrPatch: boolean;
  hasNonInteractiveMsgSource: boolean;
}

function matchesLongPrefix(flag: string, full: string, minPrefix: string): boolean {
  return flag.startsWith(minPrefix) && full.startsWith(flag);
}

function resolveLongValueFlag(flag: string): string | null {
  for (const spec of LONG_VALUE_OPTIONS) {
    if (matchesLongPrefix(flag, spec.full, spec.minPrefix)) {
      return spec.full;
    }
  }
  return null;
}

function isNegatedDryRunFlag(arg: string): boolean {
  return matchesLongPrefix(arg, '--no-dry-run', '--no-dr');
}

function isNegatedStatusFormatFlag(arg: string): boolean {
  return (
    matchesLongPrefix(arg, '--no-short', '--no-sh') ||
    matchesLongPrefix(arg, '--no-porcelain', '--no-por') ||
    matchesLongPrefix(arg, '--no-long', '--no-l')
  );
}

function isLongMessageFlag(arg: string): boolean {
  return arg.length >= 3 && !arg.includes('=') && matchesLongPrefix(arg, '--message', '--m');
}

function extractLongMessageEqValue(arg: string): string | null {
  const eqIdx = arg.indexOf('=');
  if (eqIdx < 3) return null;
  const flagPart = arg.slice(0, eqIdx);
  return matchesLongPrefix(flagPart, '--message', '--m') ? arg.slice(eqIdx + 1) : null;
}

function isLongFileFlag(arg: string): boolean {
  return !arg.includes('=') && matchesLongPrefix(arg, '--file', '--fil');
}

function isLongFileEqFlag(arg: string): boolean {
  const eqIdx = arg.indexOf('=');
  if (eqIdx < 5) return false;
  return matchesLongPrefix(arg.slice(0, eqIdx), '--file', '--fil');
}

function isPathspecFromFileFlag(arg: string): boolean {
  const eqIdx = arg.indexOf('=');
  const flagPart = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
  return matchesLongPrefix(flagPart, '--pathspec-from-file', '--pathspec-fr');
}

function isLongInteractiveOrPatchFlag(arg: string): boolean {
  return (
    matchesLongPrefix(arg, '--patch', '--patc') ||
    matchesLongPrefix(arg, '--interactive', '--int')
  );
}

function parseGitTopLevelPrefix(args: readonly string[]): GitTopLevelPrefix {
  let gitDir: string | undefined;
  let workTree: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') return { commitStartIdx: 0, gitDir: undefined, workTree: undefined };
    if (arg === '--git-dir' && args[i + 1] !== undefined) {
      gitDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--git-dir=')) {
      gitDir = arg.slice(10);
      continue;
    }
    if (arg === '--work-tree' && args[i + 1] !== undefined) {
      workTree = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--work-tree=')) {
      workTree = arg.slice(12);
      continue;
    }
    if (GIT_TOP_VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg === 'commit'
      ? { commitStartIdx: i + 1, gitDir, workTree }
      : { commitStartIdx: 0, gitDir: undefined, workTree: undefined };
  }
  return { commitStartIdx: 0, gitDir: undefined, workTree: undefined };
}

function markNonInteractiveReuse(canonicalFlag: string, value: string, state: CommitParseState): void {
  if (canonicalFlag === '--reuse-message') {
    state.hasNonInteractiveMsgSource = true;
    return;
  }
  if (canonicalFlag === '--fixup' && !FIXUP_INTERACTIVE_RE.test(value)) {
    state.hasNonInteractiveMsgSource = true;
  }
}

/**
 * [INTENT]: Left-to-right POSIX short-option cluster parser matching Git `parse_options` semantics
 * across boolean flags (`a,s,n,q,v,o,i,e,p,z`), required-arg flags (`m,F,C,c,t,U`), and optional-attached flags (`S,u`).
 */
function parseShortCluster(
  arg: string,
  args: readonly string[],
  idx: number,
  state: CommitParseState,
): number {
  for (let c = 1; c < arg.length; c++) {
    const ch = arg[c] ?? '';
    if (SHORT_BOOL_FLAGS.has(ch)) {
      if (ch === 'a') state.hasAll = true;
      else if (ch === 'p' || ch === 'i') state.hasInteractiveOrPatch = true;
      continue;
    }
    if (SHORT_OPT_ATTACHED_FLAGS.has(ch)) {
      return idx;
    }
    if (SHORT_REQ_VALUE_FLAGS.has(ch)) {
      const rest = arg.slice(c + 1);
      if (ch === 'F') state.hasMessageFile = true;
      else if (ch === 'C') state.hasNonInteractiveMsgSource = true;
      if (ch === 'm') {
        if (rest.length > 0) {
          state.messages.push(rest);
          return idx;
        }
        const nextMsg = args[idx + 1];
        if (nextMsg !== undefined) state.messages.push(nextMsg);
        return idx + 1;
      }
      return rest.length > 0 ? idx : idx + 1;
    }
    return idx;
  }
  return idx;
}

function parseCommitMessageOrValueFlag(
  arg: string,
  args: readonly string[],
  idx: number,
  state: CommitParseState,
): number {
  if (isLongMessageFlag(arg)) {
    const nextMsg = args[idx + 1];
    if (nextMsg !== undefined) state.messages.push(nextMsg);
    return idx + 1;
  }
  const longMsgVal = extractLongMessageEqValue(arg);
  if (longMsgVal !== null) {
    state.messages.push(longMsgVal);
    return idx;
  }
  if (!arg.startsWith('--')) {
    if (arg.startsWith('-') && arg.length > 1) {
      return parseShortCluster(arg, args, idx, state);
    }
    state.pathspecs.push(arg);
    return idx;
  }
  const eqIdx = arg.indexOf('=');
  if (eqIdx !== -1) {
    const canonical = resolveLongValueFlag(arg.slice(0, eqIdx));
    if (canonical !== null) markNonInteractiveReuse(canonical, arg.slice(eqIdx + 1), state);
    return idx;
  }
  const canonical = resolveLongValueFlag(arg);
  if (canonical !== null) {
    markNonInteractiveReuse(canonical, args[idx + 1] ?? '', state);
    return idx + 1;
  }
  return idx;
}

export function parseGitCommitArgs(args: readonly string[]): ParsedGitCommitArgs {
  const prefix = parseGitTopLevelPrefix(args);
  const state: CommitParseState = {
    messages: [],
    pathspecs: [],
    hasAll: false,
    hasMessageFile: false,
    hasInteractiveOrPatch: false,
    hasNonInteractiveMsgSource: false,
  };
  let hasAmend = false;
  let hasDryRunFlag = false;
  let hasStatusFormatFlag = false;
  let hasPathspecFromFile = false;
  let pastDoubleDash = false;
  for (let i = prefix.commitStartIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (pastDoubleDash) {
      state.pathspecs.push(arg);
      continue;
    }
    if (arg === '--') {
      pastDoubleDash = true;
      continue;
    }
    if (isLongInteractiveOrPatchFlag(arg)) {
      state.hasInteractiveOrPatch = true;
    } else if (matchesLongPrefix(arg, '--amend', '--am')) {
      hasAmend = true;
    } else if (arg === '--all') {
      state.hasAll = true;
    } else if (arg === '--dry-run') {
      hasDryRunFlag = true;
    } else if (COMMIT_READONLY_FLAGS.has(arg)) {
      hasStatusFormatFlag = true;
    } else if (isNegatedDryRunFlag(arg)) {
      hasDryRunFlag = false;
    } else if (isNegatedStatusFormatFlag(arg)) {
      hasStatusFormatFlag = false;
    } else if (matchesLongPrefix(arg, '--no-edit', '--no-ed')) {
      state.hasNonInteractiveMsgSource = true;
    } else if (isPathspecFromFileFlag(arg)) {
      hasPathspecFromFile = true;
      if (!arg.includes('=')) i += 1;
    } else if (isLongFileFlag(arg)) {
      state.hasMessageFile = true;
      i += 1;
    } else if (isLongFileEqFlag(arg)) {
      state.hasMessageFile = true;
    } else {
      i = parseCommitMessageOrValueFlag(arg, args, i, state);
    }
  }
  return {
    message: state.messages.length > 0 ? state.messages.join('\n\n') : undefined,
    hasAmend,
    hasAll: state.hasAll,
    hasMessageFile: state.hasMessageFile,
    hasInteractiveOrPatch: state.hasInteractiveOrPatch,
    hasNonInteractiveMsgSource: state.hasNonInteractiveMsgSource,
    isDryRun: hasDryRunFlag || hasStatusFormatFlag,
    hasPathspecFromFile,
    pathspecs: state.pathspecs,
    gitDir: prefix.gitDir,
    workTree: prefix.workTree,
  };
}

export function readCommitMessage(args: readonly string[]): string | undefined {
  return parseGitCommitArgs(args).message;
}
