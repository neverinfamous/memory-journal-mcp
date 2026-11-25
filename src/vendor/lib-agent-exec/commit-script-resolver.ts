// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_SCRIPT_REF_RE = /^(?:(?:\.[\\/])?\.agents|.*[\\/]\.agents)[\\/]scripts[\\/]([a-zA-Z0-9_.-]+\.(?:ts|js|mjs))$/;
const TSX_COMMIT_SCRIPT_RE = /^(?:pnpm(?:\s+exec)?\s+|bun(?:x)?\s+|npx\s+|node\s+\S*?)?\b(?:tsx|cli\.mjs)\s+['"]?(?:\.[\\/])?scripts[\\/]commit\.ts['"]?\s*$/i;
const MAX_PACKAGE_JSON_BYTES = 1 * 1024 * 1024;

function isRegularNonSymlinkFile(filePath: string): boolean {
  const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isFile();
}

function isNonSymlinkDir(dirPath: string): boolean {
  const st = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isDirectory();
}

function tryRealpathNative(filePath: string): string | null {
  try {
    return fs.realpathSync.native(filePath);
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') {
      console.error(`⚠️ Compiled commit script probe warning: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

function isContainedInRealRoot(targetPath: string, realRoot: string): boolean {
  const realTarget = tryRealpathNative(targetPath);
  if (realTarget === null) return false;
  const normRoot = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
  const normTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  const rel = path.relative(normRoot, normTarget);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function resolveAgentScriptFallback(rawArg: string, projectDir: string): string | null {
  const matchResult = rawArg.match(AGENT_SCRIPT_REF_RE);
  if (matchResult === null) return null;

  if (fs.lstatSync(path.resolve(projectDir, rawArg), { throwIfNoEntry: false }) !== undefined) {
    return null;
  }

  const scriptName = matchResult[1];
  if (scriptName === undefined) return null;

  const localScriptPath = path.join(projectDir, 'scripts', scriptName);
  const realProjectDir = tryRealpathNative(projectDir);
  if (
    isRegularNonSymlinkFile(localScriptPath) &&
    realProjectDir !== null &&
    isContainedInRealRoot(localScriptPath, realProjectDir)
  ) {
    return `scripts/${scriptName}`;
  }

  if (fs.lstatSync(path.join(projectDir, '.git'), { throwIfNoEntry: false }) === undefined) {
    let ancestorDir = path.dirname(path.resolve(projectDir));
    for (let depth = 0; depth < 12; depth++) {
      const ancestorCandidate = path.join(ancestorDir, 'scripts', scriptName);
      if (isRegularNonSymlinkFile(ancestorCandidate)) {
        const realAncestor = tryRealpathNative(ancestorDir);
        if (realAncestor !== null && isContainedInRealRoot(ancestorCandidate, realAncestor)) {
          return ancestorCandidate;
        }
      }
      if (fs.lstatSync(path.join(ancestorDir, '.git'), { throwIfNoEntry: false }) !== undefined) {
        break;
      }
      const parent = path.dirname(ancestorDir);
      if (parent === ancestorDir) break;
      ancestorDir = parent;
    }
  }

  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const bundledScriptsDir = path.resolve(thisDir, '..');
  const distScriptsDir = path.resolve(thisDir, '..', '..', 'scripts');
  const bundledCandidates = [
    path.join(bundledScriptsDir, scriptName),
    path.join(distScriptsDir, scriptName),
    ...(scriptName === 'commit.ts'
      ? [
          path.join(bundledScriptsDir, 'commit', 'commit.ts'),
          path.join(bundledScriptsDir, 'commit', 'commit.js'),
          path.join(distScriptsDir, 'commit', 'commit.ts'),
          path.join(distScriptsDir, 'commit', 'commit.js'),
        ]
      : []),
  ];
  const nonSymlinkDirCache = new Map<string, boolean>();
  const checkNonSymlinkDir = (dir: string): boolean => {
    const hit = nonSymlinkDirCache.get(dir);
    if (hit !== undefined) return hit;
    const ok = isNonSymlinkDir(dir);
    nonSymlinkDirCache.set(dir, ok);
    return ok;
  };
  for (const bundledCandidate of bundledCandidates) {
    if (checkNonSymlinkDir(path.dirname(bundledCandidate)) && isRegularNonSymlinkFile(bundledCandidate)) {
      return bundledCandidate;
    }
  }

  return null;
}

function isAbsentOrNonSymlinkDir(dirPath: string): boolean {
  const st = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  return st === undefined || (!st.isSymbolicLink() && st.isDirectory());
}

function hasNewerTsInDir(dirPath: string, targetMtimeMs: number): boolean {
  const dirStat = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  if (dirStat === undefined) return false;
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return true;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return true;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (hasNewerTsInDir(fullPath, targetMtimeMs)) return true;
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const st = fs.lstatSync(fullPath, { throwIfNoEntry: false });
      if (st !== undefined && st.mtimeMs > targetMtimeMs) return true;
    }
  }
  return false;
}

/**
 * [INTENT]: Resolve a fresh precompiled `dist/vendor/commit/commit.js` bundle for `scripts/commit.ts`
 * so `pnpm [exec] tsx scripts/commit.ts` bypasses `pwsh` + `pnpm.cmd` + `tsx` compilation overhead.
 */
export function resolveFreshCompiledCommitBundle(
  rawScriptArg: string,
  projectDir: string
): string | null {
  if (!/(?:^|[/\\])commit\.ts$/i.test(rawScriptArg)) {
    return null;
  }
  const absScript = path.resolve(projectDir, rawScriptArg);
  const scriptDir = path.dirname(absScript);
  const repoRoot =
    path.basename(scriptDir).toLowerCase() === 'scripts'
      ? path.dirname(scriptDir)
      : projectDir;
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const validTargets = new Set([
    norm(path.join(repoRoot, 'scripts', 'commit.ts')),
    norm(path.join(repoRoot, 'src', 'vendor', 'commit', 'commit.ts')),
  ]);
  if (!validTargets.has(norm(absScript))) {
    return null;
  }
  const compiledPath = path.join(repoRoot, 'dist', 'vendor', 'commit', 'commit.js');
  try {
    const realRoot = tryRealpathNative(repoRoot);
    if (realRoot === null) return null;
    const absScriptDir = path.dirname(absScript);
    const scriptsDir = path.join(repoRoot, 'scripts');
    const sameScriptsDir = (process.platform === 'win32'
      ? absScriptDir.toLowerCase() === scriptsDir.toLowerCase()
      : absScriptDir === scriptsDir);
    if (
      !isNonSymlinkDir(path.join(repoRoot, 'dist')) ||
      !isNonSymlinkDir(path.join(repoRoot, 'dist', 'vendor')) ||
      !isNonSymlinkDir(path.join(repoRoot, 'dist', 'vendor', 'commit')) ||
      !isNonSymlinkDir(absScriptDir) ||
      !isAbsentOrNonSymlinkDir(path.join(repoRoot, 'src')) ||
      !isAbsentOrNonSymlinkDir(path.join(repoRoot, 'src', 'vendor')) ||
      (!sameScriptsDir && !isAbsentOrNonSymlinkDir(scriptsDir))
    ) {
      return null;
    }
    const compiledStats = fs.lstatSync(compiledPath, { throwIfNoEntry: false });
    if (compiledStats === undefined || compiledStats.isSymbolicLink() || !compiledStats.isFile()) {
      return null;
    }
    if (!isContainedInRealRoot(compiledPath, realRoot)) {
      return null;
    }
    const compiledMtime = compiledStats.mtimeMs;
    const targetStats = fs.lstatSync(absScript, { throwIfNoEntry: false });
    if (targetStats === undefined || targetStats.isSymbolicLink() || !targetStats.isFile() || targetStats.mtimeMs > compiledMtime) {
      return null;
    }
    if (!isContainedInRealRoot(absScript, realRoot)) {
      return null;
    }
    const scriptsCommit = path.join(repoRoot, 'scripts', 'commit.ts');
    if (norm(absScript) !== norm(scriptsCommit)) {
      const scriptsCommitStats = fs.lstatSync(scriptsCommit, { throwIfNoEntry: false });
      if (scriptsCommitStats !== undefined && (scriptsCommitStats.isSymbolicLink() || scriptsCommitStats.mtimeMs > compiledMtime)) {
        return null;
      }
    }
    const vendorCommitDir = path.join(repoRoot, 'src', 'vendor', 'commit');
    if (hasNewerTsInDir(vendorCommitDir, compiledMtime)) {
      return null;
    }
    return compiledPath;
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') {
      console.error(`⚠️ Compiled commit script probe warning: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

function packageUsesTsxCommitScript(projectDir: string): boolean {
  const pkgPath = path.join(projectDir, 'package.json');
  const st = fs.lstatSync(pkgPath, { throwIfNoEntry: false });
  if (st === undefined || st.isSymbolicLink() || !st.isFile() || st.size > MAX_PACKAGE_JSON_BYTES) {
    return false;
  }
  try {
    const rawContent = fs.readFileSync(pkgPath, 'utf8');
    const cleanContent = rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;
    const rawPkg: unknown = JSON.parse(cleanContent);
    if (rawPkg === null || typeof rawPkg !== 'object' || !('scripts' in rawPkg)) {
      return false;
    }
    const scripts = rawPkg.scripts;
    if (scripts === null || typeof scripts !== 'object' || !('commit' in scripts)) {
      return false;
    }
    return typeof scripts.commit === 'string' && TSX_COMMIT_SCRIPT_RE.test(scripts.commit);
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      console.error(`⚠️ package.json commit script probe warning (${pkgPath}): ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

const PM_COMMIT_DIR_VALUE_FLAGS: ReadonlySet<string> = new Set(['--dir', '-C', '--cwd', '--prefix']);
const PM_COMMIT_VALUE_FLAGS: ReadonlySet<string> = new Set(['--config', '-c', '--userconfig']);
const PM_COMMIT_ABORT_FLAGS: ReadonlySet<string> = new Set([
  '--filter', '-F', '-p', '--package',
  '--help', '-h', '--version', '-v',
  '-r', '--recursive', '-w', '--workspace', '--workspaces', '--workspace-root',
]);
const PM_COMMIT_ABORT_PREFIXES: readonly string[] = [
  '--filter=', '--package=', '--workspace=', '-F', '-p',
];
const PM_COMMIT_DIR_EQ_RE = /^(?:--dir|--cwd|--prefix|-C)=(.*)$/;
const COMMIT_VALUE_FLAGS_WITH_NEXT: ReadonlySet<string> = new Set([
  '-m', '--msg', '--history', '--category', '--impact', '--confidence', '--validation',
  '--cwd', '--journal-project', '--session-id', '--tags', '--significance', '--relate', '--add',
]);

function findCommitTargetStart(args: readonly string[]): { idx: number; hasDirFlag: boolean } | null {
  let hasDirFlag = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') return null;
    if (PM_COMMIT_ABORT_FLAGS.has(a) || PM_COMMIT_ABORT_PREFIXES.some((prefix) => a.startsWith(prefix))) return null;
    if (PM_COMMIT_DIR_VALUE_FLAGS.has(a)) {
      const val = args[i + 1];
      if (val === undefined || val.trim().length === 0) return null;
      hasDirFlag = true;
      i++;
      continue;
    }
    const dirEqMatch = PM_COMMIT_DIR_EQ_RE.exec(a);
    if (dirEqMatch !== null) {
      if ((dirEqMatch[1] ?? '').trim().length === 0) return null;
      hasDirFlag = true;
      continue;
    }
    if (PM_COMMIT_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    return { idx: i, hasDirFlag };
  }
  return null;
}

function hasExplicitCommitCwdFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--cwd' || a.startsWith('--cwd=')) return true;
    if (COMMIT_VALUE_FLAGS_WITH_NEXT.has(a)) {
      i++;
    }
  }
  return false;
}

function appendCwdIfDirFlagStripped(remaining: string[], hasDirFlag: boolean, projectDir: string): string[] {
  if (!hasDirFlag || hasExplicitCommitCwdFlag(remaining)) {
    return remaining;
  }
  return ['--cwd', projectDir, ...remaining];
}

export function tryAccelerateCompiledCommitScript(
  args: string[],
  projectDir: string,
  target?: string
): { compiledPath: string; remainingArgs: string[] } | null {
  if (target === 'wsl2') return null;
  const start = findCommitTargetStart(args);
  if (start === null) return null;
  const firstToken = args[start.idx];
  const secondToken = args[start.idx + 1];

  if ((firstToken === 'commit' || (firstToken === 'run' && secondToken === 'commit')) && packageUsesTsxCommitScript(projectDir)) {
    const flagStart = firstToken === 'run' ? start.idx + 2 : start.idx + 1;
    const compiledPath = resolveFreshCompiledCommitBundle('scripts/commit.ts', projectDir);
    if (compiledPath !== null) {
      const rem = args.slice(flagStart);
      const unwrapped = rem[0] === '--' ? rem.slice(1) : rem;
      return {
        compiledPath,
        remainingArgs: appendCwdIfDirFlagStripped(unwrapped, start.hasDirFlag, projectDir),
      };
    }
  }

  let tsxIdx = -1;
  if (firstToken === 'tsx' && secondToken !== undefined && !secondToken.startsWith('-')) {
    tsxIdx = start.idx;
  } else if (
    (firstToken === 'exec' || firstToken === 'run') &&
    secondToken === 'tsx' &&
    args[start.idx + 2] !== undefined &&
    !(args[start.idx + 2] ?? '').startsWith('-')
  ) {
    tsxIdx = start.idx + 1;
  }
  if (tsxIdx === -1) return null;

  const scriptCandidate = args[tsxIdx + 1];
  if (scriptCandidate === undefined) return null;
  const compiledPath = resolveFreshCompiledCommitBundle(scriptCandidate, projectDir);
  if (compiledPath === null) return null;
  return {
    compiledPath,
    remainingArgs: appendCwdIfDirFlagStripped(args.slice(tsxIdx + 2), start.hasDirFlag, projectDir),
  };
}
