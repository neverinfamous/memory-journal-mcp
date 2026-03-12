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
import { createJournalApi } from '../../codemode/api.js'
import { CodeModeSecurityManager } from '../../codemode/security.js'
import { createSandboxPool, type ISandboxPool } from '../../codemode/sandbox-factory.js'
import { getCoreTools } from './core.js'
import { getSearchTools } from './search.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getExportTools } from './export.js'
import { getAdminTools } from './admin.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'
import { getTeamTools } from './team.js'

// =============================================================================
// Input / Output Schemas
// =============================================================================

const ExecuteCodeSchema = z.object({
    code: z.string().min(1),
    timeout: z.number().max(30000).optional().default(30000),
    readonly: z.boolean().optional().default(false),
})

/** Relaxed schema for MCP registration */
const ExecuteCodeSchemaMcp = z.object({
    code: z.string().describe('JavaScript code to execute in the sandbox'),
    timeout: z.number().optional().default(30000).describe('Execution timeout in ms (max 30000)'),
    readonly: z.boolean().optional().default(false).describe('Restrict to read-only operations'),
})

const ExecuteCodeOutputSchema = z.object({
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    metrics: z
        .object({
            wallTimeMs: z.number(),
            cpuTimeMs: z.number(),
            memoryUsedMb: z.number(),
        })
        .optional(),
})

// =============================================================================
// Singleton State
// =============================================================================

let securityManager: CodeModeSecurityManager | null = null
let sandboxPool: ISandboxPool | null = null

function getSecurityManager(): CodeModeSecurityManager {
    securityManager ??= new CodeModeSecurityManager()
    return securityManager
}

function getSandboxPool(): ISandboxPool {
    sandboxPool ??= createSandboxPool()
    return sandboxPool
}

// =============================================================================
// Helper: Collect Non-CodeMode Tools
// =============================================================================

/**
 * Collect all tool definitions except codemode (prevents recursion).
 * Imports directly from each tool group module — no circular dependency
 * since these are leaf modules with no dependency on codemode.
 */
function collectNonCodeModeTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getCoreTools(context),
        ...getSearchTools(context),
        ...getAnalyticsTools(context),
        ...getRelationshipTools(context),
        ...getExportTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
    ]
}

// =============================================================================
// Tool Definitions
// =============================================================================

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute Code (Code Mode)',
            description:
                'Execute JavaScript in a sandboxed environment with access to all 42 journal tools via the `mj.*` API. ' +
                'Enables multi-step workflows in a single call, reducing token usage by 70-90%. ' +
                'API groups: mj.core.*, mj.search.*, mj.analytics.*, mj.relationships.*, ' +
                'mj.export.*, mj.admin.*, mj.github.*, mj.backup.*, mj.team.*. ' +
                'Use mj.help() for method listing. Returns the last expression value.',
            group: 'codemode',
            inputSchema: ExecuteCodeSchemaMcp,
            outputSchema: ExecuteCodeOutputSchema,
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const { code, readonly: readonlyMode } = ExecuteCodeSchema.parse(params)

                    // Security validation
                    const security = getSecurityManager()
                    const validation = security.validateCode(code)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join('; ')}`,
                        }
                    }

                    // Rate limiting
                    if (!security.checkRateLimit('default')) {
                        return {
                            success: false,
                            error: 'Rate limit exceeded (60 executions per minute)',
                        }
                    }

                    // Build tool list (excluding codemode to prevent recursion)
                    const allTools = collectNonCodeModeTools(context)

                    // Filter out write operations if readonly mode
                    const tools = readonlyMode
                        ? allTools.filter((t) => t.annotations.readOnlyHint === true)
                        : allTools

                    // Build the API bridge
                    const api = createJournalApi(tools)
                    const bindings = api.createSandboxBindings()

                    // Execute in sandbox (override timeout if specified)
                    const pool = getSandboxPool()

                    // For VM sandbox, the bindings are passed directly
                    // For Worker sandbox, the bindings need to be the group API records
                    return pool.execute(code, bindings).then((result) => {
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
                    })
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
