// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONLESS_FILENAMES_REGEX = /^(?:Makefile|Dockerfile|Containerfile|Procfile|Gemfile|Rakefile|Brewfile|Vagrantfile|Jenkinsfile|Justfile|LICENSE|README|CHANGELOG|AUTHORS|CODEOWNERS|OWNERS)$/i;

export const KNOWN_POSIX_ROOT_DIRS_REGEX = /^\/(?:etc|var|var\/log|tmp|usr|usr\/local|opt|home|root|srv|bin|sbin|lib|lib64|dev|proc|sys|run)$/;

export function hasUnambiguousRegexMeta(arg: string): boolean {
  return /[()*+?[\]^$|{}]/.test(arg) || arg.includes('|');
}

function hasNonGlobRegexMeta(arg: string): boolean {
  return /[()+[\]^$|{}]/.test(arg) || arg.includes('|');
}

// [INTENT]: Recognize real filesystem paths/globs that legally contain `+` (e.g. `.pnpm/@scope+pkg*`) or `[id]` segments before regex-meta rejection.
export function hasUnmistakableStructuredPathPrefix(arg: string): boolean {
  if (/\s/.test(arg) || /[()^{}$|]/.test(arg)) return false;
  if (/^(?:\.{1,2}[/\\]|node_modules[/\\]|\.pnpm[/\\]|\/mnt\/[a-zA-Z][/\\]|[a-zA-Z]:[/\\])/.test(arg)) {
    return true;
  }
  return arg.includes('/.pnpm/') || arg.includes('\\.pnpm\\') || arg.includes('/node_modules/') || arg.includes('\\node_modules\\');
}

function isIgnorableSearchFsError(err: unknown): boolean {
  const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG' || code === 'EINVAL' || code === 'EACCES';
}

