/**
 * memory-journal-mcp — Auth Context (AsyncLocalStorage)
 *
 * Provides per-request authentication context threading using Node.js
 * AsyncLocalStorage. Allows the HTTP transport to store the validated
 * auth context so that tool handlers can enforce per-tool scopes
 * without direct parameter coupling through the MCP SDK layer.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthenticatedContext } from './middleware.js'

/**
 * Singleton AsyncLocalStorage instance for auth context.
 * Each HTTP request runs within its own async context.
 */
const authContextStorage = new AsyncLocalStorage<AuthenticatedContext>()

/**
 * Run a function within an authenticated context.
 * Called by the HTTP transport after token validation.
 *
 * @param context - The validated auth context from middleware
 * @param fn - The async function to run (MCP SDK request handling)
 * @returns The result of the wrapped function
 */
export function runWithAuthContext<T>(context: AuthenticatedContext, fn: () => T): T {
    return authContextStorage.run(context, fn)
}

/**
 * Get the current request's auth context.
 * Returns undefined when:
 * - OAuth is not configured (stdio transport, no auth)
 * - Called outside of an HTTP request context
 *
 * Tool handlers use this to enforce per-tool scope checks.
 */
export function getAuthContext(): AuthenticatedContext | undefined {
    return authContextStorage.getStore()
}
