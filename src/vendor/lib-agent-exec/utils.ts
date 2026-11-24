// @ts-nocheck
import { ExecPayload } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';
import fs from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';

import { redactTelemetryText, redactPayloadForLog, sanitizeLoggedIssuePayload } from './redaction.js';
export { redactTelemetryText, redactPayloadForLog, sanitizeLoggedIssuePayload };

let lastStderrTail = '';

/** [INTENT]: Child-process stderr tail captured right before a failing exit is reported (attached to EXECUTION_ERROR records). */
export function setLastStderrTail(tail: string): void {
  lastStderrTail = tail;
}

export function getLastStderrTail(maxChars = 500): string {
  return lastStderrTail.length > maxChars ? lastStderrTail.slice(-maxChars) : lastStderrTail;
}

/** [INTENT]: Emit informational 💡 AGENT INTERCEPT notices only when AGENT_EXEC_VERBOSE is opted in. */
export function emitInterceptBanner(message: string): void {
  const v = process.env.AGENT_EXEC_VERBOSE;
  if (v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false') {
    console.error(message);
  }
}

export function recordAgentIssue(issueType: string, message: string, payload?: unknown, extra?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_EXEC_SILENT === '1') return;
  try {
    const filename = fileURLToPath(import.meta.url);
    let targetDir = path.join(path.dirname(filename), '..', '..');

    if (payload !== null && payload !== undefined && typeof payload === 'object' && 'cwd' in payload && typeof payload.cwd === 'string') {
      const root = findEcosystemRoot(payload.cwd);
      if (root) {
        targetDir = path.join(root, '.agents');
      }
    }
    
    const issuesFilePath = path.join(targetDir, 'agent-exec-issues.jsonl');
    const { safePayload, internalStallBypass } = sanitizeLoggedIssuePayload(payload, extra);
    const safeExtra = extra !== undefined ? redactPayloadForLog(extra) : undefined;

    const safeMessage = redactTelemetryText(message);
    const timestamp = new Date().toISOString();
    const record: Record<string, unknown> = {
      ...(safeExtra !== null && typeof safeExtra === 'object' ? safeExtra : {}),
      timestamp,
      issueType,
      message: safeMessage,
      payload: safePayload,
    };
    if (internalStallBypass) {
      record.internalStallBypass = true;
    }
    const entry = JSON.stringify(record) + '\n';
    
    fs.appendFileSync(issuesFilePath, entry, 'utf8');
  } catch {
    // Ignore logging errors to prevent breaking execution
  }
}

function hasKey<K extends string>(obj: object, key: K): obj is object & Record<K, unknown> {
  return Object.hasOwn(obj, key);
}

const nativeBinaryCache = new Map<string, string | null>();

/**
 * [INTENT]: Memoized PATH x PATHEXT lookup for a native binary (no child process spawn).
 * Returns the absolute path, or null when the binary is not installed natively.
 */
export function resolveNativeBinary(name: string): string | null {
  const cached = nativeBinaryCache.get(name);
  if (cached !== undefined) return cached;

  const rawPath = process.env.PATH ?? process.env.Path ?? '';
  const dirs = rawPath.split(path.delimiter).map(d => d.trim().replace(/^"|"$/g, '')).filter(d => d.length > 0);
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim().toLowerCase()).filter(e => e.length > 0)
    : [''];
  const hasExt = isWin && exts.includes(path.extname(name).toLowerCase());

  let resolved: string | null = null;
  outer: for (const dir of dirs) {
    const candidates = hasExt ? [name] : exts.map(ext => `${name}${ext}`);
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      try {
        const st = fs.statSync(full, { throwIfNoEntry: false });
        if (st !== undefined && st.isFile()) {
          resolved = full;
          break outer;
        }
      } catch {
        // Ignore inaccessible PATH entries (e.g., restricted Windows AppExecLinks).
      }
    }
  }
  nativeBinaryCache.set(name, resolved);
  return resolved;
}

/** Test hook: clears the memoized native binary lookups. */
export function clearNativeBinaryCache(): void {
  nativeBinaryCache.clear();
}

/**
 * [INTENT]: Routine argument rewrites that are working as designed (not hallucination healing).
 * They are logged as issueType 'NORMALIZATION' so CMS-03 only triages real healing events.
 */
const NORMALIZATION_PATTERNS: readonly RegExp[] = [
  /Resolved missing '.*' to '/,
  /Expanded glob/i,
  /globs are not expanded automatically/,
  /Normalizing to ripgrep '-g'/,
  /Auto-correcting relative (?:import|require) path/i,
];

export function classifyHealingMessage(message: string): 'NORMALIZATION' | 'AUTONOMOUS_HEALING_TRIGGERED' {
  return NORMALIZATION_PATTERNS.some(re => re.test(message)) ? 'NORMALIZATION' : 'AUTONOMOUS_HEALING_TRIGGERED';
}

