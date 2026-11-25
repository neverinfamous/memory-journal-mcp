// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { type ExecPayload, JsonEnvelopeSchema } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';
import {
  recordAgentIssue,
  redactTelemetryText,
  replaceIntegrationContext,
  resolvePinnedWebhookTarget,
  sendPinnedWebhookRequest,
  validateWebhookUrl,
  type PinnedWebhookRequestInit,
} from './utils.js';

export function hasWebhookStream(payload: ExecPayload): boolean {
  return [payload.stdoutFile, payload.stderrFile].some((f) => {
    if (typeof f !== 'string') return false;
    const expanded = replaceIntegrationContext(f, payload);
    return /^https?:\/\//i.test(expanded);
  });
}

export function createConfiguredOutputStream(
  kind: 'STDOUT' | 'STDERR',
  rawPath: string,
  payload: ExecPayload,
  cwd: string,
  isJson: boolean,
): fs.WriteStream | Writable | undefined {
  const safeFileForLog = redactTelemetryText(rawPath);
  try {
    const expanded = replaceIntegrationContext(rawPath, payload);
    let stream: fs.WriteStream | Writable;
    if (/^https?:\/\//i.test(expanded)) {
      if (validateWebhookUrl(expanded) === null) throw new Error('Invalid or unsafe webhook stream URL.');
      stream = createWebhookStream(expanded, payload);
    } else {
      const outPath = path.resolve(cwd, expanded);
      const dir = path.dirname(outPath);
      fs.mkdirSync(dir, { recursive: true });
      stream = fs.createWriteStream(outPath);
    }
    stream.on('error', (err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (isJson) recordAgentIssue('IO_STREAM_ERROR', `${kind} File Stream Error: ${errMsg}`, payload, { file: safeFileForLog });
      else console.error(`❌ ${kind} File Stream Error: ${errMsg}. Agent execution will continue, but output capturing to file may be incomplete.`);
      stream.destroy();
    });
    if (!isJson) console.error(`\n✅ ${kind} successfully streaming to ${redactTelemetryText(expanded)}`);
    return stream;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson) recordAgentIssue('IO_STREAM_ERROR', `${kind} File Setup Error: ${msg}`, payload, { file: safeFileForLog });
    else console.error(`❌ ${kind} File Setup Error: ${msg}. Output will not be captured to file.`);
    return undefined;
  }
}

export const WEBHOOK_FLUSH_INTERVAL_MS = 100;
export const TAIL_MAX_LENGTH = 2048;
export const TAIL_TRIM_LENGTH = 1024;
export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
export const INFINITE_MAX_BUFFER = 1024 * 1024 * 1024;

export interface EnvelopeMatch {
  parsed: Record<string, unknown>;
  start: number;
  end: number;
}

export function isEnvelopeObject(obj: unknown): obj is Record<string, unknown> {
  return JsonEnvelopeSchema.safeParse(obj).success;
}

export function appendOutputTail(currentTail: string, chunk: string): string {
  const next = currentTail + chunk;
  return next.length > TAIL_MAX_LENGTH ? next.slice(-TAIL_TRIM_LENGTH) : next;
}

const ANSI_TUI_1049 = '\u001b[?1049h';
const ANSI_TUI_47 = '\u001b[?47h';
const ANSI_TUI_1047 = '\u001b[?1047h';
const ANSI_TUI_2004 = '\u001b[?2004h';

export function hasAnsiTuiSequence(tail: string): boolean {
  return tail.includes(ANSI_TUI_1049) ||
    tail.includes(ANSI_TUI_47) ||
    tail.includes(ANSI_TUI_1047) ||
    tail.includes(ANSI_TUI_2004);
}

export function pauseStreamUntilDrained(
  source: NodeJS.ReadableStream | null | undefined,
  targets: Writable[],
): void {
  const activeTargets = targets.filter((t) => !t.destroyed && !t.writableEnded);
  if (!source || activeTargets.length === 0 || ('isPaused' in source && typeof source.isPaused === 'function' && source.isPaused())) {
    return;
  }
  source.pause();
  let drainCount = activeTargets.length;
  activeTargets.forEach((target) => {
    let handled = false;
    const resumeIfDone = (): void => {
      if (handled) return;
      handled = true;
      target.removeListener('drain', resumeIfDone);
      target.removeListener('close', resumeIfDone);
      target.removeListener('error', resumeIfDone);
      drainCount--;
      if (drainCount === 0) source.resume();
    };
    target.once('drain', resumeIfDone);
    target.once('close', resumeIfDone);
    target.once('error', resumeIfDone);
  });
}

function tryParseEnvelopeCandidate(tail: string, start: number, end: number): EnvelopeMatch | null {
  try {
    const parsed: unknown = JSON.parse(tail.slice(start, end));
    if (isEnvelopeObject(parsed)) {
      return { parsed, start, end };
    }
  } catch {
    // Ignore invalid JSON brace spans
  }
  return null;
}

function isLineStartAt(text: string, idx: number): boolean {
  return idx === 0 || text[idx - 1] === '\n' || text[idx - 1] === '\r';
}

