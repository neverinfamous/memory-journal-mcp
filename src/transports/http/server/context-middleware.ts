/**
 * Express middleware propagating per-request ALS context (`requestContextStorage`)
 * and normalized OAuth / token claims (`runWithAuthContext`).
 */

import type { RequestHandler } from 'express'
import { runWithAuthContext as propagateCtx } from '../../../auth/auth-context.js'
import type { TokenClaims } from '../../../auth/index.js'
import type { AuthRequest } from '../../../auth/middleware.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { isRecord } from '../../../utils/type-guards.js'
import { getClientIp } from '../security.js'
import { extractSessionId } from './protocol-route-handlers.js'

const RESERVED_CLAIM_KEYS = new Set([
    'sub',
    'scopes',
    'exp',
    'iat',
    'iss',
    'aud',
    'nbf',
    'jti',
    'client_id',
    '__proto__',
    'constructor',
    'prototype',
])

function extractNormalizedAuthClaims(rawAuth: Record<string, unknown>): TokenClaims {
    const sub =
        (typeof rawAuth['sub'] === 'string' ? rawAuth['sub'] : undefined) ??
        (typeof rawAuth['subject'] === 'string' ? rawAuth['subject'] : undefined) ??
        (typeof rawAuth['clientId'] === 'string' ? rawAuth['clientId'] : undefined) ??
        'unknown'
    const rawScopes = rawAuth['scopes']
    const scopes = Array.isArray(rawScopes)
        ? rawScopes.filter((s): s is string => typeof s === 'string')
        : []
    const rawAud = rawAuth['aud']
    const validAud =
        typeof rawAud === 'string' ||
        (Array.isArray(rawAud) && rawAud.every((a): a is string => typeof a === 'string'))
            ? rawAud
            : undefined

    const claims: TokenClaims = {
        sub,
        scopes,
        exp: typeof rawAuth['exp'] === 'number' ? rawAuth['exp'] : 0,
        iat: typeof rawAuth['iat'] === 'number' ? rawAuth['iat'] : 0,
        ...(typeof rawAuth['iss'] === 'string' ? { iss: rawAuth['iss'] } : {}),
        ...(validAud !== undefined ? { aud: validAud } : {}),
        ...(typeof rawAuth['nbf'] === 'number' ? { nbf: rawAuth['nbf'] } : {}),
        ...(typeof rawAuth['jti'] === 'string' ? { jti: rawAuth['jti'] } : {}),
        ...(typeof rawAuth['client_id'] === 'string' ? { client_id: rawAuth['client_id'] } : {}),
    }
    for (const [k, v] of Object.entries(rawAuth)) {
        if (!RESERVED_CLAIM_KEYS.has(k)) {
            claims[k] = v
        }
    }
    return claims
}

export function createPropagateContextMiddleware(): RequestHandler {
    return (req: AuthRequest, _res, next) => {
        const tokenClaims = req.tokenClaims
        const rawAuth: unknown = req.auth
        const sessionId = extractSessionId(req)
        const ip = getClientIp(req)
        const runWithReqCtx = (fn: () => void): void => {
            const existing = getRequestContext()
            requestContextStorage.run(
                {
                    ...existing,
                    ip,
                    ...(sessionId !== undefined && sessionId !== '' ? { sessionId } : {}),
                },
                fn
            )
        }

        if (tokenClaims !== undefined && tokenClaims !== null) {
            runWithReqCtx(() =>
                propagateCtx(
                    { authenticated: true, claims: tokenClaims, scopes: tokenClaims.scopes },
                    next
                )
            )
        } else if (isRecord(rawAuth)) {
            const normalizedClaims = extractNormalizedAuthClaims(rawAuth)
            runWithReqCtx(() =>
                propagateCtx(
                    {
                        authenticated: true,
                        claims: normalizedClaims,
                        scopes: normalizedClaims.scopes,
                    },
                    next
                )
            )
        } else {
            runWithReqCtx(next)
        }
    }
}