/**
 * [INTENT]: Decode payload files regardless of how the agent's shell wrote them.
 * Windows PowerShell 5.1 `>`/Out-File emits UTF-16LE with an FF FE BOM (NUL bytes when read as UTF-8).
 */
export function decodePayloadBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const raw = buf.subarray(2);
    const body = Buffer.from(raw.subarray(0, raw.length - (raw.length % 2)));
    body.swap16();
    return body.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

export const BUILT_INS = ['echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
export const AUTONOMOUS_HEALING_MSG = '\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m';

export function replaceIntegrationContext(str: string, payload: ExecPayload): string {
  if (!('integrationContext' in payload) || !payload.integrationContext) return str;
  const contextStr = JSON.stringify(payload.integrationContext);
  return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match: string, pathStr: string | undefined) => {
    if (!pathStr) return contextStr;
    let current: unknown = payload.integrationContext;
    const keys = pathStr.split('.');
    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object' || !hasKey(current, key)) return match;
      current = current[key];
    }
    return typeof current === 'object' 
      ? JSON.stringify(current) 
      : String(current);
  });
}

const METADATA_HOSTS: ReadonlySet<string> = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal',
]);

function normalizeWebhookHost(rawHost: string): string {
  return rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '').replace(/\.+$/, '');
}

function parseIPv4Octets(ip: string): [number, number, number, number] | null {
  if (net.isIPv4(ip) === false) return null;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function parseIPv6Groups(raw: string): number[] | null {
  if (net.isIPv6(raw) === false) return null;
  let expanded = raw;
  const lastColon = expanded.lastIndexOf(':');
  if (lastColon !== -1 && expanded.includes('.')) {
    const tailOctets = parseIPv4Octets(expanded.slice(lastColon + 1));
    if (tailOctets === null) return null;
    const hi = ((tailOctets[0] << 8) | tailOctets[1]).toString(16);
    const lo = ((tailOctets[2] << 8) | tailOctets[3]).toString(16);
    expanded = `${expanded.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = expanded.split('::');
  if (halves.length > 2) return null;
  const left = (halves[0] ?? '').length > 0 ? (halves[0] ?? '').split(':') : [];
  const right = halves.length === 2 && (halves[1] ?? '').length > 0 ? (halves[1] ?? '').split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;
  const groups = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right].map(g => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

function isBlockedIPv4Octets(octets: readonly [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isBlockedWebhookIp(rawIp: string): boolean {
  const host = normalizeWebhookHost(rawIp);
  if (host.length === 0 || METADATA_HOSTS.has(host)) return true;
  const ipv4 = parseIPv4Octets(host);
  if (ipv4 !== null) return isBlockedIPv4Octets(ipv4);
  const v6 = parseIPv6Groups(host);
  if (v6 === null) return false;
  const [w0, w1, w2, w3, w4, w5, w6, w7] = v6;
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0) {
    return w7 !== 1; // Block unspecified ::; allow loopback ::1
  }
  if ((w0 !== undefined && (w0 & 0xfe00) === 0xfc00) || (w0 !== undefined && (w0 & 0xffc0) === 0xfe80)) return true;
  if (w0 === 0x0064 && w1 === 0xff9b && ((w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) || w2 === 1)) return true;
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && (w5 === 0 || w5 === 0xffff) && w6 !== undefined && w7 !== undefined) {
    return isBlockedIPv4Octets([w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff]);
  }
  if (w0 === 0x2002 && w1 !== undefined && w2 !== undefined) {
    return isBlockedIPv4Octets([w1 >> 8, w1 & 0xff, w2 >> 8, w2 & 0xff]);
  }
  return false;
}

export function validateWebhookUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return null;
    const host = normalizeWebhookHost(parsed.hostname);
    if (host.length === 0 || isBlockedWebhookIp(host)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function resolveAndValidateWebhookUrl(rawUrl: string): Promise<URL | null> {
  const parsed = validateWebhookUrl(rawUrl);
  if (parsed === null) return null;
  const host = normalizeWebhookHost(parsed.hostname);
  if (host === 'localhost' || net.isIP(host) !== 0) return parsed;
  try {
    const entries = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (entries.length === 0 || entries.some(entry => isBlockedWebhookIp(entry.address))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function sendWebhook(
  payload: ExecPayload,
  urls: string | string[],
  vars: { stdout: string, stderr: string, code: number | null, signal: NodeJS.Signals | null, success: boolean, envData: Record<string, unknown> | null }
) {
  const rawHeaders = payload.webhookHeaders ?? {};
  const hasExplicitContentType = Object.keys(rawHeaders).some(k => k.toLowerCase() === 'content-type');
  const headers: Record<string, string> = hasExplicitContentType
    ? { ...rawHeaders }
    : { 'Content-Type': 'application/json', ...rawHeaders };
  let body: string;

  if ('webhookPayloadTemplate' in payload && payload.webhookPayloadTemplate) {
    body = renderWebhookTemplate(
      payload.webhookPayloadTemplate,
      'integrationContext' in payload ? payload.integrationContext : null,
      vars
    );
  } else {
    body = JSON.stringify({ 
      success: vars.success, 
      code: vars.code, 
      signal: vars.signal, 
      stdout: vars.stdout, 
      stderr: vars.stderr 
    });
  }

  const urlArray = Array.isArray(urls) ? urls : [urls];
  await Promise.allSettled(urlArray.map(async (u) => {
    const targetUrl = replaceIntegrationContext(u, payload);
    const method = payload.webhookMethod || 'POST';
    const timeoutMs = payload.webhookTimeoutMs ?? 5000;
    const validatedUrl = await resolveAndValidateWebhookUrl(targetUrl);

    if (validatedUrl === null) {
      console.error(`❌ Webhook Error: Invalid or unsafe target URL for webhook. Only public http/https endpoints allowed.`);
      return;
    }
    const fetchOptions: RequestInit = { method, headers, redirect: 'error' };
    if (timeoutMs > 0) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
    if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') fetchOptions.body = body;
    try {
      const res = await fetch(validatedUrl.href, fetchOptions);
      if (!res.ok) console.error(`❌ Webhook Error: HTTP ${res.status} ${res.statusText}`);
      await res.arrayBuffer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Webhook Error: ${redactTelemetryText(msg)}`);
    }
  }));
}

