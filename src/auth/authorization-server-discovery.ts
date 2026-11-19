/**
 * memory-journal-mcp — Authorization Server Discovery (RFC 8414)
 *
 * Discovers and caches OAuth 2.0 Authorization Server Metadata
 * as specified in RFC 8414.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */

import { z } from 'zod'
import type { AuthorizationServerMetadata, AuthServerDiscoveryConfig } from './types.js'
import { AuthServerDiscoveryError } from './errors.js'
import { ConfigurationError } from '../types/errors.js'
import { logger } from '../utils/logger.js'
import {
    resolveSafePublicDnsAddresses,
    type ResolvedPublicAddress,
} from './jwks-ssrf-guard.js'
import { isPrivateOrLoopbackAddress } from '../utils/network-safety.js'
import * as https from 'node:https'
import type { IncomingMessage } from 'node:http'

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

function parseDiscoveryUrl(metadataUrl: string): URL {
    let parsedUrl: URL
    try {
        parsedUrl = new URL(metadataUrl)
    } catch {
        throw new ConfigurationError(`Invalid authorization server URL: ${metadataUrl}`)
    }
    if (parsedUrl.protocol !== 'https:') {
        throw new ConfigurationError(`Authorization server URL must use HTTPS: ${metadataUrl}`)
    }
    return parsedUrl
}

function readMetadataResponseBody(
    req: ReturnType<typeof https.request>,
    res: IncomingMessage,
    safeResolve: (value: AuthorizationServerMetadata) => void,
    safeReject: (reason: unknown) => void
): void {
    if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
        if ('resume' in res && typeof res.resume === 'function') {
            res.resume()
        }
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
    res.on('error', safeReject)
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

function fetchDiscoveryMetadata(
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
        const safeResolve = (value: AuthorizationServerMetadata): void => {
            if (settled) return
            settled = true
            resolve(value)
        }
        const safeReject = (reason: unknown): void => {
            if (settled) return
            settled = true
            reject(reason instanceof Error ? reason : new Error(String(reason)))
        }

        const req = https.request(
            metadataUrl,
            {
                method: 'GET',
                headers: { Accept: 'application/json', Host: hostHeader },
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
                timeout: timeoutMs,
            },
            (res) => {
                readMetadataResponseBody(req, res, safeResolve, safeReject)
            }
        )
        req.on('error', safeReject)
        req.on('timeout', () => {
            req.destroy()
            safeReject(new Error('Request timeout'))
        })
        req.end()
    })
}

// =============================================================================
// Authorization Server Discovery
// =============================================================================

/**
 * Authorization Server Metadata Discovery
 *
 * Fetches and caches OAuth 2.0 authorization server metadata
 * from the /.well-known/oauth-authorization-server endpoint.
 */
export class AuthorizationServerDiscovery {
    private readonly authServerUrl: string
    private readonly cacheTtl: number
    private readonly timeout: number

    private cachedMetadata: AuthorizationServerMetadata | null = null
    private cacheExpiry = 0

    constructor(config: AuthServerDiscoveryConfig) {
        // Normalize URL (remove trailing slash)
        this.authServerUrl = config.authServerUrl.replace(/\/+$/, '')
        this.cacheTtl = config.cacheTtl ?? 3600
        this.timeout = config.timeout ?? 5000

        logger.info(`Authorization Server Discovery initialized for: ${this.authServerUrl}`, {
            module: 'AUTH',
            operation: 'init',
        })
    }

    /**
     * Discover authorization server metadata
     *
     * Fetches from /.well-known/oauth-authorization-server
     * Results are cached for cacheTtl seconds.
     *
     * @returns Authorization server metadata
     * @throws AuthServerDiscoveryError if discovery fails
     */
    async discover(): Promise<AuthorizationServerMetadata> {
        if (this.cachedMetadata && Date.now() < this.cacheExpiry) {
            logger.info('Using cached authorization server metadata', {
                module: 'AUTH',
                operation: 'cache-hit',
            })
            return this.cachedMetadata
        }

        const metadataUrl = `${this.authServerUrl}/.well-known/oauth-authorization-server`
        const parsedUrl = parseDiscoveryUrl(metadataUrl)
        const resolvedRecords = await resolveSafePublicDnsAddresses(
            parsedUrl.hostname.toLowerCase(),
            'authorization server'
        )

        logger.info(`Fetching authorization server metadata from: ${metadataUrl}`, {
            module: 'AUTH',
            operation: 'discovery',
        })

        try {
            const metadata = await fetchDiscoveryMetadata(
                metadataUrl,
                parsedUrl.host,
                resolvedRecords,
                this.timeout
            )
            this.validateMetadata(metadata)
            this.cachedMetadata = metadata
            this.cacheExpiry = Date.now() + this.cacheTtl * 1000

            logger.info(`Authorization server metadata cached for ${String(this.cacheTtl)}s`, {
                module: 'AUTH',
                operation: 'discovery-success',
            })

            return metadata
        } catch (error) {
            if (error instanceof AuthServerDiscoveryError) {
                throw error
            }
            const cause = error instanceof Error ? error : new Error(String(error))
            logger.error(`Failed to discover authorization server: ${this.authServerUrl}`, {
                module: 'AUTH',
                operation: 'discovery',
                error: cause.message,
            })
            throw new AuthServerDiscoveryError(this.authServerUrl, cause)
        }
    }

