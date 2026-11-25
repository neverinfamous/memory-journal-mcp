// @ts-nocheck
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_ARRAY_LENGTH, createNullProtoRecord } from './constants.js';

const MAX_SAFE_RECORD_KEYS = 256;
const MAX_SAFE_RECORD_KEY_LEN = 256;

export const activeChildProcesses = new Set<ChildProcess>();

export function registerActiveProcess(proc: ChildProcess): void {
  activeChildProcesses.add(proc);
}

export function unregisterActiveProcess(proc: ChildProcess): void {
  activeChildProcesses.delete(proc);
}

export function cleanupActiveProcesses(): void {
  for (const proc of activeChildProcesses) {
    if (proc.exitCode === null && proc.signalCode === null && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
}

const WIN32_UNC_OR_DEVICE_PREFIX_RE = /^(?:[\\/]{2}|[\\/]\?\?[\\/])/;
const WIN32_DRIVE_PREFIX_RE = /^[A-Za-z]:/;
const WIN32_DRIVE_RELATIVE_RE = /^[A-Za-z]:(?![\\/])/;
const WIN32_RESERVED_DEVICE_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const PATH_SPLIT_RE = /[\\/]+/;
const CREDENTIAL_URL_RE = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)([^/?#\s]+)@/gi;
const SAFE_REPO_HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;
const SAFE_STDIN_SHA_RE = /^[0-9a-zA-Z]{3,64}$/;
const SLACK_ID_RE = /^[UW][A-Z0-9_]{4,31}$/;
const NEWLINE_INLINE_RE = /\r\n|\r|\n|\u2028|\u2029/g;
const NEWLINE_MULTILINE_RE = /\r\n|\r|\u2028|\u2029/g;
const MARKDOWN_URL_ESCAPE_RE = /[()[\]\\\s]/g;
const MARKDOWN_INLINE_RE = /[\\[\]<>`~|]/g;
const MARKDOWN_INLINE_EMPH_RE = /[\\[\]<>`~|*_]/g;
const MARKDOWN_LINE_MARKER_RE = /^([ \t]*)(?:(\d+)([.)])|([#*+\-=|]))/gm;
const SLACK_MRKDWN_RE = /[&<>`]/g;
const SLACK_MRKDWN_PIPE_RE = /[&<>`|]/g;
const SLACK_EMPH_EDGE_RE = /(^|[\s(>])([_~])|([_~])(?=[\s).,;:!?<]|$)/g;

export function hasControlChar(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function trimTrailingDotsSpaces(seg: string): string {
  let end = seg.length;
  while (end > 0) {
    const c = seg.charCodeAt(end - 1);
    if (c !== 0x20 && c !== 0x2e) break;
    end--;
  }
  return end === seg.length ? seg : seg.slice(0, end);
}

/** [INTENT]: Reject control chars, UNC/device namespaces, drive-relative paths, ADS colons, and reserved Win32 device names. */
export function hasUnsafeWin32PathSyntax(rawPath: string): boolean {
  if (!rawPath || hasControlChar(rawPath)) return true;
  if (WIN32_UNC_OR_DEVICE_PREFIX_RE.test(rawPath) || WIN32_DRIVE_RELATIVE_RE.test(rawPath)) return true;
  const rest = WIN32_DRIVE_PREFIX_RE.test(rawPath) ? rawPath.slice(2) : rawPath;
  if (rest.includes(':')) return true;
  for (const seg of rawPath.split(PATH_SPLIT_RE)) {
    if (!seg || seg === '.' || seg === '..') continue;
    const trimmed = trimTrailingDotsSpaces(seg);
    const dotIdx = trimmed.indexOf('.');
    const stem = dotIdx === -1 ? trimmed : trimTrailingDotsSpaces(trimmed.slice(0, dotIdx));
    if (WIN32_RESERVED_DEVICE_RE.test(stem)) return true;
  }
  return false;
}

export function isPathContained(rootRealPath: string, candidateRealPath: string): boolean {
  const rel = path.relative(rootRealPath, candidateRealPath);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !rel.startsWith('../') && !path.isAbsolute(rel);
}

export type ContainedFileResult =
  | { ok: true; realPath: string; size: number; stat: fs.Stats }
  | { ok: false; reason: string };

export function assertContainedExistingFile(
  rootDir: string,
  rawPath: string,
  maxBytes?: number,
  preResolvedRootReal?: string,
): ContainedFileResult {
  if (hasUnsafeWin32PathSyntax(rawPath)) return { ok: false, reason: `Unsafe path syntax: ${rawPath}` };
  let realRoot: string;
  try { realRoot = preResolvedRootReal ?? fs.realpathSync(rootDir); }
  catch (err: unknown) { return { ok: false, reason: `Invalid base directory: ${err instanceof Error ? err.message : String(err)}` }; }

  const resolvedTarget = path.resolve(realRoot, rawPath);
  const lstat = fs.lstatSync(resolvedTarget, { throwIfNoEntry: false });
  if (!lstat) return { ok: false, reason: `File does not exist: ${resolvedTarget}` };
  if (lstat.isSymbolicLink()) return { ok: false, reason: `Symlinks are not permitted: ${resolvedTarget}` };
  if (!lstat.isFile()) return { ok: false, reason: `Path is not a regular file: ${resolvedTarget}` };

  let realTarget: string;
  try { realTarget = fs.realpathSync(resolvedTarget); }
  catch (err: unknown) { return { ok: false, reason: `Failed to resolve real path: ${err instanceof Error ? err.message : String(err)}` }; }
  if (!isPathContained(realRoot, realTarget) || path.relative(realRoot, realTarget) === '') {
    return { ok: false, reason: `Path escapes repository root: ${rawPath}` };
  }
  if (maxBytes !== undefined && lstat.size > maxBytes) {
    return { ok: false, reason: `File exceeds ${maxBytes} byte limit: ${rawPath}` };
  }
  return { ok: true, realPath: realTarget, size: lstat.size, stat: lstat };
}

export function verifySameOpenFile(lstat: fs.Stats, fstat: fs.Stats): boolean {
  if (!fstat.isFile()) return false;
  if (lstat.ino !== 0 && fstat.ino !== 0) return lstat.dev === fstat.dev && lstat.ino === fstat.ino;
  return lstat.size === fstat.size && lstat.mtimeMs === fstat.mtimeMs;
}

export type ContainedReadTextResult =
  | { ok: true; realPath: string; content: string }
  | { ok: false; reason: string };

export function readContainedTextFileSync(rootDir: string, rawPath: string, maxBytes: number): ContainedReadTextResult {
  const check = assertContainedExistingFile(rootDir, rawPath, maxBytes);
  if (!check.ok) return check;
  let fd: number;
  try {
    fd = fs.openSync(check.realPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  try {
    const fstat = fs.fstatSync(fd);
    if (!verifySameOpenFile(check.stat, fstat) || fstat.size > maxBytes) {
      return { ok: false, reason: `File changed or exceeded ${maxBytes} bytes: ${rawPath}` };
    }
    const buf = Buffer.allocUnsafe(fstat.size);
    let offset = 0;
    while (offset < fstat.size) {
      const read = fs.readSync(fd, buf, offset, fstat.size - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return { ok: true, realPath: check.realPath, content: buf.toString('utf8', 0, offset) };
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

export type ContainedWriteFdResult =
  | { ok: true; fd: number; targetPath: string }
  | { ok: false; reason: string };

export function openContainedWriteFd(rootDir: string, rawPath: string): ContainedWriteFdResult {
  if (hasUnsafeWin32PathSyntax(rawPath)) return { ok: false, reason: `Unsafe output path syntax: ${rawPath}` };
  let realRoot: string;
  let realParent: string;
  try {
    realRoot = fs.realpathSync(rootDir);
    realParent = fs.realpathSync(path.dirname(path.resolve(realRoot, rawPath)));
  } catch (err: unknown) {
    return { ok: false, reason: `Target directory is unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isPathContained(realRoot, realParent)) return { ok: false, reason: `Output path escapes repository root: ${rawPath}` };

  const safeTarget = path.join(realParent, path.basename(path.resolve(realRoot, rawPath)));
  const lstat = fs.lstatSync(safeTarget, { throwIfNoEntry: false });
  if (lstat && (lstat.isSymbolicLink() || !lstat.isFile())) {
    return { ok: false, reason: `Refusing to write to symlink or non-regular file: ${safeTarget}` };
  }
  const noFollow = fs.constants.O_NOFOLLOW;
  const openFlags = lstat
    ? fs.constants.O_WRONLY | (noFollow ?? 0)
    : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (noFollow ?? 0);

  let fd: number;
  try { fd = fs.openSync(safeTarget, openFlags, 0o600); }
  catch (err: unknown) { return { ok: false, reason: err instanceof Error ? err.message : String(err) }; }

  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile() || (lstat && !verifySameOpenFile(lstat, fstat))) {
      throw new Error(`Target changed or is not a regular file: ${safeTarget}`);
    }
    if (noFollow === undefined) {
      const postLstat = fs.lstatSync(safeTarget);
      if (postLstat.isSymbolicLink() || !verifySameOpenFile(postLstat, fstat) || !isPathContained(realRoot, fs.realpathSync(safeTarget))) {
        throw new Error(`Target symlink race detected: ${safeTarget}`);
      }
    }
    try { fs.fchmodSync(fd, 0o600); } catch { /* ignore on Win32 */ }
    fs.ftruncateSync(fd, 0);
    return { ok: true, fd, targetPath: safeTarget };
  } catch (err: unknown) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export {
  assertSafeSqlitePath, dropPoisonedSchemaObjects, isValidSqliteCommitsSchema, safeChmodSqliteFiles,
} from './security-sqlite.js';

export function assertValidStdinShas(stdinShas: string | undefined): void {
  if (!stdinShas) return;
  for (const rawLine of stdinShas.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!SAFE_STDIN_SHA_RE.test(line)) {
      throw new Error(`Invalid commit SHA token in stdin stream: ${line.slice(0, 32)}`);
    }
  }
}

const ALLOWED_LOCKED_GIT_FLAGS: ReadonlySet<string> = new Set([
  '-M', '-c', '--no-merges', '--first-parent', '--pickaxe-all', '-i', '-E', '--extended-regexp',
  '--reverse', '--all', '--full-history', '--full-diff', '--cc', '-m', '--fixed-strings',
]);
const ALLOWED_LOCKED_GIT_PREFIXES = ['--author=', '--grep=', '--since=', '--until=', '--diff-filter=', '-G', '-S'];
const SAFE_POS_INT_RE = /^[1-9]\d*$/;

export function assertValidLockedGitArgs(lockedArgs: readonly string[]): void {
  let pastEndOfOptions = false;
  let expectLimitCount = false;
  let prevWasDashC = false;
  for (const arg of lockedArgs) {
    if (typeof arg !== 'string' || arg.includes('\0')) throw new Error('Invalid NUL or non-string git argument.');
    if (expectLimitCount) {
      if (!SAFE_POS_INT_RE.test(arg)) throw new Error(`Invalid git -n count: ${arg}`);
      expectLimitCount = false; prevWasDashC = false; continue;
    }
    if (pastEndOfOptions) continue;
    if (arg === '--') { pastEndOfOptions = true; prevWasDashC = false; continue; }
    if (prevWasDashC && /^[a-z0-9_.-]+=/i.test(arg)) throw new Error(`Unsafe git -c config argument: ${arg}`);
    prevWasDashC = arg === '-c';
    if (!arg.startsWith('-')) continue;
    if (arg === '-n') { expectLimitCount = true; continue; }
    if (ALLOWED_LOCKED_GIT_FLAGS.has(arg)) continue;
    if (ALLOWED_LOCKED_GIT_PREFIXES.some((p) => arg.startsWith(p))) continue;
    throw new Error(`Unsupported or unsafe git log option in lockedArgs: ${arg}`);
  }
  if (expectLimitCount) throw new Error('Trailing git -n option missing count.');
}

export function assertValidDiffContext(val: unknown): number | undefined {
  if (val === undefined) return undefined;
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
    const desc = typeof val === 'string' || typeof val === 'boolean' ? String(val) : (JSON.stringify(val) ?? typeof val);
    throw new Error(`Invalid diff-context value: ${desc}`);
  }
  return val;
}

export function copySafeStringRecord(raw: Record<string, unknown>): Record<string, string> {
  const out = createNullProtoRecord<string>();
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (k.length > MAX_SAFE_RECORD_KEY_LEN || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof v !== 'string') continue;
    if (count >= MAX_SAFE_RECORD_KEYS) break;
    out[k] = v;
    count++;
  }
  return out;
}

export function copySafeStringArrayRecord(raw: Record<string, unknown>): Record<string, string[]> | null {
  const out = createNullProtoRecord<string[]>();
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (
      k.length > MAX_SAFE_RECORD_KEY_LEN ||
      !Array.isArray(v) ||
      v.length > MAX_ARRAY_LENGTH ||
      !v.every((item) => typeof item === 'string')
    ) {
      return null;
    }
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (++count > MAX_SAFE_RECORD_KEYS) return null;
    out[k] = v;
  }
  return out;
}

export function copySafePlainValue(val: unknown, depth = 0): unknown {
  if (val === null || typeof val !== 'object') return val;
  if (depth >= 8) return '[MaxDepthExceeded]';
  if (Array.isArray(val)) return val.map((v) => copySafePlainValue(v, depth + 1));
  const out = createNullProtoRecord<unknown>();
  for (const [k, v] of Object.entries(val)) {
    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = copySafePlainValue(v, depth + 1);
  }
  return out;
}

export function scrubCredentialUrls(text: string): string {
  return text.replace(CREDENTIAL_URL_RE, '$1***@');
}

export function isSafeHttpUrl(url: string): boolean {
  if (!url || hasControlChar(url) || /\s/.test(url) || url.includes('\\')) return false;
  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) return false;
  const afterScheme = url.slice(schemeEnd + 3);
  const authEnd = afterScheme.search(/[/?#]/);
  const authority = authEnd === -1 ? afterScheme : afterScheme.slice(0, authEnd);
  if (authority.includes('@')) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0 && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function isSafeRepoHost(host: string): boolean {
  return Boolean(host) && !host.includes('..') && SAFE_REPO_HOST_RE.test(host);
}

export function sanitizeRepoPathSegments(repoPath: string): string | null {
  if (!repoPath || repoPath.includes('\\')) return null;
  const segments = repoPath.split('/');
  if (segments.length === 0) return null;
  const encoded: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return null;
    encoded.push(encodeURIComponent(seg));
  }
  return encoded.join('/');
}

export function encodeTrackerIssueToken(token: string): string | null {
  if (!token || hasControlChar(token) || token.includes('\\')) return null;
  const segments = token.split('/');
  const encoded: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg === '@') return null;
    encoded.push(encodeURIComponent(seg));
  }
  return encoded.join('/');
}

export function isValidSlackId(id: string): boolean {
  return SLACK_ID_RE.test(id);
}

export function escapeMarkdownUrl(url: string): string | null {
  if (!isSafeHttpUrl(url)) return null;
  return new URL(url).href.replace(MARKDOWN_URL_ESCAPE_RE, (ch) => encodeURIComponent(ch));
}

function isUnsafeDisplayChar(c: number, flattenNewlines: boolean): boolean {
  if (c < 0x20) return flattenNewlines || (c !== 0x09 && c !== 0x0a && c !== 0x0d);
  if (c >= 0x7f && c <= 0x9f) return true;
  if (c === 0x061c || c === 0x200e || c === 0x200f) return true;
  return (c >= (flattenNewlines ? 0x2028 : 0x202a) && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
}

function filterUnsafeChars(text: string, flattenNewlines: boolean): string {
  let firstBad = -1;
  for (let i = 0; i < text.length; i++) {
    if (isUnsafeDisplayChar(text.charCodeAt(i), flattenNewlines)) { firstBad = i; break; }
  }
  if (firstBad === -1) return text;
  let out = text.slice(0, firstBad);
  let keepStart = firstBad;
  for (let i = firstBad; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!isUnsafeDisplayChar(c, flattenNewlines)) continue;
    if (i > keepStart) out += text.slice(keepStart, i);
    if (flattenNewlines && (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029)) out += ' ';
    keepStart = i + 1;
  }
  return keepStart < text.length ? out + text.slice(keepStart) : out;
}

export function stripUnsafeDisplayChars(text: string): string {
  return filterUnsafeChars(text, false);
}

export function sanitizeLogText(text: string): string {
  return filterUnsafeChars(text, true);
}

export function escapeMarkdownInline(text: string, escapeEmphasis = false): string {
  const flat = stripUnsafeDisplayChars(text).replace(NEWLINE_INLINE_RE, ' ');
  const re = escapeEmphasis ? MARKDOWN_INLINE_EMPH_RE : MARKDOWN_INLINE_RE;
  return flat.replace(re, (ch) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : `\\${ch}`));
}

export function escapeMarkdownMultiline(text: string): string {
  const normalized = stripUnsafeDisplayChars(text).replace(NEWLINE_MULTILINE_RE, '\n');
  const escaped = normalized.replace(MARKDOWN_INLINE_EMPH_RE, (ch) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : `\\${ch}`));
  return escaped.replace(
    MARKDOWN_LINE_MARKER_RE,
    (_m: string, ws: string, digits?: string, punct?: string, sym?: string) =>
      digits ? `${ws}${digits}\\${punct ?? '.'}` : `${ws}\\${sym ?? ''}`,
  );
}

export function escapeSlackMrkdwn(
  text: string,
  escapePipe = false,
  singleLine = false,
  stripStars = false,
  neutralizeEmph = false,
): string {
  const clean = stripUnsafeDisplayChars(text);
  let normalized = singleLine ? clean.replace(NEWLINE_INLINE_RE, ' ') : clean.replace(NEWLINE_MULTILINE_RE, '\n');
  if (stripStars) normalized = normalized.replace(/\*/g, '');
  if (neutralizeEmph) {
    normalized = normalized.replace(SLACK_EMPH_EDGE_RE, (_m: string, p1?: string, p2?: string, p3?: string) =>
      p2 ? `${p1 ?? ''}${p2}\u200B` : `\u200B${p3 ?? ''}`,
    );
  }
  const re = escapePipe ? SLACK_MRKDWN_PIPE_RE : SLACK_MRKDWN_RE;
  return normalized.replace(re, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '`' ? "'" : '&#124;'));
}
