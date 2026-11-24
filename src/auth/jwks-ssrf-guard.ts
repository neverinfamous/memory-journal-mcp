/**
 * memory-journal-mcp — SSRF & DNS Lookup Guards for OAuth / JWKS Endpoints
 */

import { isIP, type LookupFunction } from 'node:net'
import { promises as dns } from 'node:dns'
import { ConfigurationError } from '../types/errors.js'
import { isPrivateOrLoopbackAddress } from '../utils/network-safety.js'
import { isRecord } from '../utils/type-guards.js'

export interface ResolvedPublicAddress {
    address: string
    family: 4 | 6
}

/**
 * Create a Node `https.RequestOptions['lookup']` callback pinned to previously
 * SSRF-validated public DNS addresses (supports both single and `{ all: true }` lookups).
 */
export function createPinnedDnsLookup(
    primary: ResolvedPublicAddress,
    resolvedRecords: readonly ResolvedPublicAddress[]
): LookupFunction {
    return (_hostname, options, callback) => {
        const wantAll =
            typeof options === 'object' &&
            options !== null &&
            'all' in options &&
            options.all === true
        if (wantAll) {
            callback(null, [...resolvedRecords])
            return
        }
        callback(null, primary.address, primary.family)
    }
}

/**
 * Resolve a hostname (or IP literal, optionally bracketed IPv6) via `dns.lookup(..., { all: true })`
 * and fail closed if resolution returns no addresses or if any returned address is private/loopback.
 */
export async function resolveSafePublicDnsAddresses(
    rawHostname: string,
    subjectLabel = 'target'
): Promise<ResolvedPublicAddress[]> {
    const trimmed = rawHostname.trim().toLowerCase()
    const bareHost =
        trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed

    const ipFamily = isIP(bareHost)
    if (ipFamily === 4 || ipFamily === 6) {
        if (isPrivateOrLoopbackAddress(bareHost)) {
            throw new ConfigurationError(
                `SSRF Protection: Requests to private/loopback network addresses are prohibited. Target IP: ${bareHost}`
            )
        }
        return [{ address: bareHost, family: ipFamily }]
    }

    try {
        const rawLookup: unknown = await dns.lookup(bareHost, { all: true })
        const records: unknown[] = Array.isArray(rawLookup)
            ? rawLookup
            : isRecord(rawLookup) && 'address' in rawLookup
              ? [rawLookup]
              : []

        if (records.length === 0) {
            throw new ConfigurationError(
                `SSRF Protection: ${subjectLabel} hostname resolved to no addresses: ${bareHost}`
            )
        }

        const resolved: ResolvedPublicAddress[] = []
        for (const rec of records) {
            if (!isRecord(rec) || !('address' in rec)) continue
            const addr = String(rec['address'])
            if (isPrivateOrLoopbackAddress(addr)) {
                throw new ConfigurationError(
                    `SSRF Protection: Requests to private/loopback network addresses are prohibited. Resolved IP: ${addr}`
                )
            }
            const rawFam = rec['family']
            const family: 4 | 6 = rawFam === 6 || addr.includes(':') ? 6 : 4
            resolved.push({ address: addr, family })
        }

        if (resolved.length === 0) {
            throw new ConfigurationError(
                `SSRF Protection: ${subjectLabel} hostname resolved to no valid addresses: ${bareHost}`
            )
        }
        return resolved
    } catch (dnsErr: unknown) {
        if (dnsErr instanceof ConfigurationError) {
            throw dnsErr
        }
        const detail = dnsErr instanceof Error ? dnsErr.message : String(dnsErr)
        throw new ConfigurationError(
            `SSRF Protection: Failed to resolve ${subjectLabel} hostname '${bareHost}': ${detail}`
        )
    }
}

/**
 * Validate a JWKS URI against protocol allowlist, explicit loopback exceptions,
 * private IP literals, and DNS-rebinding private/loopback answers.
 */
export async function assertSafeJwksUri(
    jwksUri: string
): Promise<ResolvedPublicAddress[] | undefined> {
    const jwksParsed = new URL(jwksUri)
    if (jwksParsed.username !== '' || jwksParsed.password !== '') {
        throw new ConfigurationError('SSRF Protection: JWKS URI must not include embedded credentials')
    }
    if (jwksParsed.protocol !== 'http:' && jwksParsed.protocol !== 'https:') {
        throw new ConfigurationError(
            `SSRF Protection: Disallowed JWKS URI protocol: ${jwksParsed.protocol}`
        )
    }
    const jwksHostname = jwksParsed.hostname.toLowerCase()
    const isExplicitLoopback =
        jwksHostname === 'localhost' ||
        jwksHostname === '127.0.0.1' ||
        jwksHostname === '::1' ||
        jwksHostname === '[::1]'
    if (isExplicitLoopback) return undefined

    return resolveSafePublicDnsAddresses(jwksHostname, 'JWKS')
}
