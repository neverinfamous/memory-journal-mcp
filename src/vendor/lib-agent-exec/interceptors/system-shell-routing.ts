// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { convertToWindowsPath } from '../command-utils.js';
import { isJavaScriptOrTypeScriptCode, isPowerShellCode, isPythonCode, isShellCommandScript } from '../eval-healer.js';
import { buildNonCodeSpans, isIndexInSpans } from '../quote-spans.js';

const NETWORK_ALIASES = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
const SHELL_INTERPRETERS = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'];
const WINDOWS_INTERPRETERS = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'];
const SHELL_SCRIPT_EXTS = ['.ps1', '.bat', '.cmd', '.sh', '.bash'];
const FS_SEARCH_ALIASES = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe'];
const FS_LIST_ALIASES = ['ls', 'ls.exe', 'dir', 'dir.exe', 'tree', 'tree.com'];
const SYSTEMD_ALIASES = ['journalctl', 'journalctl.exe'];
const SHELL_PREFIX_KEYWORDS = new Set(['then', 'do', 'else', 'elif', '!', 'time', 'exec']);

export function routeEmbeddedShellTools(payload: ExecPayload, baseCwd?: string): boolean {
  routeNetworkCommandString(payload);
  return routeShellToolAliases(payload, baseCwd);
}

function routeNetworkCommandString(payload: ExecPayload): void {
  if (payload.type !== 'command' || !payload.command.includes(' ')) return;
  const firstToken = payload.command.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstToken === undefined || firstToken.length === 0) return;
  const firstTokenBase = path.basename(firstToken).replace(/\.exe$/, '');
  if (!NETWORK_ALIASES.includes(firstTokenBase) || firstToken.endsWith('.exe') || payload.target === 'wsl2') return;
  payload.target = 'wsl2';
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${firstToken}' detected in command string. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
}

function stripLeadingComments(content: string): string {
  const spans = buildNonCodeSpans(content, { includeHashComments: true, includeSlashComments: false, includeRegexLiterals: false });
  const chars = content.split('');
  for (const span of spans) {
    if (content[span.start] !== '#') continue;
    for (let i = span.start; i < span.end; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  // Strip full-line `//` comments outside strings/heredocs while preserving URLs (`https://...`) and globs (`/tmp/*`).
  const partiallyClean = chars.join('');
  const lines = partiallyClean.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\/\//.test(line) && !isIndexInSpans(spans, offset + line.indexOf('//'))) {
      lines[i] = ' '.repeat(line.length);
    }
    offset += line.length + 1;
  }
  return lines.join('\n');
}

