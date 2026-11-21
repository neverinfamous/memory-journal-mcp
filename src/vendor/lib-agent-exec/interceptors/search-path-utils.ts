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

export function existsOnDisk(arg: string, cwd?: string): boolean {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    return fs.existsSync(path.resolve(baseDir, arg));
  } catch {
    return false;
  }
}

export function hasBackslashRegexEscape(arg: string): boolean {
  if (isWindowsBackslashPath(arg)) return false;
  return /\\[bBwWdDsSnrtv0()[\]{}.*+?^$|\-.]/.test(arg);
}

// [INTENT]: Recognizes relative and absolute Windows backslash paths (e.g., 'src\adapters\sqlite\schemas\vector\')
// so path segments starting with regex-escape letters (\s, \d, \w, \b, \t, \n, \r, \v) are not misclassified as regex escapes.
function isWindowsBackslashPath(arg: string, cwd?: string): boolean {
  if (!arg.includes('\\')) return false;
  if (/^[a-zA-Z]:[/\\]/.test(arg) || /^\.{1,2}[/\\]/.test(arg)) return true;
  if (hasNonGlobRegexMeta(arg) || hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (arg.endsWith('\\') && !arg.endsWith('\\\\')) return true;
  if (/^[a-zA-Z0-9_.-]+(?:\\[a-zA-Z0-9_*?-][a-zA-Z0-9_.*?-]*){2,}\\?$/.test(arg)) return true;
  if (/^[a-zA-Z0-9_.-]+\\[a-zA-Z0-9_*?-][a-zA-Z0-9_.*?-]*\\?$/.test(arg)) {
    return windowsBackslashSegmentExists(arg, cwd);
  }
  return false;
}

function windowsBackslashSegmentExists(arg: string, cwd?: string): boolean {
  const firstSeg = arg.split('\\')[0] ?? '';
  if (/^(?:src|tests?|docs?|scripts?|packages?|apps?|lib|dist|build|config|examples?|tools?|skills?|vendor|\.agents|\.github)$/i.test(firstSeg)) {
    return true;
  }
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const resolved = path.resolve(baseDir, arg);
    const firstResolved = path.resolve(baseDir, firstSeg);
    return fs.existsSync(resolved) || (firstSeg.length > 0 && fs.existsSync(firstResolved));
  } catch {
    return false;
  }
}

// [INTENT]: Recognizes file/directory glob paths (e.g., 'tests/adapters/sqlite/tools/stats*', 'tests/**/*.test.ts', '*.ts') so multi-target rg/grep invocations do not misclassify intermediate glob paths as unquoted multi-word search patterns.
export function isGlobPathArg(arg: string): boolean {
  if (!arg.includes('*') && !arg.includes('?')) return false;
  if (hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (!hasUnmistakableStructuredPathPrefix(arg) && hasNonGlobRegexMeta(arg)) return false;
  if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg)) {
    return false;
  }
  if (/(?<![/\\])\.\*/.test(arg)) return false;
  return arg.includes('/') || arg.includes('\\') || /\.[a-zA-Z0-9_-]{1,6}$/.test(arg) || /^[*?a-zA-Z0-9_.-]+$/.test(arg);
}

export function hasUriOrNonDriveColon(value: string): boolean {
  return value.includes('://') || (value.includes(':') && !/^[a-zA-Z]:(?:[/\\]|$)/.test(value));
}

export function isSecondExistingTargetOnly(first: string, second: string, cwd?: string): boolean {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const resolvedFirst = path.resolve(baseDir, first);
    const resolvedSecond = path.resolve(baseDir, second);
    return !fs.existsSync(resolvedFirst) && fs.existsSync(resolvedSecond);
  } catch {
    return false;
  }
}

function statIsDirectory(target: string): boolean | undefined {
  try {
    if (!fs.existsSync(target)) return undefined;
    return fs.statSync(target).isDirectory();
  } catch {
    return undefined;
  }
}

function resolveExistingDirectory(arg: string, cwd?: string): boolean | undefined {
  const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
  return statIsDirectory(path.resolve(baseDir, arg));
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

function isWin32MntDirectory(arg: string): boolean {
  const winMapped = arg.replace(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/, (_match, drive: string, rest?: string) =>
    `${drive.toUpperCase()}:\\${(rest ?? '').replace(/\//g, '\\')}`
  );
  const existing = statIsDirectory(winMapped);
  if (existing !== undefined) return existing;
  return lacksFileExtension(arg);
}

function isPosixAbsoluteDirectory(arg: string): boolean {
  if (process.platform !== 'win32') {
    const existing = statIsDirectory(arg);
    if (existing !== undefined) return existing;
  }
  return KNOWN_POSIX_ROOT_DIRS_REGEX.test(arg);
}

function hasNonRelativeBackslashEscape(arg: string): boolean {
  return !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg);
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
// [INVARIANT]: Must NOT assume arbitrary POSIX paths without trailing '/' (e.g., '/var/log/syslog', '/etc/os-release', '/proc/cpuinfo') are directories on Windows hosts, and must NOT misclassify Windows backslash paths (e.g., 'C:\Users\...\Desktop\...\src' containing '\D' and '\s') as regex escapes.
export function isLikelyDirectoryArg(arg: string, cwd?: string): boolean {
  if (rejectsDirectoryCandidate(arg)) return false;

  const existing = resolveExistingDirectory(arg, cwd);
  if (existing !== undefined) return existing;
  if (hasUnambiguousRegexMeta(arg)) return structuredTrailingSepDirectory(arg);
  if (isRelativeOrTrailingSepDirectory(arg)) return true;
  if (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg)) return isWin32MntDirectory(arg);
  if (arg.startsWith('/')) return isPosixAbsoluteDirectory(arg);

  const existingAgain = resolveExistingDirectory(arg, cwd);
  if (existingAgain !== undefined) return existingAgain;
  if (/^[a-zA-Z]:[/\\]/.test(arg)) return lacksFileExtension(arg);
  if (hasNonRelativeBackslashEscape(arg)) return false;
  if (/\.[a-zA-Z0-9]{1,6}$/.test(arg)) return false;
  if (isExtensionlessKnownFile(arg)) return false;
  return arg.includes('/') || arg.includes('\\');
}
