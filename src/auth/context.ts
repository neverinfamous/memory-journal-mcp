import { AsyncLocalStorage } from 'node:async_hooks'

export interface AuthContextPayload {
    sub?: string
    scopes: string[]
}

export const authStorage = new AsyncLocalStorage<AuthContextPayload>()
