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
import { createJournalApi } from '../../codemode/api.js'
import { CodeModeSecurityManager } from '../../codemode/security.js'
import { createSandboxPool, type ISandboxPool } from '../../codemode/sandbox-factory.js'
import { getRequestContext } from '../../utils/request-context.js'
import { getAuthContext } from '../../auth/auth-context.js'
import { getCoreTools } from './core.js'
import { getSearchTools } from './search/index.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getIoTools } from './io.js'
import { getAdminTools } from './admin.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'
import { getTeamTools } from './team/index.js'
import { GitHubIntegration } from '../../github/github-integration/index.js'

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

let securityManager: CodeModeSecurityManager | null = null
let sandboxPool: ISandboxPool | null = null

function getSecurityManager(): CodeModeSecurityManager {
    if (!securityManager) {
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
        securityManager = new CodeModeSecurityManager(overrides)
    }
    return securityManager
}

function getSandboxPool(): ISandboxPool {
    sandboxPool ??= createSandboxPool()
    return sandboxPool
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
 */
function collectNonCodeModeTools(context: ToolContext): ToolDefinition[] {
    if (cachedNonCodeModeTools && cachedCodeModeContext === context) {
        return cachedNonCodeModeTools
    }

    cachedNonCodeModeTools = [
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
    cachedCodeModeContext = context
    return cachedNonCodeModeTools
}

// =============================================================================
// Tool Definitions & Access Control
// =============================================================================

/** Hardcoded Capability Access Control List for Safe (Read-Only) Code Mode execution */
const SAFE_READ_TOOLS = new Set([
    'get_recent_entries',
    'get_entry_by_id',
    'get_statistics',
    'search_entries',
    'search_by_date_range',
    'semantic_search',
    'suggest_tags',
    'get_cross_project_insights',
    'get_causal_chain',
    'get_entry_relationships',
    'list_tags',
    'export_entries',
    'read_resource',
    'gh_get_repo_info',
    'gh_search_issues',
    'gh_get_issue',
    'gh_get_pull_request',
    'gh_get_workflow_runs',
    'gh_verify_gh_auth',
    'team_get_recent_entries',
    'team_get_entry_by_id',
    'team_get_statistics',
    'team_search_entries',
    'team_search_by_date_range',
    'team_semantic_search',
    'team_suggest_tags',
    'team_get_causal_chain',
    'team_get_entry_relationships',
    'team_list_tags',
    'team_read_resource',
    'team_get_user_status',
])

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute Code (Code Mode)',
            description:
                'Execute JavaScript in a sandboxed environment with access to all journal tools via the `mj.*` API. ' +
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

                    // Security validation
                    const security = getSecurityManager()
                    const validation = security.validateCode(code)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join('; ')}`,
                        }
                    }

                    // Context extraction for rate limiting
                    const reqCtx = getRequestContext()
                    const authCtx = getAuthContext()
                    const clientId = authCtx?.claims?.sub || reqCtx?.sessionId || reqCtx?.ip || 'default'

                    // Rate limiting
                    if (!security.checkRateLimit(clientId)) {
                        return {
                            success: false,
                            error: 'Rate limit exceeded (60 executions per minute)',
                        }
                    }

                    // Context injection for GitHub / Kanban routing
                    let sessionContext = context
                    if (repo && context.config?.projectRegistry) {
                        const registryEntry = context.config.projectRegistry[repo]
                        if (registryEntry) {
                            const injectedGithub = new GitHubIntegration(registryEntry.path)
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
                        ? allTools.filter((t) => SAFE_READ_TOOLS.has(t.name))
                        : allTools

                    // Build the API bridge
                    const api = createJournalApi(tools)
                    const bindings = api.createSandboxBindings()

                    // Execute in sandbox (override timeout if specified)
                    const pool = getSandboxPool()

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
