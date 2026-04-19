/**
 * Code Mode Tool Group - 1 tool
 *
 * Tools: mj_execute_code
 *
 * Sandboxed JavaScript execution enabling multi-step journal operations
 * in a single tool call. Exposes all tool groups as `mj.*` API.
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { relaxedNumber } from './schemas.js'
import { ConfigurationError } from '../../types/errors.js'
import { createJournalApi } from '../../codemode/api.js'
import { CodeModeSecurityManager } from '../../codemode/security.js'
import { createSandboxPool, type ISandboxPool } from '../../codemode/sandbox-factory.js'
import { getRequestContext } from '../../utils/request-context.js'
import { getAuthContext, getAuthenticatedScopes } from '../../auth/auth-context.js'
import { getCoreTools } from './core.js'
import { getSearchTools } from './search/index.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getIoTools } from './io.js'
import { getAdminTools } from './admin.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'
import { getTeamTools } from './team/index.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'


// =============================================================================
// Input / Output Schemas
// =============================================================================

const ExecuteCodeSchema = z.object({
    code: z.string().min(1),
    timeout: z.number().max(30000).optional().default(30000),
    readonly: z.boolean().optional().default(false),
    repo: z.string().optional(),
})

/** Relaxed schema for MCP registration */
const ExecuteCodeSchemaMcp = z.object({
    code: z.string().describe('JavaScript code to execute in the sandbox'),
    timeout: relaxedNumber()
        .optional()
        .default(30000)
        .describe('Execution timeout in ms (max 30000)'),
    readonly: z.boolean().optional().default(false).describe('Restrict to read-only operations'),
    repo: z
        .string()
        .optional()
        .describe(
            'Target repository name to set as default context for all github/kanban tools executed in this sandbox (e.g., "memory-journal-mcp").'
        ),
})

// No outputSchema — Code Mode returns dynamic result types (z.unknown()) which
// produces a bare {} JSON Schema. Clients that process structuredContent crash
// when iterating properties of {}. Using the plain text JSON response path instead.

// =============================================================================
// Singleton State
// =============================================================================

interface CacheEntry<T> {
    instance: T
    lastAccessed: number
}

const securityManagerMap = new Map<string, CacheEntry<CodeModeSecurityManager>>()
const sandboxPoolMap = new Map<string, CacheEntry<ISandboxPool>>()

const TTL_MS = 10 * 60 * 1000 // 10 minute eviction
let lastSweepTime = Date.now()

function sweepCaches(): void {
    const now = Date.now()
    if (now - lastSweepTime < 1 * 60 * 1000) return // Sweep at most every 1 min
    lastSweepTime = now

    for (const [id, entry] of securityManagerMap.entries()) {
        if (now - entry.lastAccessed > TTL_MS) {
            entry.instance.dispose()
            securityManagerMap.delete(id)
        }
    }
    for (const [id, entry] of sandboxPoolMap.entries()) {
        if (now - entry.lastAccessed > TTL_MS) {
            entry.instance.dispose()
            sandboxPoolMap.delete(id)
        }
    }
}

const MAX_SANDBOX_POOLS = 50

function evictExcessCaches(): void {
    while (sandboxPoolMap.size >= MAX_SANDBOX_POOLS) {
        const oldestId = sandboxPoolMap.keys().next().value
        if (oldestId !== undefined) {
            sandboxPoolMap.get(oldestId)?.instance.dispose()
            sandboxPoolMap.delete(oldestId)
        }
    }

    while (securityManagerMap.size >= MAX_SANDBOX_POOLS) {
        const oldestId = securityManagerMap.keys().next().value
        if (oldestId !== undefined) {
            securityManagerMap.get(oldestId)?.instance.dispose()
            securityManagerMap.delete(oldestId)
        }
    }
}

