/**
 * memory-journal-mcp — Pinned JWKS Custom Fetch Helper
 *
 * Ensures runtime JWKS refreshes and preload checks enforce SSRF validation,
 * DNS-resolved IP pinning via `node:https`, no HTTP redirects, and a 1 MB response cap.
 */

import * as https from 'node:https'
import type { IncomingMessage } from 'node:http'
import {
    assertSafeJwksUri,
    createPinnedDnsLookup,
    resolveSafePublicDnsAddresses,
    type ResolvedPublicAddress,
} from './jwks-ssrf-guard.js'
import { isRecord } from '../utils/type-guards.js'

const MAX_JWKS_RESPONSE_BYTES = 1024 * 1024
const JWKS_TIMEOUT_MS = 10_000
const NATIVE_FETCH = globalThis.fetch

function isExplicitLoopbackHost(hostname: string): boolean {
    const h = hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

function readHttpsJwksBody(
    req: ReturnType<typeof https.request>,
    res: IncomingMessage,
    safeResolve: (res: Response) => void,
    safeReject: (err: unknown) => void
): void {
    res.on('error', safeReject)
    const status = res.statusCode ?? 0
    if (status !== 200) {
        req.destroy()
        safeReject(new Error(`JWKS HTTP error! status: ${String(status)}`))
        return
    }
    const chunks: Buffer[] = []
    let totalBytes = 0
    res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > MAX_JWKS_RESPONSE_BYTES) {
            req.destroy()
            safeReject(new Error('JWKS response exceeded 1MB limit'))
            return
        }
        chunks.push(chunk)
    })
    res.on('end', () => {
        const contentType =
            typeof res.headers['content-type'] === 'string'
                ? res.headers['content-type']
                : 'application/json'
        safeResolve(
            new Response(Buffer.concat(chunks), {
                status: 200,
                headers: { 'content-type': contentType },
            })
        )
    })
}

type JwksStreamReader = ReadableStreamDefaultReader<Uint8Array>

async function readNextJwksChunk(
    reader: JwksStreamReader,
    chunks: Uint8Array[],
    total: number
): Promise<Buffer> {
    const step: unknown = await reader.read()
    if (!isRecord(step) || step['done'] === true) {
        return Buffer.concat(chunks)
    }
    const value = step['value']
    let nextTotal = total
    if (value instanceof Uint8Array) {
        nextTotal += value.byteLength
        if (nextTotal > MAX_JWKS_RESPONSE_BYTES) {
            await reader.cancel().catch(() => undefined)
            throw new Error('JWKS response exceeded 1MB limit')
        }
        chunks.push(value)
    }
    return readNextJwksChunk(reader, chunks, nextTotal)
}

function readLimitedJwksStream(body: NonNullable<Response['body']>): Promise<Buffer> {
    return readNextJwksChunk(body.getReader(), [], 0)
}

async function fetchLoopbackJwks(urlStr: string, init?: RequestInit): Promise<Response> {
    const response = await NATIVE_FETCH(urlStr, {
        method: init?.method ?? 'GET',
        ...(init?.headers !== undefined ? { headers: init.headers } : {}),
        signal: init?.signal ?? AbortSignal.timeout(JWKS_TIMEOUT_MS),
        redirect: 'error',
    })
    if (!response.ok) {
        await response.body?.cancel?.().catch(() => undefined)
        throw new Error(`HTTP error! status: ${String(response.status)}`)
    }
    const contentLen = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(contentLen) && contentLen > MAX_JWKS_RESPONSE_BYTES) {
        await response.body?.cancel?.().catch(() => undefined)
        throw new Error('JWKS response exceeded 1MB limit')
    }
    let buf: Buffer
    if (response.body !== null && response.body !== undefined && typeof response.body.getReader === 'function') {
        buf = await readLimitedJwksStream(response.body)
    } else {
        buf = Buffer.from(await response.arrayBuffer())
        if (buf.length > MAX_JWKS_RESPONSE_BYTES) {
            throw new Error('JWKS response exceeded 1MB limit')
        }
    }
    const contentType = response.headers?.get?.('content-type') ?? 'application/json'
    return new Response(buf, {
        status: response.status,
        headers: { 'content-type': contentType },
    })
}