export function extractEnvelope(tail: string): EnvelopeMatch | null {
  let braceCount = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;
  let candidateStart = -1;
  let candidateEnd = -1;

  for (let i = 0; i < tail.length; i++) {
    const char = tail[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (braceCount > 0 && char === '"') { inString = true; continue; }

    if (char === '{') {
      if (braceCount === 0) startIdx = i;
      braceCount++;
    } else if (char === '}' && braceCount > 0) {
      braceCount--;
      if (braceCount === 0 && startIdx !== -1) {
        candidateStart = startIdx;
        candidateEnd = i + 1;
        startIdx = -1;
      }
    }
  }

  if (candidateStart === -1 || !isLineStartAt(tail, candidateStart)) return null;
  if (tail.slice(candidateEnd).trim().length > 0) return null;
  return tryParseEnvelopeCandidate(tail, candidateStart, candidateEnd);
}

export function parseEnvelopeFromTail(tailStr: string): Record<string, unknown> | null {
  if (!tailStr) return null;
  const tail = tailStr.trim();
  if (tail.length === 0) return null;

  const result = extractEnvelope(tail);
  return result ? result.parsed : null;
}

function dispatchWebhookChunk(
  filePath: string,
  payload: ExecPayload,
  data: Buffer,
  inFlightReqs: Set<Promise<void>>,
  pinnedTargetPromise: Promise<Awaited<ReturnType<typeof resolvePinnedWebhookTarget>>>,
): Promise<void> {
  const method = payload.webhookMethod || 'POST';
  const headers: Record<string, string> = { ...payload.webhookHeaders };
  let bodyPayload: string | Uint8Array = data;

  if (payload.webhookPayloadTemplate) {
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    const chunkStr = data.toString('utf8');
    bodyPayload = renderWebhookTemplate(
      payload.webhookPayloadTemplate,
      'integrationContext' in payload ? payload.integrationContext : null,
      { stdout: chunkStr, stderr: chunkStr, success: true, code: null, signal: null },
    );
  }
  const timeoutMs = payload.webhookTimeoutMs ?? 5000;
  const reqInit: PinnedWebhookRequestInit = { method, headers, timeoutMs };
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') reqInit.body = bodyPayload;

  const req = (async (): Promise<void> => {
    const pinnedTarget = await pinnedTargetPromise;
    if (pinnedTarget === null) {
      recordAgentIssue('WEBHOOK_DELIVERY_FAILED', 'Invalid or unsafe webhook stream URL', payload, { targetUrl: filePath, method });
      return;
    }
    const res = await sendPinnedWebhookRequest(pinnedTarget, reqInit);
    if (!res.ok) {
      recordAgentIssue('WEBHOOK_DELIVERY_FAILED', `Webhook stream returned HTTP ${res.status}`, payload, { targetUrl: filePath, method });
    }
  })().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    recordAgentIssue('WEBHOOK_DELIVERY_FAILED', `Webhook stream request failed: ${msg}`, payload, { targetUrl: filePath, method });
  });
  inFlightReqs.add(req);
  void req.finally(() => inFlightReqs.delete(req));
  return req;
}

export function createWebhookStream(filePath: string, payload: ExecPayload): Writable {
  let buffer: Buffer[] = [];
  let timer: NodeJS.Timeout | null = null;
  const inFlightReqs = new Set<Promise<void>>();
  const pinnedTargetPromise = resolvePinnedWebhookTarget(filePath);

  const clearFlushTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const sendChunk = (data: Buffer): Promise<void> => dispatchWebhookChunk(filePath, payload, data, inFlightReqs, pinnedTargetPromise);

  return new Writable({
    write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
      buffer.push(chunk);
      if (!timer) {
        timer = setTimeout(() => {
          const data = Buffer.concat(buffer);
          buffer = [];
          timer = null;
          void sendChunk(data);
        }, WEBHOOK_FLUSH_INTERVAL_MS);
      }
      callback();
    },
    final(callback) {
      clearFlushTimer();
      const finish = (): void => {
        if (buffer.length > 0) {
          const data = Buffer.concat(buffer);
          buffer = [];
          void sendChunk(data).finally(() => callback());
          return;
        }
        callback();
      };
      if (inFlightReqs.size > 0) void Promise.all(Array.from(inFlightReqs)).finally(finish);
      else finish();
    },
    destroy(err, callback) {
      clearFlushTimer();
      buffer = [];
      callback(err);
    },
  });
}

export async function closeStreamsWithTimeout(streams: readonly (Writable | undefined)[], timeoutMs: number): Promise<void> {
  const active = streams.filter((s): s is Writable => s !== undefined && !s.destroyed && !s.writableFinished);
  if (active.length === 0) return;
  const closePromises = active.map((stream) => (
    new Promise<void>((resolve) => {
      const done = (): void => {
        stream.off('finish', done);
        stream.off('error', done);
        stream.off('close', done);
        resolve();
      };
      stream.once('finish', done);
      stream.once('error', done);
      stream.once('close', done);
      stream.end();
    })
  ));
  let timeoutId: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      Promise.all(closePromises),
      new Promise<void>((resolve) => { timeoutId = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs); }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (timedOut) {
      for (const s of active) {
        if (!s.destroyed && !s.writableFinished) destroyStreamSafely(s);
      }
    }
  }
}

function destroyStreamSafely(stream: Writable): void {
  try {
    stream.destroy();
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ERR_STREAM_DESTROYED' && code !== 'EPIPE' && code !== 'ENOENT') {
      console.error(`⚠️ Stream destroy warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
