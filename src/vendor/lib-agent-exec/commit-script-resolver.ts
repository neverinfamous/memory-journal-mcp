// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_SCRIPT_REF_RE = /^(?:(?:\.[\\/])?\.agents|.*[\\/]\.agents)[\\/]scripts[\\/]([a-zA-Z0-9_.-]+\.(?:ts|js|mjs))$/;
const TSX_COMMIT_SCRIPT_RE = /^(?:pnpm(?:\s+exec)?\s+|bun(?:x)?\s+|npx\s+|node\s+\S*?)?\b(?:tsx|cli\.mjs)\s+['"]?(?:\.[\\/])?scripts[\\/]commit\.ts['"]?\s*$/i;

export function resolveAgentScriptFallback(rawArg: string, projectDir: string): string | null {
  const matchResult = rawArg.match(AGENT_SCRIPT_REF_RE);
  if (matchResult === null) return null;

  if (fs.statSync(path.resolve(projectDir, rawArg), { throwIfNoEntry: false }) !== undefined) {
    return null;
  }

  const scriptName = matchResult[1];
  if (scriptName === undefined) return null;

  const localScriptPath = path.join(projectDir, 'scripts', scriptName);
  if (fs.statSync(localScriptPath, { throwIfNoEntry: false }) !== undefined) {
    return `scripts/${scriptName}`;
  }

  let ancestorDir = path.dirname(path.resolve(projectDir));
  while (true) {
    const ancestorCandidate = path.join(ancestorDir, 'scripts', scriptName);
    if (fs.statSync(ancestorCandidate, { throwIfNoEntry: false }) !== undefined) {
      return ancestorCandidate;
    }
    const parent = path.dirname(ancestorDir);
    if (parent === ancestorDir) break;
    ancestorDir = parent;
  }

  const bundledScriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bundledCandidates = [
    path.join(bundledScriptsDir, scriptName),
    ...(scriptName === 'commit.ts'
      ? [
          path.join(bundledScriptsDir, 'commit', 'commit.ts'),
          path.join(bundledScriptsDir, 'commit', 'commit.js'),
        ]
      : []),
  ];
  for (const bundledCandidate of bundledCandidates) {
    if (fs.statSync(bundledCandidate, { throwIfNoEntry: false }) !== undefined) {
      return bundledCandidate;
    }
  }

  return null;
}

function hasNewerTsInDir(dirPath: string, targetMtimeMs: number): boolean {
  const dirStat = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  if (dirStat === undefined || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
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
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const validTargets = new Set([
    norm(path.join(repoRoot, 'scripts', 'commit.ts')),
    norm(path.join(repoRoot, 'src', 'vendor', 'commit', 'commit.ts')),
  ]);
  if (!validTargets.has(norm(absScript))) {
    return null;
  }
  const compiledPath = path.join(repoRoot, 'dist', 'vendor', 'commit', 'commit.js');
  try {
    const compiledStats = fs.statSync(compiledPath, { throwIfNoEntry: false });
    if (compiledStats === undefined || !compiledStats.isFile()) {
      return null;
    }
    const compiledMtime = compiledStats.mtimeMs;
    const targetStats = fs.statSync(absScript, { throwIfNoEntry: false });
    if (targetStats === undefined || !targetStats.isFile() || targetStats.mtimeMs > compiledMtime) {
      return null;
    }
    const scriptsCommit = path.join(repoRoot, 'scripts', 'commit.ts');
    if (norm(absScript) !== norm(scriptsCommit)) {
      const scriptsCommitStats = fs.statSync(scriptsCommit, { throwIfNoEntry: false });
      if (scriptsCommitStats !== undefined && scriptsCommitStats.mtimeMs > compiledMtime) {
        return null;
      }
    }
    const vendorCommitDir = path.join(repoRoot, 'src', 'vendor', 'commit');
    if (hasNewerTsInDir(vendorCommitDir, compiledMtime)) {
      return null;
    }
    return compiledPath;
  } catch {
    return null;
  }
}

function packageUsesTsxCommitScript(projectDir: string): boolean {
  try {
    const rawPkg: unknown = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    if (rawPkg === null || typeof rawPkg !== 'object' || !('scripts' in rawPkg)) {
      return false;
    }
    const scripts = rawPkg.scripts;
    if (scripts === null || typeof scripts !== 'object' || !('commit' in scripts)) {
      return false;
    }
    return typeof scripts.commit === 'string' && TSX_COMMIT_SCRIPT_RE.test(scripts.commit);
  } catch {
    return false;
  }
}

export function tryAccelerateCompiledCommitScript(
  args: string[],
  projectDir: string,
  target?: string
): { compiledPath: string; remainingArgs: string[] } | null {
  if (target === 'wsl2') return null;

  if ((args[0] === 'commit' || (args[0] === 'run' && args[1] === 'commit')) && packageUsesTsxCommitScript(projectDir)) {
    const flagStart = args[0] === 'run' ? 2 : 1;
    const compiledPath = resolveFreshCompiledCommitBundle('scripts/commit.ts', projectDir);
    if (compiledPath !== null) {
      const rem = args.slice(flagStart);
      return {
        compiledPath,
        remainingArgs: rem[0] === '--' ? rem.slice(1) : rem,
      };
    }
  }

  let tsxIdx = -1;
  if (args[0] === 'tsx' && args[1] !== undefined && !args[1].startsWith('-')) {
    tsxIdx = 0;
  } else if (
    (args[0] === 'exec' || args[0] === 'run') &&
    args[1] === 'tsx' &&
    args[2] !== undefined &&
    !args[2].startsWith('-')
  ) {
    tsxIdx = 1;
  }
  if (tsxIdx === -1) return null;

  const scriptCandidate = args[tsxIdx + 1];
  if (scriptCandidate === undefined) return null;
  const compiledPath = resolveFreshCompiledCommitBundle(scriptCandidate, projectDir);
  if (compiledPath === null) return null;
  return {
    compiledPath,
    remainingArgs: args.slice(tsxIdx + 2),
  };
}