export function findEcosystemRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const agentsDir = path.join(current, '.agents');
    if (fs.existsSync(agentsDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function findEcosystemScript(startDir: string, scriptName: string): string | null {
  const root = findEcosystemRoot(startDir);
  if (!root) return null;
  const scriptPath = path.join(root, '.agents', 'scripts', scriptName);
  if (fs.existsSync(scriptPath)) {
    return scriptPath;
  }
  return null;
}

export {
  resolveAgentScriptFallback,
  resolveFreshCompiledCommitBundle,
  tryAccelerateCompiledCommitScript,
} from './commit-script-resolver.js';

export async function sendDatadogTelemetry(
  payload: ExecPayload,
  cwd: string,
  metricName: string,
  status: 'success' | 'error' | 'healed',
  exitCode: number | null,
  stdoutSnippet: string,
  stderrSnippet: string
) {
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_EXEC_SILENT === '1') return;
  try {
    const cwdRoot = findEcosystemRoot(cwd);
    const scriptRoot = findEcosystemRoot(fileURLToPath(import.meta.url));
    const cwdEnvPath = cwdRoot !== null ? path.join(cwdRoot, 'secrets.env') : undefined;
    const hasCwdEnv = cwdEnvPath !== undefined && fs.statSync(cwdEnvPath, { throwIfNoEntry: false })?.isFile() === true;
    const root = hasCwdEnv ? cwdRoot : scriptRoot;
    if (!root) return;
    const envPath = path.join(root, 'secrets.env');
    if (envPath !== cwdEnvPath && fs.statSync(envPath, { throwIfNoEntry: false })?.isFile() !== true) return;
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    const apiKey = envConfig.DD_API_KEY;
    if (!apiKey) return;

    const hostname = os.hostname();
    const service = 'lib-agent-exec';
    const source = 'agent-exec';
    
    const now = Math.floor(Date.now() / 1000);
    
    const seriesPayload = {
      series: [
        {
          metric: metricName,
          type: 1, // count
          points: [{ timestamp: now, value: 1 }],
          tags: [`status:${status}`],
          resources: [{ type: 'host', name: hostname }]
        }
      ]
    };

    const logPayload = [{
      ddsource: source,
      ddtags: `status:${status},exit_code:${exitCode}`,
      hostname: hostname,
      message: redactTelemetryText(`Command executed: ${payload.type === 'command' ? payload.command : payload.type}\nStatus: ${status}\nExit Code: ${exitCode}\n\nSTDOUT:\n${stdoutSnippet}\n\nSTDERR:\n${stderrSnippet}`),
      service: service,
      status: status === 'error' ? 'error' : 'info',
      agent_exec_status: status
    }];

    const headers = {
      'Content-Type': 'application/json',
      'DD-API-KEY': apiKey
    };

    const reqs = [
      fetch('https://api.datadoghq.com/api/v2/series', {
        method: 'POST',
        headers,
        body: JSON.stringify(seriesPayload),
        signal: AbortSignal.timeout(1500)
      }),
      fetch('https://http-intake.logs.datadoghq.com/api/v2/logs', {
        method: 'POST',
        headers,
        body: JSON.stringify(logPayload),
        signal: AbortSignal.timeout(1500)
      }),
    ];

    await Promise.allSettled(reqs);
  } catch {
    // Fail silently so we don't break the agent
  }
}

