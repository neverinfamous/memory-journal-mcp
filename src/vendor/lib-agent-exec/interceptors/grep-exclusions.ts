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

export function isGrepTargetExplicitlyIncluded(targetPaths: readonly string[], dir: string): boolean {
  const dirLower = dir.toLowerCase();
  return targetPaths.some((target) => {
    const clean = target.trim().replace(/^['"`]|['"`]$/g, '').replace(/\\/g, '/').toLowerCase();
    return clean.split('/').filter(Boolean).includes(dirLower);
  });
}

function hasExcludeDir(args: string[], dir: string): boolean {
  return args.some((arg) => arg === `--exclude-dir=${dir}` || arg === `'--exclude-dir=${dir}'` || arg === `"--exclude-dir=${dir}"`);
}

function hasExcludePattern(args: string[], pattern: string): boolean {
  return args.some((arg) => arg === `--exclude=${pattern}` || arg === `'--exclude=${pattern}'` || arg === `"--exclude=${pattern}"`);
}

export function injectRecursiveGrepExclusions(args: string[], targetPaths: readonly string[] = []): void {
  const missingExcludes = GREP_EXCLUDE_DIRS.filter(
    (dir) => !isGrepTargetExplicitlyIncluded(targetPaths, dir) && !hasExcludeDir(args, dir),
  );
  if (missingExcludes.length > 0) {
    console.error(
      `\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted Windows filesystem detected. Auto-injecting --exclude-dir for node_modules, .git, and dist (and artifact/cache dirs) to prevent timeouts... (Frictionless Recovery)`
    );
    args.unshift(...missingExcludes.map((dir) => `--exclude-dir=${dir}`));
  }
  if (!args.some((arg) => arg.startsWith('--binary-files='))) {
    args.unshift('--binary-files=without-match');
  }
  const binaryPatterns = ['*.db', '*.sqlite', '*.sqlite3', '*.lock'];
  for (const pat of binaryPatterns) {
    if (!hasExcludePattern(args, pat)) args.unshift(`--exclude=${pat}`);
  }
}
