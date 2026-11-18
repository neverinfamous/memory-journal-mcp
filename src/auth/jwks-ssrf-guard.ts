/**
 * memory-journal-mcp — SSRF & DNS Lookup Guards for OAuth / JWKS Endpoints
 */

import { isIP } from 'node:net'
import { promises as dns } from 'node:dns'
import { ConfigurationError } from '../types/errors.js'
import { isPrivateOrLoopbackAddress } from '../utils/network-safety.js'

export interface ResolvedPublicAddress {
    address: string
    family: 4 | 6
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
        const records = Array.isArray(rawLookup)
            ? rawLookup
            : rawLookup !== null && typeof rawLookup === 'object' && 'address' in rawLookup
              ? [rawLookup]
              : []

        if (records.length === 0) {
            throw new ConfigurationError(
                `SSRF Protection: ${subjectLabel} hostname resolved to no addresses: ${bareHost}`
            )
        }

        const resolved: ResolvedPublicAddress[] = []
        for (const rec of records) {
            if (rec === null || typeof rec !== 'object' || !('address' in rec)) continue
            const addr = String((rec as { address: unknown }).address)
            if (isPrivateOrLoopbackAddress(addr)) {
                throw new ConfigurationError(
                    `SSRF Protection: Requests to private/loopback network addresses are prohibited. Resolved IP: ${addr}`
                )
            }
            const rawFam =
                'family' in rec ? (rec as { family?: unknown }).family : undefined
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
