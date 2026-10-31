import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
    ip?: string | undefined
    sessionId?: string | undefined
    useTestDb?: boolean | undefined
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
    return requestContextStorage.getStore()
}
