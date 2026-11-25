// @ts-nocheck
export const GREP_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'dist-node',
  'coverage',
  'build',
  '.test-output',
  'test-results',
  'tmp',
  'logs',
  '.cache',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.gemini',
  '.vscode',
  '.agents',
  '.wrangler',
  '.venv',
  'venv',
  'vendor',
  '.pnpm-store',
  '.parcel-cache',
  'bak',
  'data',
  'releases',
];

const BINARY_EXCLUDE_PATTERNS = ['*.db', '*.sqlite', '*.sqlite3', '*.lock'] as const;

export function collectTargetPathSegments(targetPaths: readonly string[]): Set<string> {
  const segments = new Set<string>();
  for (const target of targetPaths) {
    const clean = target.trim().replace(/^['"`]|['"`]$/g, '').replace(/\\/g, '/').toLowerCase();
    for (const seg of clean.split('/')) {
      if (seg.length > 0) segments.add(seg);
    }
  }
  return segments;
}

export function isGrepTargetExplicitlyIncluded(targetPaths: readonly string[], dir: string): boolean {
  return collectTargetPathSegments(targetPaths).has(dir.toLowerCase());
}

function unquoteShellFlagArg(arg: string): string {
  if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
    return arg.slice(1, -1);
  }
  return arg;
}

function collectExistingGrepFlags(args: readonly string[]): {
  excludeDirs: Set<string>;
  excludePatterns: Set<string>;
  hasBinaryFilesFlag: boolean;
} {
  const excludeDirs = new Set<string>();
  const excludePatterns = new Set<string>();
  let hasBinaryFilesFlag = false;
  for (const rawArg of args) {
    if (!hasBinaryFilesFlag && rawArg.startsWith('--binary-files=')) hasBinaryFilesFlag = true;
    const arg = unquoteShellFlagArg(rawArg);
    if (arg.startsWith('--exclude-dir=')) excludeDirs.add(arg.slice('--exclude-dir='.length));
    else if (arg.startsWith('--exclude=')) excludePatterns.add(arg.slice('--exclude='.length));
  }
  return { excludeDirs, excludePatterns, hasBinaryFilesFlag };
}

export function injectRecursiveGrepExclusions(
  args: string[],
  targetPaths: readonly string[] = [],
  onSync?: () => void,
): void {
  const targetSegments = collectTargetPathSegments(targetPaths);
  const { excludeDirs, excludePatterns, hasBinaryFilesFlag } = collectExistingGrepFlags(args);
  const missingExcludes = GREP_EXCLUDE_DIRS.filter(
    (dir) => !targetSegments.has(dir.toLowerCase()) && !excludeDirs.has(dir),
  );
  const prependFlags: string[] = [];
  for (let i = BINARY_EXCLUDE_PATTERNS.length - 1; i >= 0; i--) {
    const pat = BINARY_EXCLUDE_PATTERNS[i];
    if (pat !== undefined && !excludePatterns.has(pat)) prependFlags.push(`--exclude=${pat}`);
  }
  const addedBinaryPat = prependFlags.length > 0;
  if (!hasBinaryFilesFlag) prependFlags.push('--binary-files=without-match');
  for (const dir of missingExcludes) prependFlags.push(`--exclude-dir=${dir}`);
  if (prependFlags.length > 0) {
    args.unshift(...prependFlags);
  }
  if (!hasBinaryFilesFlag || missingExcludes.length > 0 || addedBinaryPat) {
    onSync?.();
  }
  if (missingExcludes.length > 0) {
    console.error(
      `\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted Windows filesystem detected. Auto-injecting --exclude-dir for node_modules, .git, and dist (and artifact/cache dirs) to prevent timeouts... (Frictionless Recovery)`
    );
  }
}