    /**
     * Validate required metadata fields per RFC 8414
     */
    private assertSafeHttpsMetadataEndpoint(rawUrl: string, fieldName: string): void {
        let parsed: URL
        try {
            parsed = new URL(rawUrl)
        } catch {
            throw new ConfigurationError(`Invalid ${fieldName} URL in authorization server metadata`)
        }
        if (parsed.protocol !== 'https:') {
            throw new ConfigurationError(`Metadata field '${fieldName}' must use https:`)
        }
        if (parsed.username !== '' || parsed.password !== '') {
            throw new ConfigurationError(`Metadata field '${fieldName}' must not contain credentials`)
        }
        const normalizedHost = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
        if (
            normalizedHost === '' ||
            normalizedHost === 'localhost' ||
            normalizedHost.endsWith('.localhost') ||
            normalizedHost.endsWith('.local') ||
            normalizedHost.endsWith('.internal') ||
            isPrivateOrLoopbackAddress(normalizedHost)
        ) {
            throw new ConfigurationError(
                `Metadata field '${fieldName}' resolves to restricted network address: ${normalizedHost}`
            )
        }
    }

    private validateMetadata(metadata: AuthorizationServerMetadata): void {
        if (!metadata.issuer) {
            throw new ConfigurationError('Missing required field: issuer')
        }

        if (!metadata.token_endpoint) {
            throw new ConfigurationError('Missing required field: token_endpoint')
        }

        this.assertSafeHttpsMetadataEndpoint(metadata.issuer, 'issuer')
        this.assertSafeHttpsMetadataEndpoint(metadata.token_endpoint, 'token_endpoint')
        const optionalUrls: [string, string | undefined][] = [
            ['authorization_endpoint', metadata.authorization_endpoint],
            ['jwks_uri', metadata.jwks_uri],
            ['registration_endpoint', metadata.registration_endpoint],
            ['revocation_endpoint', metadata.revocation_endpoint],
            ['introspection_endpoint', metadata.introspection_endpoint],
        ]
        for (const [field, urlVal] of optionalUrls) {
            if (urlVal !== undefined) {
                this.assertSafeHttpsMetadataEndpoint(urlVal, field)
            }
        }

        // Validate issuer matches the expected URL
        // Per RFC 8414 §3.3, issuer MUST be identical to the authorization server URL
        const expectedIssuer = this.authServerUrl
        const actualIssuer = metadata.issuer.replace(/\/+$/, '')
        if (actualIssuer !== expectedIssuer) {
            throw new ConfigurationError(
                `Authorization server issuer mismatch: expected ${expectedIssuer}, got ${metadata.issuer}`
            )
        }
    }

    /**
     * Get cached metadata (throws if not discovered)
     */
    getMetadata(): AuthorizationServerMetadata {
        if (!this.cachedMetadata) {
            throw new ConfigurationError(
                'Authorization server metadata not yet discovered. Call discover() first.'
            )
        }
        return this.cachedMetadata
    }

    /**
     * Get JWKS URI from metadata
     *
     * @throws Error if metadata not discovered or jwks_uri not present
     */
    getJwksUri(): string {
        const metadata = this.getMetadata()

        if (!metadata.jwks_uri) {
            throw new ConfigurationError('Authorization server does not provide jwks_uri')
        }

        return metadata.jwks_uri
    }

    /**
     * Get token endpoint from metadata
     */
    getTokenEndpoint(): string {
        return this.getMetadata().token_endpoint
    }

    /**
     * Get issuer from metadata
     */
    getIssuer(): string {
        return this.getMetadata().issuer
    }

    /**
     * Get registration endpoint from metadata (RFC 7591)
     *
     * @returns Registration endpoint or null if not supported
     */
    getRegistrationEndpoint(): string | null {
        return this.getMetadata().registration_endpoint ?? null
    }

    /**
     * Check if dynamic client registration is supported
     */
    supportsClientRegistration(): boolean {
        return this.getRegistrationEndpoint() !== null
    }

    /**
     * Get supported scopes from metadata
     */
    getSupportedScopes(): string[] {
        return this.getMetadata().scopes_supported ?? []
    }

    /**
     * Check if a specific scope is supported
     */
    isScopeSupported(scope: string): boolean {
        const supportedScopes = this.getSupportedScopes()
        // If no scopes are listed, assume all scopes are supported
        return supportedScopes.length === 0 || supportedScopes.includes(scope)
    }

    /**
     * Clear cached metadata
     */
    clearCache(): void {
        this.cachedMetadata = null
        this.cacheExpiry = 0
        logger.info('Authorization server metadata cache cleared', {
            module: 'AUTH',
            operation: 'cache-clear',
        })
    }

    /**
     * Check if cache is valid
     */
    isCacheValid(): boolean {
        return this.cachedMetadata !== null && Date.now() < this.cacheExpiry
    }

    /**
     * Get the authorization server URL
     */
    getAuthServerUrl(): string {
        return this.authServerUrl
    }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an Authorization Server Discovery instance
 */
export function createAuthServerDiscovery(
    authServerUrl: string,
    options?: Partial<Omit<AuthServerDiscoveryConfig, 'authServerUrl'>>
): AuthorizationServerDiscovery {
    return new AuthorizationServerDiscovery({
        authServerUrl,
        cacheTtl: options?.cacheTtl,
        timeout: options?.timeout,
    })
}
