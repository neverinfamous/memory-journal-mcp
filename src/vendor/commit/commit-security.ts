// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN32_DRIVE_PREFIX_RE = /^[a-zA-Z]:/;
const WIN32_DRIVE_REL_RE = /^[a-zA-Z]:(?![\\/])/;
const WIN32_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);
const AGENTS_CACHE_RE = /(?:^|\/)\.agents\/cache(?:\/|$)/;
const SAFE_ENV_BASENAMES: ReadonlySet<string> = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.schema',
]);
const PRIVATE_KEY_EXT_RE = /\.(?:pem|key|p12|pfx)$/;
const PRIVATE_KEY_NAMES: ReadonlySet<string> = new Set(['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa']);

const BEARER_TOKEN_RE = /\b(?:Bearer|Basic|ApiKey)[ \t]+(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s"',;}{]+)|\bToken[ \t]+(?=[A-Za-z0-9._\-+/=]*(?:\d|[._\-+/=]))[A-Za-z0-9._\-+/=]+/gi;
const URL_CREDENTIAL_RE = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/(?:[^:@\s/]*:)?)[^@\s/]+(@)/gi;
const GITHUB_TOKEN_RE = /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]+\b/g;
const CLI_FLAG_SECRET_RE = /((?:^|[\s;|&(])--(?:[a-z0-9]+[-_])*(?:auth[_-]?token|token|api[_-]?key|passw(?:or)?d|secret|encryption[_-]?key|sqlcipher[_-]?key|dd[_-]?api[_-]?key|dd[_-]?app[_-]?key|private[_-]?key|signing[_-]?key|access[_-]?token|github[_-]?token|npm[_-]?token|webhook[_-]?secret|key)(?:=|[ \t]+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;|&()'"<>]+)/gi;
const KEY_SECRET_RE = /(?<![A-Za-z0-9_-])((?:PRAGMA[ \t]+key|(?:[A-Za-z0-9]+[_-])*(?:token|secret|passw(?:or)?d|api[_-]?key|auth[_-]?token|encryption[_-]?key|sqlcipher[_-]?key|dd[_-]?api[_-]?key|dd[_-]?app[_-]?key)|(?:access|refresh|id|session|bearer)[_-]?token|(?:client|webhook|signing)[_-]?secret)(?:[_-][A-Za-z0-9]+)*)(["']?[ \t]*[:=][ \t]*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|[^\s"',;}{]+)/gi;

export function hasDisallowedControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

export function stripWin32TrailingDotsAndSpaces(seg: string): string {
  let end = seg.length;
  while (end > 0 && (seg[end - 1] === '.' || seg[end - 1] === ' ')) {
    end--;
  }
  return seg.slice(0, end);
}

export function assertSafeCliPath(rawPath: string, flagName: string): void {
  if (rawPath.includes('\0')) {
    throw new Error(`Unsafe ${flagName} path: NUL byte is not allowed.`);
  }
  if (rawPath.startsWith('\\\\') || rawPath.startsWith('//')) {
    throw new Error(`Unsafe ${flagName} path: UNC and Win32 device paths are not allowed.`);
  }
  if (WIN32_DRIVE_REL_RE.test(rawPath)) {
    throw new Error(`Unsafe ${flagName} path: drive-relative paths are not allowed.`);
  }
  const withoutDrive = WIN32_DRIVE_PREFIX_RE.test(rawPath) ? rawPath.slice(2) : rawPath;
  if (withoutDrive.includes(':')) {
    throw new Error(`Unsafe ${flagName} path: alternate data stream colon is not allowed.`);
  }
  for (const segment of withoutDrive.split(/[\\/]/)) {
    const trimmedSeg = stripWin32TrailingDotsAndSpaces(segment);
    if (trimmedSeg.length === 0) continue;
    const dotIdx = trimmedSeg.indexOf('.');
    const base = (dotIdx === -1 ? trimmedSeg : trimmedSeg.slice(0, dotIdx)).toUpperCase();
    if (WIN32_RESERVED_NAMES.has(base)) {
      throw new Error(`Unsafe ${flagName} path: reserved device name '${segment}' is not allowed.`);
    }
  }
}

export function isSensitiveRepoPath(filepath: string): boolean {
  const normalizedSegments = filepath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => stripWin32TrailingDotsAndSpaces(seg).toLowerCase());
  const normalized = normalizedSegments.join('/');
  if (AGENTS_CACHE_RE.test(normalized) || normalized.endsWith('issues.jsonl')) {
    return true;
  }
  const basename = normalizedSegments[normalizedSegments.length - 1] ?? '';
  if (basename === 'secrets.env') return true;
  if ((basename === '.env' || basename.startsWith('.env.')) && !SAFE_ENV_BASENAMES.has(basename)) {
    return true;
  }
  return PRIVATE_KEY_EXT_RE.test(basename) || PRIVATE_KEY_NAMES.has(basename);
}

const privateTempDirs = new Set<string>();
let exitHookAttached = false;
let signalHooksAttached = false;

function cleanupAllPrivateTempDirs(): void {
  for (const dirPath of [...privateTempDirs]) {
    cleanupPrivateTempDir(dirPath);
  }
}

function onTerminationSignal(signal: NodeJS.Signals): void {
  cleanupAllPrivateTempDirs();
  detachSignalHooks();
  try {
    process.kill(process.pid, signal);
  } catch {
    process.exit(signal === 'SIGHUP' ? 129 : signal === 'SIGINT' ? 130 : 143);
  }
}

function attachCleanupHooks(): void {
  if (!exitHookAttached) {
    exitHookAttached = true;
    process.on('exit', cleanupAllPrivateTempDirs);
  }
  if (!signalHooksAttached) {
    signalHooksAttached = true;
    process.on('SIGINT', onTerminationSignal);
    process.on('SIGTERM', onTerminationSignal);
    process.on('SIGHUP', onTerminationSignal);
  }
}

function detachSignalHooks(): void {
  if (!signalHooksAttached) return;
  signalHooksAttached = false;
  process.off('SIGINT', onTerminationSignal);
  process.off('SIGTERM', onTerminationSignal);
  process.off('SIGHUP', onTerminationSignal);
}

export function createPrivateTempFile(
  prefix: string,
  filename: string,
  content: string
): { dirPath: string; filePath: string } {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Non-POSIX platforms may ignore POSIX mode bits
  }
  privateTempDirs.add(dirPath);
  attachCleanupHooks();
  const filePath = path.join(dirPath, filename);
  try {
    fs.writeFileSync(filePath, content, { mode: 0o600, flag: 'wx' });
    return { dirPath, filePath };
  } catch (err: unknown) {
    cleanupPrivateTempDir(dirPath);
    throw err;
  }
}

export function cleanupPrivateTempDir(dirPath: string): void {
  privateTempDirs.delete(dirPath);
  if (privateTempDirs.size === 0) {
    detachSignalHooks();
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup on exit/finally
  }
}

export function readBoundedHistoryFile(resolvedPath: string, maxBytes = 65536): string {
  assertSafeCliPath(resolvedPath, '--history-file');
  if (isSensitiveRepoPath(resolvedPath)) {
    throw new Error(`Refusing to read sensitive file for --history-file: ${resolvedPath}`);
  }
  const lstat = fs.lstatSync(resolvedPath, { throwIfNoEntry: false });
  if (lstat === undefined) {
    throw new Error(`History file not found: ${resolvedPath}`);
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new Error(`--history-file must point to a regular non-symlink file: ${resolvedPath}`);
  }
  const realDir = fs.realpathSync.native(path.dirname(resolvedPath));
  const canonicalTarget = path.join(realDir, path.basename(resolvedPath));
  if (isSensitiveRepoPath(canonicalTarget)) {
    throw new Error(`Refusing to read sensitive file for --history-file: ${resolvedPath}`);
  }
  const realTarget = fs.realpathSync.native(resolvedPath);
  if (isSensitiveRepoPath(realTarget)) {
    throw new Error(`Refusing to read sensitive file for --history-file: ${resolvedPath}`);
  }
  if (lstat.size > maxBytes) {
    throw new Error(`--history-file exceeds maximum size of ${String(maxBytes)} bytes.`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(realTarget, flags);
  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile() || fstat.size > maxBytes) {
      throw new Error(`--history-file failed regular-file/size verification (${String(maxBytes)} byte limit).`);
    }
    const buf = Buffer.allocUnsafe(Math.min(maxBytes + 1, 8192));
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new Error(`--history-file exceeds maximum size of ${String(maxBytes)} bytes.`);
      }
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(BEARER_TOKEN_RE, (m) => `${m.split(/[ \t]+/, 1)[0] ?? 'Token'} [REDACTED]`)
    .replace(URL_CREDENTIAL_RE, '$1[REDACTED]$2')
    .replace(GITHUB_TOKEN_RE, '[REDACTED_TOKEN]')
    .replace(CLI_FLAG_SECRET_RE, '$1[REDACTED]')
    .replace(
      KEY_SECRET_RE,
      (_m, key: string, sep: string, dqVal?: string, sqVal?: string) =>
        dqVal !== undefined ? `${key}${sep}"[REDACTED]"` : sqVal !== undefined ? `${key}${sep}'[REDACTED]'` : `${key}${sep}[REDACTED]`
    );
}

export function parseStagedStatus(
  status: string,
  isScratchPath: (filepath: string) => boolean
): {
  hasStagedFiles: boolean;
  stagedScratchFiles: string[];
  stagedSensitiveFiles: string[];
  stagedFiles: string[];
  unmergedFiles: string[];
} {
  const parts = status.split('\0');
  const stagedScratchFiles: string[] = [];
  const stagedSensitiveFiles: string[] = [];
  const stagedFiles: string[] = [];
  const unmergedFiles: string[] = [];
  let hasStagedFiles = false;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part) {
      i++;
      continue;
    }
    const indexStatus = part[0];
    const workTreeStatus = part[1];
    const filepath = part.substring(3);

    const isUnmerged =
      indexStatus === 'U' ||
      workTreeStatus === 'U' ||
      (indexStatus === 'D' && workTreeStatus === 'D') ||
      (indexStatus === 'A' && workTreeStatus === 'A');

    if (isUnmerged) {
      unmergedFiles.push(filepath);
    } else if (indexStatus !== ' ' && indexStatus !== '?') {
      hasStagedFiles = true;
      stagedFiles.push(filepath);
      if (indexStatus !== 'D') {
        if (isScratchPath(filepath)) stagedScratchFiles.push(filepath);
        else if (isSensitiveRepoPath(filepath)) stagedSensitiveFiles.push(filepath);
      }
    }

    if (indexStatus === 'R' || indexStatus === 'C' || workTreeStatus === 'R' || workTreeStatus === 'C') {
      i += 2;
    } else {
      i += 1;
    }
  }
  return { hasStagedFiles, stagedScratchFiles, stagedSensitiveFiles, stagedFiles, unmergedFiles };
}
