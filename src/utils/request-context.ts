import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
    ip?: string
    sessionId?: string
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
    return requestContextStorage.getStore()
}
