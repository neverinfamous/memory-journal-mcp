// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { convertToWindowsPath } from '../command-utils.js';
import { isJavaScriptOrTypeScriptCode, isPowerShellCode, isPythonCode, isShellCommandScript } from '../eval-healer.js';
import { buildNonCodeSpans, isIndexInSpans } from '../quote-spans.js';

const NETWORK_ALIAS_SET: ReadonlySet<string> = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr']);
const SHELL_INTERPRETER_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe']);
const WINDOWS_INTERPRETER_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe']);
const SHELL_SCRIPT_EXT_SET: ReadonlySet<string> = new Set(['.ps1', '.bat', '.cmd', '.sh', '.bash']);
const FS_SEARCH_ALIAS_SET: ReadonlySet<string> = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe']);
const FS_LIST_ALIAS_SET: ReadonlySet<string> = new Set(['ls', 'ls.exe', 'dir', 'dir.exe', 'tree', 'tree.com']);
const SYSTEMD_ALIAS_SET: ReadonlySet<string> = new Set(['journalctl', 'journalctl.exe']);
const SHELL_PREFIX_KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '!', 'time', 'exec']);

export function routeEmbeddedShellTools(payload: ExecPayload, baseCwd?: string): void {
  routeNetworkCommandString(payload);
  routeShellToolAliases(payload, baseCwd);
}

function routeNetworkCommandString(payload: ExecPayload): void {
  if (process.platform !== 'win32' || payload.type !== 'command' || !payload.command.includes(' ')) return;
  const firstToken = payload.command.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstToken === undefined || firstToken.length === 0) return;
  const firstTokenBase = path.basename(firstToken).replace(/\.exe$/, '');
  if (!NETWORK_ALIAS_SET.has(firstTokenBase) || firstToken.endsWith('.exe') || payload.target === 'wsl2') return;
  payload.target = 'wsl2';
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${firstToken}' detected in command string. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
}

function stripLeadingComments(content: string): { commentFree: string; spans: ReturnType<typeof buildNonCodeSpans> } {
  const spans = buildNonCodeSpans(content, { includeHashComments: true, includeSlashComments: false, includeRegexLiterals: false });
  const hashChunks: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (content[span.start] !== '#' || span.start < cursor) continue;
    hashChunks.push(content.slice(cursor, span.start));
    const seg = content.slice(span.start, span.end);
    hashChunks.push(seg.includes('\n') ? seg.replace(/[^\n]/g, ' ') : ' '.repeat(seg.length));
    cursor = span.end;
  }
  hashChunks.push(content.slice(cursor));
  // Strip full-line `//` comments outside strings/heredocs while preserving URLs (`https://...`) and globs (`/tmp/*`).
  const partiallyClean = hashChunks.length > 1 ? hashChunks.join('') : content;
  const lines = partiallyClean.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\/\//.test(line) && !isIndexInSpans(spans, offset + line.indexOf('//'))) {
      lines[i] = ' '.repeat(line.length);
    }
    offset += line.length + 1;
  }
  return { commentFree: lines.join('\n'), spans };
}

