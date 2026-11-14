/**
 * Express middleware propagating per-request ALS context (`requestContextStorage`)
 * and normalized OAuth / token claims (`runWithAuthContext`).
 */

import type { RequestHandler } from 'express'
import { runWithAuthContext as propagateCtx } from '../../../auth/auth-context.js'
import type { TokenClaims } from '../../../auth/index.js'
import type { AuthRequest } from '../../../auth/middleware.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { getClientIp } from '../security.js'
import { extractSessionId } from './protocol-route-handlers.js'

export function createPropagateContextMiddleware(): RequestHandler {
    return (req: AuthRequest, _res, next) => {
        const tokenClaims = req.tokenClaims
        const authInfo = req.auth as
            | (Partial<TokenClaims> & { subject?: string; clientId?: string })
            | undefined
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
        } else if (authInfo !== undefined && authInfo !== null) {
            const sub =
                authInfo.sub ??
                (typeof authInfo.subject === 'string' ? authInfo.subject : undefined) ??
                authInfo.clientId ??
                'unknown'
            const normalizedClaims: TokenClaims = {
                ...authInfo,
                sub,
                scopes: Array.isArray(authInfo.scopes) ? authInfo.scopes : [],
                exp: typeof authInfo.exp === 'number' ? authInfo.exp : 0,
                iat: typeof authInfo.iat === 'number' ? authInfo.iat : 0,
            }
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
