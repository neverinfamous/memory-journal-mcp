// @ts-nocheck
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { type ExecPayload } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';
import { redactTelemetryText } from './redaction.js';

const NATIVE_FETCH = globalThis.fetch;

function hasKey<K extends string>(obj: object, key: K): obj is object & Record<K, unknown> {
  return Object.hasOwn(obj, key);
}

/**
 * [INTENT]: Interpolate `{{integrationContext}}` and dotted field placeholders in strings.
 */
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
    return typeof current === 'string'
      ? current
      : typeof current === 'number' || typeof current === 'boolean'
        ? String(current)
        : (JSON.stringify(current) ?? '');
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

/**
 * [INTENT]: Block private/CGNAT/link-local/ULA/NAT64/6to4/metadata IPs while permitting loopback webhook targets.
 */
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
  if (w0 !== undefined && ((w0 & 0xff00) === 0xff00 || (w0 & 0xffc0) === 0xfec0)) return true;
  if (w0 === 0x0064 && w1 === 0xff9b && ((w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) || w2 === 1)) return true;
  const isEmbeddedV4Prefix = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && (
    (w4 === 0 && (w5 === 0 || w5 === 0xffff)) ||
    (w4 === 0xffff && w5 === 0)
  );
  if (isEmbeddedV4Prefix && w6 !== undefined && w7 !== undefined) {
    return isBlockedIPv4Octets([w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff]);
  }
  if (w0 === 0x2002 && w1 !== undefined && w2 !== undefined) {
    return isBlockedIPv4Octets([w1 >> 8, w1 & 0xff, w2 >> 8, w2 & 0xff]);
  }
  return false;
}

export interface PinnedWebhookTarget {
  url: URL;
  pinnedIp: string | null;
  family: 4 | 6 | null;
}

export interface PinnedWebhookRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs: number;
}

export interface PinnedWebhookResponse {
  ok: boolean;
  status: number;
  statusText: string;
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

export async function resolvePinnedWebhookTarget(rawUrl: string): Promise<PinnedWebhookTarget | null> {
  const parsed = validateWebhookUrl(rawUrl);
  if (parsed === null) return null;
  const host = normalizeWebhookHost(parsed.hostname);
  if (host === 'localhost') return { url: parsed, pinnedIp: null, family: null };
  const literalFamily = net.isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    return { url: parsed, pinnedIp: host, family: literalFamily };
  }
  try {
    const entries = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (entries.length === 0 || entries.some(entry => isBlockedWebhookIp(entry.address))) return null;
    const first = entries[0];
    if (first === undefined) return null;
    const family: 4 | 6 = first.family === 6 || net.isIP(first.address) === 6 ? 6 : 4;
    return { url: parsed, pinnedIp: first.address, family };
  } catch {
    return null;
  }
}

export async function resolveAndValidateWebhookUrl(rawUrl: string): Promise<URL | null> {
  const resolved = await resolvePinnedWebhookTarget(rawUrl);
  return resolved?.url ?? null;
}

function createPinnedLookup(pinnedIp: string, family: 4 | 6): net.LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: pinnedIp, family }]);
    } else {
      callback(null, pinnedIp, family);
    }
  };
}

