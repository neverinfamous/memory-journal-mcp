import { z } from 'zod'
import * as https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { AuthorizationServerMetadata } from './types.js'
import { ConfigurationError } from '../types/errors.js'
import { createPinnedDnsLookup, type ResolvedPublicAddress } from './jwks-ssrf-guard.js'

const AuthorizationServerMetadataSchema = z
    .object({
        issuer: z.string(),
        authorization_endpoint: z.string().optional(),
        token_endpoint: z.string(),
        jwks_uri: z.string().optional(),
        registration_endpoint: z.string().optional(),
        scopes_supported: z.array(z.string()).optional(),
        response_types_supported: z.array(z.string()).optional(),
        response_modes_supported: z.array(z.string()).optional(),
        grant_types_supported: z.array(z.string()).optional(),
        token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
        token_endpoint_auth_signing_alg_values_supported: z.array(z.string()).optional(),
        service_documentation: z.string().optional(),
        ui_locales_supported: z.array(z.string()).optional(),
        op_policy_uri: z.string().optional(),
        op_tos_uri: z.string().optional(),
        revocation_endpoint: z.string().optional(),
        revocation_endpoint_auth_methods_supported: z.array(z.string()).optional(),
        introspection_endpoint: z.string().optional(),
        introspection_endpoint_auth_methods_supported: z.array(z.string()).optional(),
        code_challenge_methods_supported: z.array(z.string()).optional(),
    })
    .loose()

function readMetadataResponseBody(
    req: ReturnType<typeof https.request>,
    res: IncomingMessage,
    safeResolve: (value: AuthorizationServerMetadata) => void,
    safeReject: (reason: unknown) => void
): void {
    res.on('error', safeReject)
    if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
        req.destroy()
        safeReject(
            new ConfigurationError(
                `HTTP ${String(res.statusCode ?? 'unknown')}: ${res.statusMessage || ''}`
            )
        )
        return
    }
    const chunks: Buffer[] = []
    let totalBytes = 0
    const maxBytes = 1024 * 1024
    res.on('data', (d: Buffer) => {
        totalBytes += d.length
        if (totalBytes > maxBytes) {
            req.destroy()
            safeReject(
                new ConfigurationError('Authorization server metadata response exceeded 1MB limit')
            )
            return
        }
        chunks.push(d)
    })
    res.on('end', () => {
        let rawJson: unknown
        try {
            rawJson = JSON.parse(Buffer.concat(chunks).toString())
        } catch {
            safeReject(new ConfigurationError('Invalid JSON response'))
            return
        }
        const parsed = AuthorizationServerMetadataSchema.safeParse(rawJson)
        if (!parsed.success) {
            safeReject(new ConfigurationError('Invalid authorization server metadata'))
            return
        }
        safeResolve(parsed.data)
    })
}

/**
 * Fetches RFC 8414 metadata over DNS-pinned HTTPS with a 1MB body cap and
 * both socket-idle and total wall-clock deadline timeouts.
 */
export function fetchDiscoveryMetadata(
    metadataUrl: string,
    hostHeader: string,
    resolvedRecords: readonly ResolvedPublicAddress[],
    timeoutMs: number
): Promise<AuthorizationServerMetadata> {
    const primary = resolvedRecords[0]
    if (primary === undefined) {
        return Promise.reject(
            new ConfigurationError('No validated DNS addresses available for discovery')
        )
    }
    return new Promise<AuthorizationServerMetadata>((resolve, reject) => {
        let settled = false
        let deadlineTimer: NodeJS.Timeout | undefined
        const clearDeadline = (): void => {
            if (deadlineTimer !== undefined) {
                clearTimeout(deadlineTimer)
                deadlineTimer = undefined
            }
        }
        const safeResolve = (value: AuthorizationServerMetadata): void => {
            if (settled) return
            settled = true
            clearDeadline()
            resolve(value)
        }
        const safeReject = (reason: unknown): void => {
            if (settled) return
            settled = true
            clearDeadline()
            reject(reason instanceof Error ? reason : new Error(String(reason)))
        }

        const req = https.request(
            metadataUrl,
            {
                method: 'GET',
                headers: { Accept: 'application/json', Host: hostHeader },
                lookup: createPinnedDnsLookup(primary, resolvedRecords),
                timeout: timeoutMs,
            },
            (res) => {
                readMetadataResponseBody(req, res, safeResolve, safeReject)
            }
        )
        deadlineTimer = setTimeout(() => {
            req.destroy()
            safeReject(new Error('Request timeout'))
        }, timeoutMs)
        deadlineTimer.unref()
        req.on('error', safeReject)
        req.on('timeout', () => {
            req.destroy()
            safeReject(new Error('Request timeout'))
        })
        req.end()
    })
}
