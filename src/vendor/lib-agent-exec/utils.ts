// @ts-nocheck
import { type ExecPayload } from './schema.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';

import { redactTelemetryText, redactPayloadForLog, sanitizeLoggedIssuePayload } from './redaction.js';
import {
  isBlockedWebhookIp,
  replaceIntegrationContext,
  resolveAndValidateWebhookUrl,
  resolvePinnedWebhookTarget,
  sendPinnedWebhookRequest,
  sendWebhookWithReporter,
  validateWebhookUrl,
  type PinnedWebhookRequestInit,
  type PinnedWebhookResponse,
  type PinnedWebhookTarget,
  type WebhookVars,
} from './webhook-client.js';
export { redactTelemetryText, redactPayloadForLog, sanitizeLoggedIssuePayload };
export {
  isBlockedWebhookIp,
  replaceIntegrationContext,
  resolveAndValidateWebhookUrl,
  resolvePinnedWebhookTarget,
  sendPinnedWebhookRequest,
  validateWebhookUrl,
  type PinnedWebhookRequestInit,
  type PinnedWebhookResponse,
  type PinnedWebhookTarget,
};

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
  const v = process.env['AGENT_EXEC_VERBOSE'];
  if (v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false') {
    console.error(message);
  }
}

export function recordAgentIssue(issueType: string, message: string, payload?: unknown, extra?: Record<string, unknown>): void {
  if (process.env['NODE_ENV'] === 'test' || process.env['AGENT_EXEC_SILENT'] === '1') return;
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
      record['internalStallBypass'] = true;
    }
    const entry = JSON.stringify(record) + '\n';
    
    fs.appendFileSync(issuesFilePath, entry, 'utf8');
  } catch {
    // Ignore logging errors to prevent breaking execution
  }
}

const nativeBinaryCache = new Map<string, string | null>();

/**
 * [INTENT]: Memoized PATH x PATHEXT lookup for a native binary (no child process spawn).
 * Returns the absolute path, or null when the binary is not installed natively.
 */
function isAccessibleExecutable(full: string, isWin: boolean): boolean {
  try {
    const st = fs.statSync(full, { throwIfNoEntry: false });
    return st !== undefined && st.isFile() && (isWin || (st.mode & 0o111) !== 0);
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : '';
    if (!isWin || (code !== 'EACCES' && code !== 'EPERM')) return false;
    try {
      const lst = fs.lstatSync(full, { throwIfNoEntry: false });
      return lst !== undefined && !lst.isDirectory();
    } catch {
      return false;
    }
  }
}

export function resolveNativeBinary(name: string): string | null {
  const cached = nativeBinaryCache.get(name);
  if (cached !== undefined) return cached;

  const rawPath = process.env['PATH'] ?? process.env['Path'] ?? '';
  const dirs = rawPath.split(path.delimiter).map(d => d.trim().replace(/^"|"$/g, '')).filter(d => d.length > 0);
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim().toLowerCase()).filter(e => e.length > 0)
    : [''];
  const hasExt = isWin && exts.includes(path.extname(name).toLowerCase());

  let resolved: string | null = null;
  outer: for (const dir of dirs) {
    const candidates = hasExt ? [name] : exts.map(ext => `${name}${ext}`);
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (isAccessibleExecutable(full, isWin)) {
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
 * They are logged as issueType 'NORMALIZATION' so downstream issue triage only surfaces real healing events.
 */
const NORMALIZATION_PATTERNS: readonly RegExp[] = [
  /Resolved missing '.*' to '/,
  /Expanded glob/i,
  /globs are not expanded automatically/,
  /Normalizing to ripgrep '-g'/,
  /Normalizing (?:existing|search|script) path to /i,
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

export async function sendWebhook(
  payload: ExecPayload,
  urls: string | string[],
  vars: WebhookVars,
  isJson = false,
): Promise<void> {
  await sendWebhookWithReporter(payload, urls, vars, isJson, recordAgentIssue);
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
): Promise<void> {
  if (process.env['NODE_ENV'] === 'test' || process.env['AGENT_EXEC_SILENT'] === '1') return;
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
    const apiKey = envConfig['DD_API_KEY'];
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
        signal: AbortSignal.timeout(1500),
      }).then((res) => res.body?.cancel()),
      fetch('https://http-intake.logs.datadoghq.com/api/v2/logs', {
        method: 'POST',
        headers,
        body: JSON.stringify(logPayload),
        signal: AbortSignal.timeout(1500),
      }).then((res) => res.body?.cancel()),
    ];

    await Promise.allSettled(reqs);
  } catch {
    // Fail silently so we don't break the agent
  }
}

export function createNullProtoRecord<V>(): Record<string, V> {
  const obj: Record<string, V> = {};
  Object.setPrototypeOf(obj, null);
  return obj;
}

export async function runAsyncUntil<T>(
  step: () => Promise<{ done: true; value: T } | { done: false }>,
): Promise<T> {
  let resultBox: { value: T } | undefined;
  const iterable: AsyncIterable<void> = {
    [Symbol.asyncIterator](): AsyncIterator<void> {
      return {
        async next(): Promise<IteratorResult<void>> {
          const res = await step();
          if (res.done) {
            resultBox = { value: res.value };
            return { value: undefined, done: true };
          }
          return { value: undefined, done: false };
        },
      };
    },
  };
  for await (const _tick of iterable) {
    continue;
  }
  if (resultBox === undefined) {
    throw new Error('Async stepper exited without producing a result.');
  }
  return resultBox.value;
}