function getSecurityManager(clientId: string): CodeModeSecurityManager {
    sweepCaches()
    let entry = securityManagerMap.get(clientId)
    if (!entry) {
        evictExcessCaches()
        const envMaxSize = process.env['CODE_MODE_MAX_RESULT_SIZE']
        const parsedMaxSize =
            envMaxSize && /^\d+$/.test(envMaxSize) ? parseInt(envMaxSize, 10) : undefined
        const overrides =
            parsedMaxSize !== undefined &&
            Number.isFinite(parsedMaxSize) &&
            Number.isInteger(parsedMaxSize) &&
            parsedMaxSize > 0
                ? { maxResultSize: parsedMaxSize }
                : undefined
        
        entry = {
            instance: new CodeModeSecurityManager(overrides),
            lastAccessed: Date.now()
        }
        securityManagerMap.set(clientId, entry)
    } else {
        entry.lastAccessed = Date.now()
        securityManagerMap.delete(clientId)
        securityManagerMap.set(clientId, entry)
    }
    return entry.instance
}

function getSandboxPool(clientId: string): ISandboxPool {
    sweepCaches()
    let entry = sandboxPoolMap.get(clientId)
    if (!entry) {
        evictExcessCaches()
        entry = {
            instance: createSandboxPool(),
            lastAccessed: Date.now()
        }
        sandboxPoolMap.set(clientId, entry)
    } else {
        entry.lastAccessed = Date.now()
        sandboxPoolMap.delete(clientId)
        sandboxPoolMap.set(clientId, entry)
    }
    return entry.instance
}

// =============================================================================
// Helper: Collect Non-CodeMode Tools (cached)
// =============================================================================

/**
 * Cached non-codemode tool list. Invalidates when context identity changes
 * (same approach as toolMapCache in handlers/tools/index.ts).
 */
let cachedNonCodeModeTools: ToolDefinition[] | null = null
let cachedCodeModeContext: ToolContext | null = null

/**
 * Collect all tool definitions except codemode (prevents recursion).
 * Results are cached by referential identity of the ToolContext.
 *
 * SEC-1.2: Filters by context.config.filterConfig so the operator's active
 * --tool-filter restrictions are honoured inside the Code Mode sandbox.
 */
function collectNonCodeModeTools(context: ToolContext): ToolDefinition[] {
    if (cachedNonCodeModeTools && cachedCodeModeContext === context) {
        return cachedNonCodeModeTools
    }

    const allTools = [
        ...getCoreTools(context),
        ...getSearchTools(context),
        ...getAnalyticsTools(context),
        ...getRelationshipTools(context),
        ...getIoTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
    ]

    // SEC-1.2: Respect active tool filter — Code Mode must not reach tools that the
    // operator has explicitly excluded. Strict enforcement.
    //
    // Exception: if the ONLY enabled tool is mj_execute_code (codemode-only preset),
    // the filter intentionally reduces the external surface — Code Mode itself still
    // needs full internal access to be useful. Applying the filter in that case would
    // leave Code Mode with zero tools, breaking the preset's intended behaviour.
    const filterConfig = context.config?.filterConfig
    const hasNonCodeModeEnabled = filterConfig
        ? [...filterConfig.enabledTools].some((t) => t !== 'mj_execute_code')
        : true

    cachedNonCodeModeTools = filterConfig && hasNonCodeModeEnabled
        ? allTools.filter((t) => filterConfig.enabledTools.has(t.name))
        : allTools

    cachedCodeModeContext = context
    return cachedNonCodeModeTools
}

// =============================================================================
// Tool Definitions & Access Control
// =============================================================================