function extractShellCommandHeads(scriptContent: string): Array<{ head: string; segment: string }> {
  const { commentFree, spans } = stripLeadingComments(scriptContent);
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
      if (SHELL_PREFIX_KEYWORDS.has(tok.toLowerCase())) {
        idx++;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
        const subCmdMatch = tok.match(/^[A-Za-z_][A-Za-z0-9_]*=["']?(?:\$\(|`)([^\s`()]+)/);
        if (subCmdMatch?.[1] !== undefined) {
          out.push({ head: subCmdMatch[1].toLowerCase(), segment });
          break;
        }
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
    if (NETWORK_ALIAS_SET.has(head) || FS_SEARCH_ALIAS_SET.has(head) || FS_LIST_ALIAS_SET.has(head) || SYSTEMD_ALIAS_SET.has(head)) {
      return head;
    }
    if (isPosixFindSegment(head, segment)) return head;
  }
  return undefined;
}

interface ShellPayloadClassification {
  isShell: boolean;
  precomputedIsShellScript?: boolean;
  precomputedIsPwsh?: boolean;
  precomputedDetectedAlias?: string | undefined;
}

function classifyShellPayload(payload: ExecPayload): ShellPayloadClassification {
  if (payload.type === 'eval') {
    if (payload.interpreter !== undefined && payload.interpreter.length > 0) {
      return { isShell: SHELL_INTERPRETER_SET.has(payload.interpreter.toLowerCase()) };
    }
    const isShellCmd = isShellCommandScript(payload.code);
    if ((!isShellCmd && isJavaScriptOrTypeScriptCode(payload.code)) || isPythonCode(payload.code)) {
      return { isShell: false };
    }
    const isPwsh = isPowerShellCode(payload.code);
    if (isShellCmd || isPwsh) {
      return { isShell: true, precomputedIsShellScript: isShellCmd, precomputedIsPwsh: isPwsh };
    }
    const alias = detectShellToolAlias(payload.code);
    return alias !== undefined
      ? { isShell: true, precomputedIsShellScript: false, precomputedIsPwsh: false, precomputedDetectedAlias: alias }
      : { isShell: false };
  }
  if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
    if (payload.interpreter) return { isShell: SHELL_INTERPRETER_SET.has(payload.interpreter.toLowerCase()) };
    return { isShell: SHELL_SCRIPT_EXT_SET.has(path.extname(payload.scriptPath).toLowerCase()) };
  }
  return { isShell: false };
}

function routeShellToolAliases(payload: ExecPayload, baseCwd?: string): void {
  if ((payload.type !== 'eval' && payload.type !== 'script') || payload.target === 'wsl2') return;
  const classification = classifyShellPayload(payload);
  if (!classification.isShell) return;
  const scriptContent = readShellScriptContent(payload, baseCwd);
  // [INTENT]: PowerShell cmdlets stay on Windows pwsh rather than routing to WSL2.
  const isPwsh = classification.precomputedIsPwsh ?? isPowerShellCode(scriptContent);
  if (isPwsh) {
    const interpLower = payload.interpreter?.toLowerCase();
    const shouldSwitchToPwsh = interpLower === undefined || interpLower.length === 0 || interpLower === 'bash' || interpLower === 'sh';
    if (shouldSwitchToPwsh && (payload.type === 'eval' || (interpLower !== undefined && interpLower.length > 0))) {
      payload.interpreter = 'pwsh';
      if (process.platform === 'win32') payload.target = 'windows';
    }
    return;
  }
  switchShellToolTarget(payload, scriptContent, classification);
}

function normalizeWinPathIfMnt(p: string): string {
  return process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(p) ? convertToWindowsPath(p) : p;
}

function readShellScriptContent(payload: ExecPayload, baseCwd?: string): string {
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
    if (process.platform === 'win32' && payload.scriptPath.startsWith('~')) return '';
    const normScript = normalizeWinPathIfMnt(payload.scriptPath);
    if (process.platform === 'win32' && normScript.startsWith('/')) return '';
    if (process.platform === 'win32' && typeof payload.cwd === 'string' && payload.cwd.startsWith('~')) return '';
    const normPayloadCwd = payload.cwd !== undefined && payload.cwd.length > 0 ? normalizeWinPathIfMnt(payload.cwd) : undefined;
    if (process.platform === 'win32' && normPayloadCwd !== undefined && normPayloadCwd.startsWith('/')) return '';
    const rawCwd = normPayloadCwd !== undefined
      ? normPayloadCwd
      : (baseCwd !== undefined && baseCwd.length > 0 ? normalizeWinPathIfMnt(baseCwd) : process.cwd());
    const resolved = path.resolve(rawCwd, normScript);
    try {
      const st = fs.statSync(resolved, { throwIfNoEntry: false });
      if (st !== undefined && st.isFile() && st.size <= 512 * 1024) {
        return fs.readFileSync(resolved, 'utf8');
      }
    } catch (err: unknown) {
      const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES') {
        console.error(`⚠️ Shell script read warning (${resolved}): ${err instanceof Error ? err.message : String(err)}`);
      }
      return '';
    }
  }
  return '';
}

function switchShellToolTarget(payload: ExecPayload, scriptContent: string, classification: ShellPayloadClassification): void {
  if (process.platform !== 'win32') return;
  if (payload.type !== 'eval' && payload.type !== 'script') return;
  if (payload.type === 'eval' && !(classification.precomputedIsShellScript ?? isShellCommandScript(scriptContent)) && (isJavaScriptOrTypeScriptCode(scriptContent) || isPythonCode(scriptContent))) return;
  const detected = classification.precomputedDetectedAlias !== undefined ? classification.precomputedDetectedAlias : detectShellToolAlias(scriptContent);
  if (detected === undefined) return;
  payload.target = 'wsl2';
  if (!payload.interpreter || WINDOWS_INTERPRETER_SET.has(payload.interpreter.toLowerCase())) {
    payload.interpreter = 'bash';
  }
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Shell command/script using '${detected}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
}