export async function sendPinnedWebhookRequest(
  target: PinnedWebhookTarget,
  init: PinnedWebhookRequestInit,
): Promise<PinnedWebhookResponse> {
  if (target.pinnedIp === null || globalThis.fetch !== NATIVE_FETCH) {
    const fetchOptions: RequestInit = { method: init.method, headers: init.headers, redirect: 'error' };
    if (init.timeoutMs > 0) fetchOptions.signal = AbortSignal.timeout(init.timeoutMs);
    if (init.body !== undefined) {
      fetchOptions.body = typeof init.body === 'string' ? init.body : new Blob([new Uint8Array(init.body)]);
    }
    const res = await fetch(target.url.href, fetchOptions);
    await res.body?.cancel();
    return { ok: res.ok, status: res.status, statusText: res.statusText };
  }

  const family: 4 | 6 = target.family ?? (net.isIP(target.pinnedIp) === 6 ? 6 : 4);
  const lookup = createPinnedLookup(target.pinnedIp, family);
  const isHttps = target.url.protocol.toLowerCase() === 'https:';
  const sniHost = normalizeWebhookHost(target.url.hostname);
  return await new Promise<PinnedWebhookResponse>((resolve, reject) => {
    const baseOpts: http.RequestOptions = { method: init.method, headers: init.headers, lookup };
    if (init.timeoutMs > 0) baseOpts.signal = AbortSignal.timeout(init.timeoutMs);
    const httpsOpts: https.RequestOptions = net.isIP(sniHost) === 0
      ? { ...baseOpts, servername: sniHost }
      : baseOpts;
    const req = isHttps
      ? https.request(target.url, httpsOpts, handleRes)
      : http.request(target.url, baseOpts, handleRes);
    function handleRes(res: http.IncomingMessage): void {
      const status = res.statusCode ?? 0;
      const statusText = res.statusMessage ?? '';
      res.on('error', (resErr: Error) => {
        if (!settled) {
          settled = true;
          reject(resErr);
        }
      });
      res.destroy();
      if (status >= 300 && status < 400) {
        if (!settled) {
          settled = true;
          reject(new Error(`Redirect blocked for webhook request (HTTP ${status})`));
        }
        return;
      }
      if (!settled) {
        settled = true;
        resolve({ ok: status >= 200 && status < 300, status, statusText });
      }
    }
    let settled = false;
    req.on('error', (reqErr: Error) => {
      if (!settled) {
        settled = true;
        reject(reqErr);
      }
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

export type WebhookIssueReporter = (issueType: string, message: string, payload?: unknown) => void;

export type WebhookVars = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  success: boolean;
  envData: Record<string, unknown> | null;
};

export async function sendWebhookWithReporter(
  payload: ExecPayload,
  urls: string | string[],
  vars: WebhookVars,
  isJson: boolean,
  reportIssue?: WebhookIssueReporter,
): Promise<void> {
  const rawHeaders = payload.webhookHeaders ?? {};
  const hasExplicitContentType = Object.keys(rawHeaders).some(k => k.toLowerCase() === 'content-type');
  const headers: Record<string, string> = hasExplicitContentType
    ? { ...rawHeaders }
    : { 'Content-Type': 'application/json', ...rawHeaders };
  const body = ('webhookPayloadTemplate' in payload && payload.webhookPayloadTemplate)
    ? renderWebhookTemplate(
        payload.webhookPayloadTemplate,
        'integrationContext' in payload ? payload.integrationContext : null,
        vars,
      )
    : JSON.stringify({
        success: vars.success,
        code: vars.code,
        signal: vars.signal,
        stdout: vars.stdout,
        stderr: vars.stderr,
      });

  const emitError = (msg: string): void => {
    if (isJson) reportIssue?.('WEBHOOK_DELIVERY_FAILED', msg, payload);
    else console.error(msg);
  };

  const urlArray = Array.isArray(urls) ? urls : [urls];
  await Promise.allSettled(urlArray.map(async (u) => {
    const targetUrl = replaceIntegrationContext(u, payload);
    const method = payload.webhookMethod || 'POST';
    const timeoutMs = payload.webhookTimeoutMs ?? 5000;
    const pinnedTarget = await resolvePinnedWebhookTarget(targetUrl);

    if (pinnedTarget === null) {
      emitError(`❌ Webhook Error: Invalid or unsafe target URL for webhook. Only public http/https endpoints allowed.`);
      return;
    }
    const reqInit: PinnedWebhookRequestInit = { method, headers, timeoutMs };
    if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') reqInit.body = body;
    try {
      const res = await sendPinnedWebhookRequest(pinnedTarget, reqInit);
      if (!res.ok) emitError(`❌ Webhook Error: HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitError(`❌ Webhook Error: ${redactTelemetryText(msg)}`);
    }
  }));
}
