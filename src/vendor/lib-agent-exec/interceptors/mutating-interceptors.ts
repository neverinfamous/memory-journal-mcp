// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { match, P } from 'ts-pattern';
import { execFileSync, spawnSync } from 'node:child_process';
import { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';
import { sanitizeJqInvocation } from './jq-sanitizer.js';

/** [INVARIANT]: Keep in sync with commit.ts stale-lock threshold (5 minutes). */
export const STALE_INDEX_LOCK_MS = 5 * 60 * 1000;

const AGENTS_PATH_RE = process.platform === 'win32'
  ? /(?:^|[\\/])\.agents(?:[\\/]|$)/i
  : /(?:^|[\\/])\.agents(?:[\\/]|$)/;
const PRIVATE_PATH_RE = /(?:^|[\\/])\.agents[\\/](?:scratch|cache)(?:[\\/]|$)|issues\.jsonl$/i;
const GIT_ADD_FORCE_RE = /^-[nvfipeuAN]*f[nvfipeuAN]*$/;

export interface GitIgnoreProbe {
  ignored: boolean;
  pattern: string | null;
}

/**
 * [INTENT]: Ask git (in the payload cwd) whether a path is ignored, and by which pattern.
 * Tracked files are never reported as ignored by `git check-ignore`.
 */
export function probeGitIgnore(cwd: string, target: string): GitIgnoreProbe {
  try {
    const res = spawnSync('git', ['check-ignore', '-v', '--', target], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (res.status !== 0 || typeof res.stdout !== 'string' || res.stdout.trim() === '') {
      return { ignored: false, pattern: null };
    }
    // Format: <source>:<linenum>:<pattern>\t<pathname>
    const meta = (res.stdout.split(/\r?\n/)[0] ?? '').split('\t')[0] ?? '';
    const patternMatch = meta.match(/^.*?:\d+:(.*)$/);
    const pattern = patternMatch !== null && patternMatch[1] !== undefined ? patternMatch[1] : null;
    if (pattern !== null && pattern.startsWith('!')) {
      return { ignored: false, pattern };
    }
    return { ignored: true, pattern };
  } catch {
    return { ignored: false, pattern: null };
  }
}

export function isWholesaleAgentsIgnore(pattern: string | null): boolean {
  if (pattern === null) return false;
  const norm = pattern.trim().replace(/^\/+/, '').replace(/^\*\*\//, '');
  return ['.agents', '.agents/', '.agents/*', '.agents/**'].includes(norm);
}

interface ParsedGitInvocation {
  gitCwd: string;
  subcmdIndex: number;
  subcmd: string | undefined;
}

/**
 * [INTENT]: Resolve effective git working directory (honoring top-level `-C <dir>`) and locate the git subcommand
 * before `gitInterceptor` strips `-C`, preventing false matches on arguments like `git remote add`.
 */
function parseGitInvocation(ctx: ExecutionContext): ParsedGitInvocation {
  const baseCwd =
    ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
      ? path.resolve(ctx.payload.cwd)
      : ctx.cwd !== undefined && ctx.cwd.length > 0
        ? path.resolve(ctx.cwd)
        : process.cwd();
  let gitCwd = baseCwd;
  let i = 0;
  while (i < ctx.args.length) {
    const a = ctx.args[i];
    if (a === undefined) break;
    if (a === '-C') {
      const next = ctx.args[i + 1];
      if (next !== undefined && !/^\d+$/.test(next)) {
        gitCwd = path.isAbsolute(next) ? next : path.resolve(gitCwd, next);
      }
      i += 2;
      continue;
    }
    if (a.startsWith('-C') && a.length > 2) {
      const candidate = a.slice(2);
      if (!/^\d+$/.test(candidate)) {
        gitCwd = path.isAbsolute(candidate) ? candidate : path.resolve(gitCwd, candidate);
      }
      i += 1;
      continue;
    }
    if (a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace' || a === '--exec-path') {
      i += 2;
      continue;
    }
    if (a.startsWith('-')) {
      i += 1;
      continue;
    }
    break;
  }
  return { gitCwd, subcmdIndex: i, subcmd: ctx.args[i] };
}

function syncPayloadArgs(ctx: ExecutionContext): void {
  if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
    ctx.payload.args = [...ctx.args];
  }
}

function collectGitPathspecs(afterArgs: readonly string[]): Array<{ offset: number; value: string }> {
  const specs: Array<{ offset: number; value: string }> = [];
  let sawSeparator = false;
  for (let offset = 0; offset < afterArgs.length; offset++) {
    const a = afterArgs[offset];
    if (a === undefined) continue;
    if (!sawSeparator && a === '--') { sawSeparator = true; continue; }
    if (!sawSeparator && a.startsWith('-')) continue;
    specs.push({ offset, value: a });
  }
  return specs;
}

export function findAlreadyStagedGitDeletions(gitCwd: string, rawPathspecs: readonly string[]): Set<string> {
  const stagedDeletions = new Set<string>();
  const missingTargets: Array<{ original: string; relPosix: string }> = [];
  for (const rawPathspec of rawPathspecs) {
    const cleaned = rawPathspec.trim().replace(/^['"]|['"]$/g, '');
    if (cleaned.length === 0 || cleaned === '.' || cleaned === '..' || cleaned.startsWith(':') || /[*?[\]]/.test(cleaned)) continue;
    const absPath = path.resolve(gitCwd, cleaned);
    if (fs.statSync(absPath, { throwIfNoEntry: false }) !== undefined) continue;
    const rel = path.relative(gitCwd, absPath);
    if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    missingTargets.push({ original: rawPathspec, relPosix: rel.replace(/\\/g, '/') });
  }
  if (missingTargets.length === 0) return stagedDeletions;
  try {
    const cachedDelRes = spawnSync('git', ['diff', '--cached', '--relative', '--name-only', '--diff-filter=D', '-z', '--', ...missingTargets.map(m => m.relPosix)], { cwd: gitCwd, encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (cachedDelRes.status !== 0 || typeof cachedDelRes.stdout !== 'string') return stagedDeletions;
    const cachedDeletedSet = new Set(cachedDelRes.stdout.split('\0').filter(Boolean));
    for (const item of missingTargets) {
      if (cachedDeletedSet.has(item.relPosix)) stagedDeletions.add(item.original);
    }
  } catch {
    return stagedDeletions;
  }
  return stagedDeletions;
}

/**
 * [INTENT]: Detect when a non-glob pathspec is absent from both the worktree and `.git/index`, yet already staged
 * as a deletion (`D  <path>`) relative to `HEAD`. In that state, `git rm <path>` and `git add [-u] <path>` exit 128
 * (`did not match any files`) even though the caller's staging intent is already satisfied.
 * [INVARIANT]: Returns false for unstaged deletions (` D`), recreated files on disk, globs, and genuine path typos.
 */
export function isAlreadyStagedGitDeletion(gitCwd: string, rawPathspec: string): boolean {
  return findAlreadyStagedGitDeletions(gitCwd, [rawPathspec]).has(rawPathspec);
}

function healGitRmStagedDeletions(ctx: ExecutionContext, gitCwd: string, rmIdx: number): void {
  const afterRm = ctx.args.slice(rmIdx + 1);
  if (afterRm.includes('--ignore-unmatch') || afterRm.some(a => a === '--pathspec-from-file' || a.startsWith('--pathspec-from-file='))) return;
  const paths = collectGitPathspecs(afterRm).map(s => s.value);
  if (paths.length > 0 && findAlreadyStagedGitDeletions(gitCwd, paths).size > 0) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '--ignore-unmatch' into 'git rm' for already-staged deletion(s)... (Frictionless Recovery)\x1b[0m`);
    ctx.args.splice(rmIdx + 1, 0, '--ignore-unmatch');
    syncPayloadArgs(ctx);
  }
}

function healGitAddStagedDeletions(ctx: ExecutionContext, gitCwd: string, addIdx: number): boolean {
  const afterAdd = ctx.args.slice(addIdx + 1);
  if (afterAdd.some(a => ['-n', '--dry-run', '-i', '--interactive', '-p', '--patch', '-e', '--edit', '--pathspec-from-file'].includes(a) || a.startsWith('--pathspec-from-file='))) {
    return false;
  }
  const pathSpecs = collectGitPathspecs(afterAdd).map(s => ({ argIndex: addIdx + 1 + s.offset, value: s.value }));
  if (pathSpecs.length === 0) return false;
  const stagedSet = findAlreadyStagedGitDeletions(gitCwd, pathSpecs.map(s => s.value));
  if (stagedSet.size === 0) return false;
  const stagedDeleted = pathSpecs.filter(s => stagedSet.has(s.value));
  if (pathSpecs.length > stagedDeleted.length) {
    for (let idx = stagedDeleted.length - 1; idx >= 0; idx--) {
      const item = stagedDeleted[idx];
      if (item !== undefined) ctx.args.splice(item.argIndex, 1);
    }
    syncPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Omitting already-staged deletion(s) from 'git add' pathspecs to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
    return false;
  }
  // [INVARIANT]: Never strip the sole pathspec from `git add -u <path>`, which would widen staging to the whole repo.
  const prefixFlags = ctx.args.slice(0, addIdx);
  ctx.args.splice(0, ctx.args.length, ...prefixFlags, 'ls-files', '--stage', '--', ...stagedDeleted.map(s => s.value));
  syncPayloadArgs(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Pathspec(s) passed to 'git add' are already staged as deleted; treating as idempotent no-op to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
  return true;
}

/**
 * [INTENT]: `git add` on `.agents` paths: inject `-f` only when git reports the path ignored by a narrow rule.
 * [INVARIANT]: Never force-add scratch/cache dirs, `*issues.jsonl` logs, or `.agents/` in repos that ignore it
 * wholesale (satellite repos keep private agent tooling out of public history).
 */
function healGitAddForceFlag(ctx: ExecutionContext, gitCwd: string, addIdx: number): void {
  if (addIdx === -1) return;
  const afterAdd = ctx.args.slice(addIdx + 1);
  const hasForce = afterAdd.some(a => a === '--force' || GIT_ADD_FORCE_RE.test(a));

  const paths: string[] = [];
  let sawSeparator = false;
  for (const a of afterAdd) {
    if (!sawSeparator && a === '--') {
      sawSeparator = true;
      continue;
    }
    if (!sawSeparator && a.startsWith('-')) continue;
    paths.push(a);
  }

  let hasNonAgentsPath = false;
  let anyIgnoredAgents = false;
  for (const p of paths) {
    const isPrivate = PRIVATE_PATH_RE.test(p);
    if (isPrivate) {
      console.error(`\n   💡 AGENT HINT: Refusing to ${hasForce ? 'force-add' : 'add'} '${p}': scratch/cache directories and *issues.jsonl logs are private runtime state.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Remove '${p}' from 'git add' (and drop -f). Stage explicit tracked paths only. Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
      return;
    }
    const isAgents = AGENTS_PATH_RE.test(p) || p.toLowerCase() === '.agents';
    if (!isAgents) {
      hasNonAgentsPath = true;
      continue;
    }

    const probe = probeGitIgnore(gitCwd, p);
    if (probe.ignored && isWholesaleAgentsIgnore(probe.pattern)) {
      console.error(`\n   💡 AGENT HINT: Refusing to ${hasForce ? 'force-add' : 'add'} '${p}': this repo ignores '.agents/' wholesale (${probe.pattern ?? '.agents/'}), so its agent tooling must stay out of git.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Remove '${p}' from 'git add' (and drop -f). Stage explicit tracked paths only. Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
      return;
    }
    if (probe.ignored) {
      anyIgnoredAgents = true;
    }
  }

  if (paths.length > 0 && !hasForce && !hasNonAgentsPath && anyIgnoredAgents) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '-f' to 'git add' for '.agents' path(s) that git check-ignore reports as ignored... (Frictionless Recovery)\x1b[0m`);
    ctx.args.splice(addIdx + 1, 0, '-f');
    syncPayloadArgs(ctx);
  }
}

function healGitMutatingCommand(ctx: ExecutionContext, matchedArgs: readonly string[]): void {
  const { gitCwd, subcmdIndex, subcmd } = parseGitInvocation(ctx);
  const lockPath = path.join(gitCwd, '.git', 'index.lock');
  const lockStats = fs.statSync(lockPath, { throwIfNoEntry: false });
  if (lockStats !== undefined && Date.now() - lockStats.mtimeMs > STALE_INDEX_LOCK_MS) {
    try {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected stale '.git/index.lock' (age: ${Math.round((Date.now() - lockStats.mtimeMs) / 1000)}s). Removing lock to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
  if (ctx.payload.target !== 'wsl2') {
    if (subcmd === 'rm') {
      healGitRmStagedDeletions(ctx, gitCwd, subcmdIndex);
    } else if (subcmd === 'add') {
      const rewrittenToNoop = healGitAddStagedDeletions(ctx, gitCwd, subcmdIndex);
      if (!rewrittenToNoop) healGitAddForceFlag(ctx, gitCwd, subcmdIndex);
    }
  }
  if (subcmd === 'branch' && matchedArgs.includes('-r')) {
    console.error(`\n   💡 AGENT HINT: 'git branch -r' may return stale deleted branches.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Synchronously running 'git fetch -p' to prune the cache before executing branch listing.\x1b[0m`);
    try {
      execFileSync('git', ['fetch', '-p'], { cwd: gitCwd, stdio: 'ignore', timeout: 60000, windowsHide: true });
    } catch {
      // ignore
    }
  }
}

export function runMutatingInterceptors(
  ctx: ExecutionContext,
  derived: { cmd: string; cmdBasename: string; args: string[] }
) {
  const { cmd, cmdBasename, args } = derived;

  match({ cmd, args })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args: matchedArgs }) => {
      if (!matchedArgs.some(a => a.includes('BatchMode=yes'))) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.... (Frictionless Recovery)`);
        ctx.args.unshift('-o', 'BatchMode=yes');
      }
      if (!matchedArgs.some(a => a.includes('StrictHostKeyChecking='))) {
        ctx.args.unshift('-o', 'StrictHostKeyChecking=accept-new');
      }
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args: matchedArgs }) => {
      if ((process.platform === 'win32' && ctx.payload.target !== 'wsl2') || cmd === 'ping.exe') {
        if (matchedArgs.includes('-t')) {
          console.error(`\n   💡 AGENT HINT: 'ping -t' runs indefinitely. Stripping '-t'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
          for (let i = ctx.args.length - 1; i >= 0; i--) {
            if (ctx.args[i] === '-t') ctx.args.splice(i, 1);
          }
        }
      } else {
        if (!matchedArgs.includes('-c')) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.... (Frictionless Recovery)`);
          ctx.args.unshift('-c', '4');
        }
      }
    })
    .with({ cmd: P.union('rm', 'rm.exe') }, ({ args: matchedArgs }) => {
      const hasForce = matchedArgs.some(a => a === '-f' || a === '--force' || /^-([a-zA-Z]*f[a-zA-Z]*)$/.test(a));
      if (!hasForce) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-f' into rm command to prevent interactive prompts and missing file errors.... (Frictionless Recovery)\x1b[0m`);
        ctx.args.unshift('-f');
      }
    })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args: matchedArgs }) => {
      if ((process.platform !== 'win32' || ctx.payload.target === 'wsl2') && !matchedArgs.includes('-n') && !matchedArgs.includes('--non-interactive')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.... (Frictionless Recovery)`);
        ctx.args.unshift('-n');
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, ({ args: matchedArgs }) => {
      const hasFollow = matchedArgs.some(a => a === '-f' || a === '--follow' || /^-[exqrkaobml]*f[exqrkaobml]*$/i.test(a));
      if (hasFollow) return;
      if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: 'journalctl' requires Linux systemd. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        ctx.payload.target = 'wsl2';
      }
      if (!matchedArgs.includes('--no-pager')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-pager' into ${cmdBasename} command to prevent pager hanging... (Frictionless Recovery)\x1b[0m`);
        ctx.args.unshift('--no-pager');
      }
    })
    .with({ cmd: P.union('git', 'git.exe') }, ({ args: matchedArgs }) => {
      healGitMutatingCommand(ctx, matchedArgs);
    })
    .with({ cmd: P.union('jq', 'jq.exe') }, ({ args: matchedArgs }) => {
      sanitizeJqInvocation(ctx, matchedArgs);
    })
    .otherwise(() => {});
}
