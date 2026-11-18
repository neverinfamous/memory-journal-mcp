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
    resolveSafePublicDnsAddresses,
    type ResolvedPublicAddress,
} from './jwks-ssrf-guard.js'

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
    const status = res.statusCode ?? 0
    if (status !== 200) {
        if ('resume' in res && typeof res.resume === 'function') res.resume()
        safeReject(new Error(`JWKS HTTP error! status: ${String(status)}`))
        return
    }
    const chunks: Buffer[] = []
    let totalBytes = 0
    res.on('error', safeReject)
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

async function fetchLoopbackJwks(urlStr: string, init?: RequestInit): Promise<Response> {
    const response = await NATIVE_FETCH(urlStr, {
        method: init?.method ?? 'GET',
        ...(init?.headers !== undefined ? { headers: init.headers } : {}),
        signal: init?.signal ?? AbortSignal.timeout(JWKS_TIMEOUT_MS),
        redirect: 'error',
    })
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${String(response.status)}`)
    }
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > MAX_JWKS_RESPONSE_BYTES) {
        throw new Error('JWKS response exceeded 1MB limit')
    }
    return new Response(buf, {
        status: response.status,
        headers: response.headers,
    })
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
        const safeResolve = (value: Response): void => {
            if (settled) return
            settled = true
            resolve(value)
        }
        const safeReject = (err: unknown): void => {
            if (settled) return
            settled = true
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
                lookup: (_hostname, options, callback) => {
                    const wantAll =
                        typeof options === 'object' &&
                        options !== null &&
                        'all' in options &&
                        options.all === true
                    if (wantAll) {
                        const cb = callback as unknown as (
                            err: NodeJS.ErrnoException | null,
                            addresses: ResolvedPublicAddress[]
                        ) => void
                        cb(null, [...resolvedRecords])
                        return
                    }
                    callback(null, primary.address, primary.family)
                },
                timeout: JWKS_TIMEOUT_MS,
            },
            (res) => {
                readHttpsJwksBody(req, res, safeResolve, safeReject)
            }
        )
        req.on('error', safeReject)
        req.on('timeout', () => {
            req.destroy()
            safeReject(new Error('JWKS request timeout'))
        })
        if (init?.signal !== undefined && init.signal !== null) {
            if (init.signal.aborted) {
                req.destroy()
                safeReject(new Error('JWKS request aborted'))
                return
            }
            const onAbort = (): void => {
                req.destroy()
                safeReject(new Error('JWKS request aborted'))
            }
            init.signal.addEventListener('abort', onAbort, { once: true })
            req.on('close', () => {
                init.signal?.removeEventListener('abort', onAbort)
            })
        }
        req.end()
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