export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute Code (Code Mode)',
            description:
                '🛑 TRUSTED ADMIN ONLY: Execute JavaScript in a Privileged sandboxed environment with access to all journal tools via the `mj.*` API. ' +
                'Enables multi-step workflows in a single call, reducing token usage by 70-90%. ' +
                'API groups: mj.core.*, mj.search.*, mj.analytics.*, mj.relationships.*, ' +
                'mj.io.*, mj.admin.*, mj.github.*, mj.backup.*, mj.team.*. ' +
                'Use mj.help() for method listing. Returns the last expression value.',
            group: 'codemode',
            inputSchema: ExecuteCodeSchemaMcp,
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    const {
                        code,
                        timeout,
                        readonly: readonlyMode,
                        repo,
                    } = ExecuteCodeSchema.parse(params)

                    // Context extraction for rate limiting and tenant isolation
                    const reqCtx = getRequestContext()
                    const authCtx = getAuthContext()
                    const clientId = authCtx?.claims?.sub || reqCtx?.sessionId || reqCtx?.ip || 'stdio-client'

                    if (context.config?.authToken || context.config?.oauthEnabled) {
                        if (!authCtx?.authenticated) {
                            return {
                                success: false,
                                error: 'Permission Denied: Code Mode requires authentication.',
                            }
                        }
                        const scopes = getAuthenticatedScopes()
                        if (!scopes.includes('admin')) {
                            return {
                                success: false,
                                error: 'Permission Denied: Code Mode is a privileged admin-only capability. Your token lacks the required "admin" scope.',
                            }
                        }
                    }

                    // Security validation
                    const security = getSecurityManager(clientId)
                    const validation = security.validateCode(code)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join('; ')}`,
                        }
                    }

                    // Rate limiting
                    if (!security.checkRateLimit(clientId)) {
                        return {
                            success: false,
                            error: 'Rate limit exceeded (60 executions per minute)',
                        }
                    }

                    // Context injection for GitHub / Kanban routing
                    let sessionContext = context
                    if (repo && context.config?.projectRegistry && Object.prototype.hasOwnProperty.call(context.config.projectRegistry, repo)) {
                        const registryEntry = context.config.projectRegistry[repo]
                        if (registryEntry) {
                            const injectedGithub = getGitHubIntegration(registryEntry.path, sessionContext.config?.runtime)
                            try {
                                // Pre-populate cache so synchronous tools (like create_entry) can resolve Issue URLs
                                await injectedGithub.getRepoInfo()
                            } catch (error) {
                                return {
                                    success: false,
                                    error: `Failed to initialize injected repository '${repo}': ${error instanceof Error ? error.message : String(error)}`,
                                }
                            }
                            sessionContext = {
                                ...context,
                                github: injectedGithub,
                                config: {
                                    ...context.config,
                                    defaultProjectNumber:
                                        registryEntry.project_number ??
                                        context.config.defaultProjectNumber,
                                },
                            }
                        }
                    }

                    // Build tool list (excluding codemode to prevent recursion)
                    const allTools = collectNonCodeModeTools(sessionContext)

                    // Filter out write operations if readonly mode using ACL
                    const tools = readonlyMode
                        ? allTools.filter((t) => t.annotations?.readOnlyHint === true)
                        : allTools

                    // SEC-1.1: Build the API bridge using the callTool()-backed dispatcher
                    // when available. This ensures scope checks, maintenance-mode guards,
                    // and audit interception apply to all inner tool calls.
                    const dispatcher = sessionContext.config?.dispatch
                    if (!dispatcher) {
                        throw new ConfigurationError('Code Mode requires a secure dispatcher to ensure scope checks and audit interception.')
                    }
                    const api = createJournalApi(tools, dispatcher)
                    const bindings = api.createSandboxBindings()

                    // Execute in sandbox (override timeout if specified)
                    const pool = getSandboxPool(clientId)

                    // For VM sandbox, the bindings are passed directly
                    // For Worker sandbox, the bindings need to be the group API records
                    const result = await pool.execute(code, bindings, timeout)
                    // Validate result size
                    if (result.success && result.result !== undefined) {
                        const sizeCheck = security.validateResultSize(result.result)
                        if (!sizeCheck.valid) {
                            return {
                                success: false,
                                error: sizeCheck.errors.join('; '),
                                metrics: result.metrics,
                            }
                        }
                    }
                    return result
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