function attachJwksDeadlineAndAbort(
    req: ReturnType<typeof https.request>,
    signal: AbortSignal | null | undefined,
    safeReject: (err: unknown) => void
): NodeJS.Timeout {
    const deadlineTimer = setTimeout(() => {
        req.destroy()
        safeReject(new Error('JWKS request timeout'))
    }, JWKS_TIMEOUT_MS)
    deadlineTimer.unref()
    req.on('error', safeReject)
    req.on('timeout', () => {
        req.destroy()
        safeReject(new Error('JWKS request timeout'))
    })
    if (signal !== undefined && signal !== null) {
        const onAbort = (): void => {
            clearTimeout(deadlineTimer)
            req.destroy()
            safeReject(new Error('JWKS request aborted'))
        }
        if (signal.aborted) {
            onAbort()
            return deadlineTimer
        }
        signal.addEventListener('abort', onAbort, { once: true })
        req.on('close', () => {
            signal.removeEventListener('abort', onAbort)
        })
    }
    return deadlineTimer
}

function fetchPinnedHttpsJwks(
    urlStr: string,
    parsedUrl: URL,
    resolvedRecords: readonly ResolvedPublicAddress[],
    init?: RequestInit
): Promise<Response> {
    const primary = resolvedRecords[0]
    if (primary === undefined) {
        return Promise.reject(new Error('No validated DNS addresses available for JWKS'))
    }
    return new Promise<Response>((resolve, reject) => {
        let settled = false
        let deadlineTimer: NodeJS.Timeout | undefined
        const clearDeadline = (): void => {
            if (deadlineTimer !== undefined) {
                clearTimeout(deadlineTimer)
                deadlineTimer = undefined
            }
        }
        const safeResolve = (value: Response): void => {
            if (settled) return
            settled = true
            clearDeadline()
            resolve(value)
        }
        const safeReject = (err: unknown): void => {
            if (settled) return
            settled = true
            clearDeadline()
            reject(err instanceof Error ? err : new Error(String(err)))
        }

        const req = https.request(
            urlStr,
            {
                method: init?.method ?? 'GET',
                headers: {
                    Accept: 'application/json',
                    Host: parsedUrl.host,
                },
                lookup: createPinnedDnsLookup(primary, resolvedRecords),
                timeout: JWKS_TIMEOUT_MS,
            },
            (res) => {
                readHttpsJwksBody(req, res, safeResolve, safeReject)
            }
        )
        deadlineTimer = attachJwksDeadlineAndAbort(req, init?.signal, safeReject)
        if (!settled) req.end()
    })
}

/**
 * Returns a `fetch`-compatible function for `jose.createRemoteJWKSet([jose.customFetch])`
 * and `TokenValidator.preload()`, enforcing SSRF DNS pinning and a 1 MB size cap.
 */
export function createPinnedJwksFetch(): typeof fetch {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const urlStr =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url
        const preResolved = await assertSafeJwksUri(urlStr)

        // Preserve mocked `globalThis.fetch` in unit tests without bypassing assertSafeJwksUri.
        if (
            (process.env['NODE_ENV'] === 'test' || Boolean(process.env['VITEST'])) &&
            globalThis.fetch !== NATIVE_FETCH
        ) {
            const response = await globalThis.fetch(urlStr, {
                method: init?.method ?? 'GET',
                ...(init?.headers !== undefined ? { headers: init.headers } : {}),
                signal: init?.signal ?? AbortSignal.timeout(JWKS_TIMEOUT_MS),
                redirect: 'error',
            })
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${String(response.status)}`)
            }
            return response
        }

        const parsedUrl = new URL(urlStr)
        if (isExplicitLoopbackHost(parsedUrl.hostname)) {
            return fetchLoopbackJwks(urlStr, init)
        }
        if (parsedUrl.protocol !== 'https:') {
            throw new Error(`JWKS URI must use HTTPS for non-loopback hosts: ${urlStr}`)
        }
        const resolvedRecords =
            preResolved ?? (await resolveSafePublicDnsAddresses(parsedUrl.hostname.toLowerCase(), 'JWKS'))
        return fetchPinnedHttpsJwks(urlStr, parsedUrl, resolvedRecords, init)
    }
}
