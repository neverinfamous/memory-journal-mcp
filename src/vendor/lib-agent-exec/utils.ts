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

const THIS_FILENAME = fileURLToPath(import.meta.url);
const THIS_AGENTS_DIR = path.join(path.dirname(THIS_FILENAME), '..', '..');

export function recordAgentIssue(issueType: string, message: string, payload?: unknown, extra?: Record<string, unknown>): void {
  if (process.env['NODE_ENV'] === 'test' || process.env['AGENT_EXEC_SILENT'] === '1') return;
  try {
    let targetDir = THIS_AGENTS_DIR;

    if (payload !== null && payload !== undefined && typeof payload === 'object' && 'cwd' in payload && typeof payload.cwd === 'string') {
      const root = findEcosystemRoot(payload.cwd);
      if (root) {
        targetDir = path.join(root, '.agents');
      }
    }
    
    const dirStat = fs.lstatSync(targetDir, { throwIfNoEntry: false });
    if (dirStat === undefined || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return;
    const issuesFilePath = path.join(targetDir, 'agent-exec-issues.jsonl');
    const issuesStat = fs.lstatSync(issuesFilePath, { throwIfNoEntry: false });
    if (issuesStat !== undefined && (issuesStat.isSymbolicLink() || !issuesStat.isFile())) return;
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
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(
      issuesFilePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | noFollow,
      0o600,
    );
    try {
      fs.writeSync(fd, entry, undefined, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'EACCES' && code !== 'EPERM' && code !== 'ELOOP') {
      console.error(`⚠️ Issue log write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function errorCodeOf(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
}

const nativeBinaryCache = new Map<string, string | null>();

/**
 * [INTENT]: Memoized PATH x PATHEXT lookup for a native binary (no child process spawn).
 * Returns the absolute path, or null when the binary is not installed natively.
 */
function isWindowsSymlinkExecFallback(full: string): boolean {
  try {
    const lst = fs.lstatSync(full, { throwIfNoEntry: false });
    return lst !== undefined && !lst.isDirectory();
  } catch (lstatErr: unknown) {
    const lCode = errorCodeOf(lstatErr);
    if (lCode !== 'ENOENT' && lCode !== 'ENOTDIR' && lCode !== 'EACCES') {
      console.error(`⚠️ Binary lstat probe warning (${full}): ${lstatErr instanceof Error ? lstatErr.message : String(lstatErr)}`);
    }
    return false;
  }
}

function isAccessibleExecutable(full: string, isWin: boolean): boolean {
  try {
    const st = fs.statSync(full, { throwIfNoEntry: false });
    return st !== undefined && st.isFile() && (isWin || (st.mode & 0o111) !== 0);
  } catch (err: unknown) {
    const code = errorCodeOf(err) ?? '';
    return isWin && (code === 'EACCES' || code === 'EPERM') && isWindowsSymlinkExecFallback(full);
  }
}

export function resolveNativeBinary(name: string): string | null {
  const rawPath = process.env['PATH'] ?? process.env['Path'] ?? '';
  const cacheKey = `${rawPath}\0${name}`;
  const cached = nativeBinaryCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const dirs = new Set<string>();
  for (const part of rawPath.split(path.delimiter)) {
    const trimmed = part.trim().replace(/^"|"$/g, '');
    if (trimmed.length > 0) dirs.add(trimmed);
  }
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim().toLowerCase()).filter(e => e.length > 0)
    : [''];
  const hasExt = isWin && exts.includes(path.extname(name).toLowerCase());

  let resolved: string | null = null;
  const candidates = hasExt ? [name] : exts.map(ext => `${name}${ext}`);
  outer: for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (isAccessibleExecutable(full, isWin)) {
        resolved = full;
        break outer;
      }
    }
  }
  nativeBinaryCache.set(cacheKey, resolved);
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

function isNonSymlinkDir(dirPath: string): boolean {
  const st = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isDirectory();
}

function isRegularNonSymlinkFile(filePath: string): boolean {
  const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isFile();
}

function isContainedInRealDir(targetPath: string, baseDir: string): boolean {
  try {
    const realBase = fs.realpathSync.native(baseDir);
    const realTarget = fs.realpathSync.native(targetPath);
    const normBase = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
    const normTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
    const rel = path.relative(normBase, normTarget);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  } catch (err: unknown) {
    const code = errorCodeOf(err);
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      console.error(`⚠️ Containment realpath warning (${targetPath}): ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

const ecosystemRootCache = new Map<string, string | null>();
const NORM_TMP_ROOT = (() => {
  const r = path.resolve(os.tmpdir());
  return process.platform === 'win32' ? r.toLowerCase() : r;
})();

function isUnderTempRoot(resolvedDir: string): boolean {
  const norm = process.platform === 'win32' ? resolvedDir.toLowerCase() : resolvedDir;
  const rel = path.relative(NORM_TMP_ROOT, norm);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function findEcosystemRoot(startDir: string): string | null {
  const startResolved = path.resolve(startDir);
  const skipCache = isUnderTempRoot(startResolved);
  if (!skipCache) {
    const cached = ecosystemRootCache.get(startResolved);
    if (cached !== undefined) return cached;
  }
  let current = startResolved;
  let result: string | null = null;
  while (true) {
    const agentsDir = path.join(current, '.agents');
    if (isNonSymlinkDir(agentsDir)) {
      result = current;
      break;
    }
    if (fs.lstatSync(path.join(current, '.git'), { throwIfNoEntry: false }) !== undefined) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  if (!skipCache) {
    if (ecosystemRootCache.size >= 64) ecosystemRootCache.clear();
    ecosystemRootCache.set(startResolved, result);
  }
  return result;
}

export function findEcosystemScript(startDir: string, scriptName: string): string | null {
  const root = findEcosystemRoot(startDir);
  if (root === null) return null;
  const scriptsDir = path.join(root, '.agents', 'scripts');
  if (!isNonSymlinkDir(scriptsDir)) return null;
  const scriptPath = path.join(scriptsDir, scriptName);
  if (isRegularNonSymlinkFile(scriptPath) && isContainedInRealDir(scriptPath, scriptsDir)) {
    return scriptPath;
  }
  return null;
}

export {
  resolveAgentScriptFallback,
  resolveFreshCompiledCommitBundle,
  tryAccelerateCompiledCommitScript,
} from './commit-script-resolver.js';

const ddApiKeyCache = new Map<string, string | null>();

function resolveDatadogApiKey(cwd: string): string | null {
  const cached = ddApiKeyCache.get(cwd);
  if (cached !== undefined) return cached;
  let apiKey: string | null = null;
  const cwdRoot = findEcosystemRoot(cwd);
  const cwdEnvPath = cwdRoot !== null ? path.join(cwdRoot, 'secrets.env') : undefined;
  const hasCwdEnv = cwdEnvPath !== undefined && isRegularNonSymlinkFile(cwdEnvPath);
  let envPath = hasCwdEnv ? cwdEnvPath : undefined;
  if (envPath === undefined) {
    const scriptRoot = findEcosystemRoot(fileURLToPath(import.meta.url));
    if (scriptRoot !== null) {
      const candidate = path.join(scriptRoot, 'secrets.env');
      if (isRegularNonSymlinkFile(candidate)) {
        envPath = candidate;
      }
    }
  }
  if (envPath !== undefined) {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    apiKey = envConfig['DD_API_KEY'] || null;
  }
  if (ddApiKeyCache.size >= 64) ddApiKeyCache.clear();
  ddApiKeyCache.set(cwd, apiKey);
  return apiKey;
}

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
    const apiKey = resolveDatadogApiKey(cwd);
    if (apiKey === null) return;

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
  } catch (err: unknown) {
    console.error(`⚠️ Telemetry dispatch warning: ${err instanceof Error ? err.message : String(err)}`);
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