function extractShellCommandHeads(scriptContent: string): Array<{ head: string; segment: string }> {
  const commentFree = stripLeadingComments(scriptContent);
  const spans = buildNonCodeSpans(commentFree, { includeHashComments: false, includeSlashComments: false, includeRegexLiterals: false });
  const segments: string[] = [];
  let start = 0;
  for (let i = 0; i < commentFree.length; i++) {
    const ch = commentFree[i];
    if ((ch === '\n' || ch === ';' || ch === '&' || ch === '|') && !isIndexInSpans(spans, i)) {
      segments.push(commentFree.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(commentFree.slice(start));

  const out: Array<{ head: string; segment: string }> = [];
  for (const rawSeg of segments) {
    const segment = rawSeg.trim();
    if (segment.length === 0) continue;
    const tokens = segment.split(/\s+/);
    let idx = 0;
    while (idx < tokens.length) {
      const tok = tokens[idx] ?? '';
      if (SHELL_PREFIX_KEYWORDS.has(tok.toLowerCase()) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
        idx++;
        continue;
      }
      out.push({ head: tok.toLowerCase(), segment });
      break;
    }
  }
  return out;
}

function isPosixFindSegment(head: string, segment: string): boolean {
  if (head !== 'find' && head !== 'find.exe') return false;
  if (/\s\/[ivcn]\b/i.test(segment)) return false;
  return /(?:^|\s)(?:-(?:name|iname|type|maxdepth|mindepth|prune|path|ipath|regex|iregex|exec|print0?|delete|mtime|size)\b|\.\.?\/?|\/)/i.test(segment);
}

function detectShellToolAlias(scriptContent: string): string | undefined {
  const entries = extractShellCommandHeads(scriptContent);
  for (const { head, segment } of entries) {
    if (NETWORK_ALIASES.includes(head) || FS_SEARCH_ALIASES.includes(head) || FS_LIST_ALIASES.includes(head) || SYSTEMD_ALIASES.includes(head)) {
      return head;
    }
    if (isPosixFindSegment(head, segment)) return head;
  }
  return undefined;
}

function routeShellToolAliases(payload: ExecPayload, baseCwd?: string): boolean {
  if ((payload.type !== 'eval' && payload.type !== 'script') || payload.target === 'wsl2') return false;
  if (!isShellPayload(payload)) return false;
  const scriptContent = readShellScriptContent(payload, baseCwd);
  // [INTENT]: PowerShell cmdlets stay on Windows pwsh and skip the rest of system interception.
  if (isPowerShellCode(scriptContent)) {
    if (payload.interpreter && ['bash', 'sh'].includes(payload.interpreter.toLowerCase())) {
      payload.interpreter = 'pwsh';
      payload.target = 'windows';
    }
    return true;
  }
  switchShellToolTarget(payload, scriptContent);
  return false;
}

function isShellPayload(payload: ExecPayload): boolean {
  if (payload.type === 'eval') {
    if (payload.interpreter !== undefined && payload.interpreter.length > 0) {
      return SHELL_INTERPRETERS.includes(payload.interpreter.toLowerCase());
    }
    return !isJavaScriptOrTypeScriptCode(payload.code)
      && !isPythonCode(payload.code)
      && (isShellCommandScript(payload.code) || isPowerShellCode(payload.code) || detectShellToolAlias(payload.code) !== undefined);
  }
  if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
    if (payload.interpreter) return SHELL_INTERPRETERS.includes(payload.interpreter.toLowerCase());
    return SHELL_SCRIPT_EXTS.includes(path.extname(payload.scriptPath).toLowerCase());
  }
  return false;
}

function normalizeWinPathIfMnt(p: string): string {
  return process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(p) ? convertToWindowsPath(p) : p;
}

function readShellScriptContent(payload: ExecPayload, baseCwd?: string): string {
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
    const normScript = normalizeWinPathIfMnt(payload.scriptPath);
    if (process.platform === 'win32' && normScript.startsWith('/')) return '';
    const normPayloadCwd = payload.cwd !== undefined && payload.cwd.length > 0 ? normalizeWinPathIfMnt(payload.cwd) : undefined;
    if (process.platform === 'win32' && normPayloadCwd !== undefined && normPayloadCwd.startsWith('/')) return '';
    const rawCwd = normPayloadCwd !== undefined
      ? normPayloadCwd
      : (baseCwd !== undefined && baseCwd.length > 0 ? normalizeWinPathIfMnt(baseCwd) : process.cwd());
    const resolved = path.resolve(rawCwd, normScript);
    const st = fs.statSync(resolved, { throwIfNoEntry: false });
    if (st !== undefined && st.isFile()) {
      return fs.readFileSync(resolved, 'utf8');
    }
  }
  return '';
}

function switchShellToolTarget(payload: ExecPayload, scriptContent: string): void {
  if (payload.type !== 'eval' && payload.type !== 'script') return;
  if (payload.type === 'eval' && (isJavaScriptOrTypeScriptCode(scriptContent) || isPythonCode(scriptContent))) return;
  const detected = detectShellToolAlias(scriptContent);
  if (detected === undefined) return;
  payload.target = 'wsl2';
  if (!payload.interpreter || WINDOWS_INTERPRETERS.includes(payload.interpreter.toLowerCase())) {
    payload.interpreter = 'bash';
  }
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Shell command/script using '${detected}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
}
