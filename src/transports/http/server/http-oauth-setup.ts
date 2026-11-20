import type { Express } from 'express'
import { logger } from '../../../utils/logger.js'
import type { HttpTransportConfig } from '../types.js'
import { formatHostForUrl, isLoopbackHost, validateOAuthTransportConfig } from '../security.js'
import { createAuthMiddleware as createStaticBearerMiddleware } from '../handlers.js'
import {
    createTokenValidator,
    createOAuthResourceServer,
    createAuthMiddleware as createOAuthMiddleware,
    SUPPORTED_SCOPES,
} from '../../../auth/index.js'
import { AuthServerDiscoveryError } from '../../../auth/errors.js'
import { ConfigurationError } from '../../../types/errors.js'
import { AuthorizationServerDiscovery } from '../../../auth/authorization-server-discovery.js'

/**
 * Resolve jwks_uri via RFC 8414 discovery, falling back to the conventional path only
 * on HTTP 404 (or explicit plaintext loopback).
 */
export async function discoverJwksUri(
    issuer: string,
    allowPlaintextLoopbackOAuth: boolean | undefined
): Promise<string> {
    const fallback = `${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`
    if (allowPlaintextLoopbackOAuth === true) {
        try {
            const parsed = new URL(issuer)
            if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
                return fallback
            }
        } catch {
            // Fall through to discovery for normal error reporting
        }
    }
    try {
        const discovery = new AuthorizationServerDiscovery({ authServerUrl: issuer })
        await discovery.discover()
        return discovery.getJwksUri()
    } catch (error) {
        if (error instanceof ConfigurationError) {
            throw error
        }
        const cause =
            error instanceof AuthServerDiscoveryError
                ? error.details?.['cause']
                : undefined
        const isNotFound = typeof cause === 'string' && /^HTTP 404(?::|\b)/.test(cause)
        if (!isNotFound) {
            throw error
        }
        logger.warning(
            'Authorization server metadata endpoint returned 404; using default JWKS path',
            {
                module: 'HTTP',
                operation: 'oauth-discovery',
                error: error instanceof Error ? error.message : String(error),
            }
        )
        return fallback
    }
}

/**
 * Validate OAuth configuration and install OAuth or static bearer-token authentication.
 * Returns `true` when OAuth 2.1 middleware was installed (so error middleware can mount after routes).
 */
export async function installHttpAuthentication(
    app: Express,
    config: HttpTransportConfig,
    host: string,
    port: number,
    authToken: string | undefined,
    isLocalhost: boolean
): Promise<boolean> {
    const oauthConfig = validateOAuthTransportConfig(
        config,
        host,
        isLocalhost,
        (msg, meta) => {
            logger.error(msg, meta)
        }
    )

    if (oauthConfig !== null) {
        const { oauthIssuer, oauthAudience } = oauthConfig
        const jwksUri =
            config.oauthJwksUri ??
            (await discoverJwksUri(oauthIssuer, config.allowPlaintextLoopbackOAuth))

        const tokenValidator = createTokenValidator({
            jwksUri,
            issuer: oauthIssuer,
            audience: oauthAudience,
            clockTolerance: config.oauthClockTolerance ?? 60,
        })

        await tokenValidator.preload()

        const trimmedPublicOrigin = config.publicOrigin?.trim()
        const resourceServer = createOAuthResourceServer({
            resource:
                trimmedPublicOrigin !== undefined && trimmedPublicOrigin !== ''
                    ? trimmedPublicOrigin
                    : `http://${formatHostForUrl(host)}:${String(port)}`,
            authorizationServers: [oauthIssuer],
            scopesSupported: [...SUPPORTED_SCOPES],
        })

        app.get(resourceServer.getWellKnownPath(), resourceServer.getMetadataHandler())

        app.use(
            createOAuthMiddleware({
                tokenValidator,
                resourceServer,
                publicPaths: ['/health'],
            })
        )

        logger.info('OAuth 2.1 authentication enabled', {
            module: 'HTTP',
            resource: resourceServer.getResourceUri(),
            audience: oauthAudience,
        })
        return true
    }

    if (authToken !== undefined && authToken !== '') {
        app.use(createStaticBearerMiddleware(authToken))
    }
    return false
}
