// @ts-nocheck
import { ExecPayload } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';

const SECRET_FIELD_RE = /(?:token|secret|passw(?:or)?d|credential|api[_-]?key|private[_-]?key|(?:^|_)key$|^auth$|^authorization$|(?:^|_)auth(?:_|$))/i;
const MAX_LOGGED_STRING = 2000;

const TELEMETRY_SECRET_RE = /((?:token|secret|passw(?:or)?d|credential|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*)(['"]?)[^\s'"]+/gi;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;

export function redactTelemetryText(value: string): string {
  const limited = redactPayloadForLog(value);
  const text = typeof limited === 'string' ? limited : value;
  return text.replace(TELEMETRY_SECRET_RE, '$1$2[REDACTED]').replace(BEARER_RE, 'Bearer [REDACTED]');
}

/**
 * [INTENT]: Redacted, size-bounded deep copy of an arbitrary payload for issue logs.
 * [INVARIANT]: Never writes values of secret-like keys (env tokens, API keys) to disk.
 */
export function redactPayloadForLog(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_LOGGED_STRING ? `${value.substring(0, MAX_LOGGED_STRING)}... [truncated]` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[depth-limit]';
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(v => redactPayloadForLog(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_FIELD_RE.test(k) && v !== null && v !== undefined && v !== '' ? '[REDACTED]' : redactPayloadForLog(v, depth + 1);
  }
  return out;
}

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

export function sanitizeLoggedIssuePayload(payload: unknown, extra?: Record<string, unknown>): { safePayload: unknown; internalStallBypass: boolean } {
  const safePayload = redactPayloadForLog(payload);
  const pre = extra?.preInterceptorPayload;
  const callerSentBypass =
    pre !== null &&
    pre !== undefined &&
    typeof pre === 'object' &&
    'bypassInterceptors' in pre &&
    pre.bypassInterceptors === true;
  if (
    safePayload !== null &&
    safePayload !== undefined &&
    typeof safePayload === 'object' &&
    !Array.isArray(safePayload) &&
    'bypassInterceptors' in safePayload &&
    safePayload.bypassInterceptors === true &&
    !callerSentBypass &&
    pre !== undefined
  ) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(safePayload)) {
      if (k !== 'bypassInterceptors') {
        cleaned[k] = v;
      }
    }
    return { safePayload: cleaned, internalStallBypass: true };
  }
  return { safePayload, internalStallBypass: false };
}

export function recordAgentIssue(issueType: string, message: string, payload?: unknown, extra?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_EXEC_SILENT === '1') return;
  try {
    const filename = fileURLToPath(import.meta.url);
    let targetDir = path.join(path.dirname(filename), '..', '..');

    if (payload && typeof payload === 'object' && 'cwd' in payload && typeof payload.cwd === 'string') {
      const root = findEcosystemRoot(payload.cwd);
      if (root) {
        targetDir = path.join(root, '.agents');
      }
    }
    
    const issuesFilePath = path.join(targetDir, 'agent-exec-issues.jsonl');
    const { safePayload, internalStallBypass } = sanitizeLoggedIssuePayload(payload, extra);
    const safeExtra = extra !== undefined ? redactPayloadForLog(extra) : undefined;

    const timestamp = new Date().toISOString();
    const record: Record<string, unknown> = { timestamp, issueType, message, payload: safePayload };
    if (internalStallBypass) {
      record.internalStallBypass = true;
    }
    if (safeExtra !== null && typeof safeExtra === 'object') {
      Object.assign(record, safeExtra);
    }
    const entry = JSON.stringify(record) + '\n';
    
    fs.appendFileSync(issuesFilePath, entry, 'utf8');
  } catch {
    // Ignore logging errors to prevent breaking execution
  }
}

function hasKey<K extends string>(obj: object, key: K): obj is object & Record<K, unknown> {
  return key in obj;
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
      const st = fs.statSync(full, { throwIfNoEntry: false });
      if (st !== undefined && st.isFile()) {
        resolved = full;
        break outer;
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
  return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
    if (!pathStr) return contextStr;
    let current: unknown = payload.integrationContext;
    const keys = pathStr.split('.');
    for (const key of keys) {
      if (current == null || typeof current !== 'object' || !hasKey(current, key)) return match;
      current = current[key];
    }
    return typeof current === 'object' 
      ? JSON.stringify(current) 
      : (typeof current === 'string' ? JSON.stringify(current).slice(1, -1) : String(current));
  });
}

export async function sendWebhook(
  payload: ExecPayload,
  urls: string | string[],
  vars: { stdout: string, stderr: string, code: number | null, signal: NodeJS.Signals | null, success: boolean, envData: Record<string, unknown> | null }
) {
  const headers = { 'Content-Type': 'application/json', ...(payload.webhookHeaders || {}) };
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
    body = replaceIntegrationContext(body, payload);
  }

  const urlArray = Array.isArray(urls) ? urls : [urls];
  for (const u of urlArray) {
    const targetUrl = replaceIntegrationContext(u, payload);
    const method = payload.webhookMethod || 'POST';
    const timeoutMs = payload.webhookTimeoutMs ?? 5000;

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      console.error(`❌ Webhook Error: Invalid or unsafe target URL for webhook. Only http/https allowed.`);
    } else {
      const fetchOptions: RequestInit = { method, headers };
      if (timeoutMs > 0) {
        fetchOptions.signal = AbortSignal.timeout(timeoutMs);
      }
      if (method !== 'GET') fetchOptions.body = body;
      try { 
        await fetch(targetUrl, fetchOptions).then(async res => {
          if (!res.ok) {
            console.error(`❌ Webhook Error: HTTP ${res.status} ${res.statusText}`);
          }
          return res.arrayBuffer();
        }).catch((err) => { 
          console.error(`❌ Webhook Error: Failed to invoke webhook: ${err.message}`); 
        }); 
      } catch (err) { 
        console.error(`❌ Webhook Error: ${err instanceof Error ? err.message : String(err)}`); 
      }
    }
  }
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
    const root = (cwdRoot && fs.existsSync(path.join(cwdRoot, 'secrets.env')))
      ? cwdRoot
      : scriptRoot;
    if (!root) return;
    const envPath = path.join(root, 'secrets.env');
    if (!fs.existsSync(envPath)) return;
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

    const reqs = [];
    
    // Send Metric
    reqs.push(fetch('https://api.datadoghq.com/api/v2/series', {
      method: 'POST',
      headers,
      body: JSON.stringify(seriesPayload),
      signal: AbortSignal.timeout(1500)
    }).catch(() => {}));
    
    // Send Log
    reqs.push(fetch('https://http-intake.logs.datadoghq.com/api/v2/logs', {
      method: 'POST',
      headers,
      body: JSON.stringify(logPayload),
      signal: AbortSignal.timeout(1500)
    }).catch(() => {}));

    await Promise.allSettled(reqs);
  } catch {
    // Fail silently so we don't break the agent
  }
}

