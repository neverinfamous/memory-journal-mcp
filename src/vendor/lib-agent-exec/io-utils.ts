// @ts-nocheck
import { Writable } from 'node:stream';
import { ExecPayload, JsonEnvelopeSchema } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';

export const WEBHOOK_FLUSH_INTERVAL_MS = 100;

export function isEnvelopeObject(obj: unknown): obj is Record<string, unknown> {
  return JsonEnvelopeSchema.safeParse(obj).success;
}

export function extractEnvelope(tail: string): { parsed: Record<string, unknown>, start: number, end: number } | null {
  let braceCount = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;
  let lastValidEnvelope: { parsed: Record<string, unknown>, start: number, end: number } | null = null;

  for (let i = 0; i < tail.length; i++) {
    const char = tail[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        if (braceCount === 0) startIdx = i;
        braceCount++;
      } else if (char === '}') {
        if (braceCount > 0) {
          braceCount--;
          if (braceCount === 0 && startIdx !== -1) {
            try {
              const candidate = tail.slice(startIdx, i + 1);
              const parsed: unknown = JSON.parse(candidate);
              if (isEnvelopeObject(parsed)) {
                lastValidEnvelope = { parsed, start: startIdx, end: i + 1 };
              }
            } catch {
              // Ignore parse errors
            }
            startIdx = -1;
          }
        }
      }
    }
  }
  return lastValidEnvelope;
}

export function parseEnvelopeFromTail(tailStr: string): Record<string, unknown> | null {
  if (!tailStr) return null;
  const tail = tailStr.trim();
  if (tail.length === 0) return null;
  
  const result = extractEnvelope(tail);
  return result ? result.parsed : null;
}

export function createWebhookStream(filePath: string, payload: ExecPayload): Writable {
  let buffer: Buffer[] = [];
  let timer: NodeJS.Timeout | null = null;
  const inFlightReqs: Set<Promise<void>> = new Set();
  
  const sendChunk = (data: Buffer) => {
    const method = payload.webhookMethod || 'POST';
    const headers: Record<string, string> = { ...payload.webhookHeaders };
    let bodyPayload: BodyInit = new Blob([new Uint8Array(data)]);

    if (payload.webhookPayloadTemplate) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      const chunkStr = data.toString('utf8');
      const vars = {
        stdout: chunkStr,
        stderr: chunkStr,
        success: true,
        code: null,
        signal: null
      };
      bodyPayload = renderWebhookTemplate(
        payload.webhookPayloadTemplate, 
        'integrationContext' in payload ? payload.integrationContext : null, 
        vars
      );
    }
    const fetchOptions: RequestInit = { method, headers };
    if (method !== 'GET') {
      fetchOptions.body = bodyPayload;
    }
    const timeoutMs = payload.webhookTimeoutMs ?? 5000;
    if (timeoutMs > 0) {
      fetchOptions.signal = AbortSignal.timeout(timeoutMs);
    }
    const req = fetch(filePath, fetchOptions).then(res => res.arrayBuffer()).then(() => {}).catch(() => {});
    inFlightReqs.add(req);
    req.finally(() => inFlightReqs.delete(req));
    return req;
  };

  return new Writable({
    write(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
      buffer.push(chunk);
      if (!timer) {
        timer = setTimeout(() => {
          const data = Buffer.concat(buffer);
          buffer = [];
          timer = null;
          sendChunk(data);
        }, WEBHOOK_FLUSH_INTERVAL_MS);
      }
      callback();
    },
    final(callback) {
      const finish = () => {
        if (buffer.length > 0) {
          const data = Buffer.concat(buffer);
          buffer = [];
          if (timer) clearTimeout(timer);
          sendChunk(data).finally(() => callback());
        } else {
          callback();
        }
      };

      if (inFlightReqs.size > 0) {
        Promise.all(Array.from(inFlightReqs)).finally(finish);
      } else {
        finish();
      }
    }
  });
}