export function existsOnDisk(arg: string, cwd?: string): boolean {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    return fs.existsSync(path.resolve(baseDir, arg));
  } catch (err: unknown) {
    if (!isIgnorableSearchFsError(err)) console.error(`⚠️ Path exists check warning (${arg}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function hasBackslashRegexEscape(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (isWindowsBackslashPath(arg, cwd, cache)) return false;
  return /\\[bBwWdDsSnrtv0()[\]{}.*+?^$|\-.]/.test(arg);
}

// [INTENT]: Recognizes relative and absolute Windows backslash paths (e.g., 'src\adapters\sqlite\schemas\vector\')
// so path segments starting with regex-escape letters (\s, \d, \w, \b, \t, \n, \r, \v) are not misclassified as regex escapes.
function isWindowsBackslashPath(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (!arg.includes('\\')) return false;
  if (/^[a-zA-Z]:[/\\]/.test(arg) || /^\.{1,2}[/\\]/.test(arg)) return true;
  if (hasNonGlobRegexMeta(arg) || hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (arg.endsWith('\\') && !arg.endsWith('\\\\')) return true;
  if (/^[a-zA-Z0-9_.-]+(?:\\[a-zA-Z0-9_*?-][a-zA-Z0-9_.*?-]*){2,}\\?$/.test(arg)) return true;
  if (/^[a-zA-Z0-9_.-]+\\[a-zA-Z0-9_*?-][a-zA-Z0-9_.*?-]*\\?$/.test(arg)) {
    return windowsBackslashSegmentExists(arg, cwd, cache);
  }
  return false;
}

function windowsBackslashSegmentExists(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  const firstSeg = arg.split('\\')[0] ?? '';
  if (/^(?:src|tests?|docs?|scripts?|packages?|apps?|lib|dist|build|config|examples?|tools?|skills?|vendor|\.agents|\.github)$/i.test(firstSeg)) {
    return true;
  }
  if (statPathKindOnDisk(arg, cwd, cache) !== 'none') return true;
  return firstSeg.length > 0 && statPathKindOnDisk(firstSeg, cwd, cache) !== 'none';
}

// [INTENT]: Recognizes file/directory glob paths (e.g., 'tests/adapters/sqlite/tools/stats*', 'tests/**/*.test.ts', '*.ts') so multi-target rg/grep invocations do not misclassify intermediate glob paths as unquoted multi-word search patterns.
export function isGlobPathArg(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (!arg.includes('*') && !arg.includes('?')) return false;
  if (hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (!hasUnmistakableStructuredPathPrefix(arg) && hasNonGlobRegexMeta(arg)) return false;
  if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg, cwd, cache)) {
    return false;
  }
  if (/(?<![/\\])\.\*/.test(arg)) return false;
  return arg.includes('/') || arg.includes('\\') || /\.[a-zA-Z0-9_-]{1,6}$/.test(arg) || /^[*?a-zA-Z0-9_.-]+$/.test(arg);
}

export function hasUriOrNonDriveColon(value: string): boolean {
  return value.includes('://') || (value.includes(':') && !/^[a-zA-Z]:(?:[/\\]|$)/.test(value));
}

function cachedStatByPath(resolvedTarget: string, cache?: Map<string, 'dir' | 'file' | 'none'>): 'dir' | 'file' | 'none' {
  if (cache !== undefined) {
    const hit = cache.get(resolvedTarget);
    if (hit !== undefined) return hit;
  }
  const st = fs.statSync(resolvedTarget, { throwIfNoEntry: false });
  const kind: 'dir' | 'file' | 'none' = st === undefined ? 'none' : (st.isDirectory() ? 'dir' : 'file');
  cache?.set(resolvedTarget, kind);
  return kind;
}

export function isSecondExistingTargetOnly(
  first: string, second: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>,
): boolean {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const resolvedFirst = path.resolve(baseDir, first);
    const resolvedSecond = path.resolve(baseDir, second);
    const secondKind = cachedStatByPath(resolvedSecond, cache);
    if (secondKind === 'none') return false;
    if (cachedStatByPath(resolvedFirst, cache) === 'none') return true;
    return first !== '.' && first !== '..' && secondKind === 'file';
  } catch (err: unknown) {
    if (!isIgnorableSearchFsError(err)) console.error(`⚠️ Search target probe warning: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function statIsDirectory(target: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean | undefined {
  try {
    const kind = cachedStatByPath(path.resolve(target), cache);
    return kind === 'none' ? undefined : kind === 'dir';
  } catch (err: unknown) {
    if (!isIgnorableSearchFsError(err)) console.error(`⚠️ Dir stat warning (${target}): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function resolveExistingDirectory(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean | undefined {
  const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
  return statIsDirectory(path.resolve(baseDir, arg), cache);
}

function structuredTrailingSepDirectory(arg: string): boolean {
  return hasUnmistakableStructuredPathPrefix(arg)
    && (arg.endsWith('/') || arg.endsWith('\\'))
    && !/[()*?[\]^$|{}]/.test(arg);
}

function isRelativeOrTrailingSepDirectory(arg: string): boolean {
  return arg === '.' || arg === '..' || arg.endsWith('/') || arg.endsWith('\\') || /^[a-zA-Z]:[/\\]?$/.test(arg);
}

function lacksFileExtension(arg: string): boolean {
  return !/\.[a-zA-Z0-9]{1,6}$/.test(arg) && path.extname(arg).length === 0;
}

function isWin32MntDirectory(arg: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  const winMapped = arg.replace(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/, (_match, drive: string, rest?: string) =>
    `${drive.toUpperCase()}:\\${(rest ?? '').replace(/\//g, '\\')}`
  );
  const existing = statIsDirectory(winMapped, cache);
  if (existing !== undefined) return existing;
  return lacksFileExtension(arg);
}

function isPosixAbsoluteDirectory(arg: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (process.platform !== 'win32') {
    const existing = statIsDirectory(arg, cache);
    if (existing !== undefined) return existing;
  }
  return KNOWN_POSIX_ROOT_DIRS_REGEX.test(arg);
}

function hasNonRelativeBackslashEscape(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  return !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg, cwd, cache);
}

function isExtensionlessKnownFile(arg: string): boolean {
  const baseName = path.posix.basename(arg.replace(/\\/g, '/'));
  return EXTENSIONLESS_FILENAMES_REGEX.test(baseName);
}

function rejectsDirectoryCandidate(arg: string): boolean {
  return arg.length === 0
    || arg.startsWith('-')
    || arg.startsWith('\\-')
    || hasUriOrNonDriveColon(arg)
    || /\s/.test(arg)
    || arg.includes('|');
}

// [INTENT]: Distinguishes directory targets from patterns and single-file paths in rg/grep interceptors.
// [INVARIANT]: Must NOT assume arbitrary POSIX paths without trailing '/' (e.g., '/var/log/syslog', '/etc/os-release', '/proc/cpuinfo') are directories on Windows hosts, and must NOT misclassify Windows backslash paths (e.g., 'D:\Docs\project\src' containing '\D' and '\s') as regex escapes.
export function statPathKindOnDisk(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): 'dir' | 'file' | 'none' {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    return cachedStatByPath(path.resolve(baseDir, arg), cache);
  } catch (err: unknown) {
    if (!isIgnorableSearchFsError(err)) console.error(`⚠️ Path stat check warning (${arg}): ${err instanceof Error ? err.message : String(err)}`);
    return 'none';
  }
}

export function isLikelyDirectoryArg(arg: string, cwd?: string, cache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (rejectsDirectoryCandidate(arg)) return false;
  if (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg)) return isWin32MntDirectory(arg, cache);

  const existing = resolveExistingDirectory(arg, cwd, cache);
  if (existing !== undefined) return existing;
  if (hasUnambiguousRegexMeta(arg)) return structuredTrailingSepDirectory(arg);
  if (isRelativeOrTrailingSepDirectory(arg)) return true;
  if (arg.startsWith('/')) return isPosixAbsoluteDirectory(arg, cache);
  if (/^[a-zA-Z]:[/\\]/.test(arg)) return lacksFileExtension(arg);
  if (hasNonRelativeBackslashEscape(arg, cwd, cache)) return false;
  if (/\.[a-zA-Z0-9]{1,6}$/.test(arg)) return false;
  if (isExtensionlessKnownFile(arg)) return false;
  return arg.includes('/') || arg.includes('\\');
}
