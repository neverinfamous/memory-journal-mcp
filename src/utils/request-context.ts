import { AsyncLocalStorage } from 'node:async_hooks'
import type { ProgressContext } from './progress-utils.js'

export interface RequestContext {
    ip?: string | undefined
    sessionId?: string | undefined
    useTestDb?: boolean | undefined
    progress?: ProgressContext | undefined
    ephemeralSessionProject?: { workspaceId?: string; projectNumber?: number } | undefined
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
    return requestContextStorage.getStore()
}
