import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext, getAuthContext } from '../../../auth/auth-context.js'
import { ConfigurationError } from '../../../types/errors.js'
import { createJournalApi } from '../../../codemode/api/journal-api.js'
import type { SandboxResult } from '../../../codemode/types.js'

import { ExecuteCodeSchema, ExecuteCodeSchemaMcp } from './schemas.js'
import { collectNonCodeModeTools, getSandboxPool, getSecurityManager } from './singleton-state.js'
import { healCodeModeScript } from './code-healer.js'
import { extractAndRecoverJsonCode, extractAndRecoverEntryCode } from './json-entry-recovery.js'
import { extractAndRecoverSqlCode, extractAndRecoverPreparedStatementCode } from './sql-recovery.js'
import { resolveExecutionPayload, buildSandboxUserContext } from './payload-synthesizer.js'
import { createSecureDispatcher, resolveCodeModeSessionContext } from './secure-dispatcher.js'

export {
    healCodeModeScript,
    extractAndRecoverJsonCode,
    extractAndRecoverEntryCode,
    extractAndRecoverSqlCode,
    extractAndRecoverPreparedStatementCode,
}

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    const securityManager = getSecurityManager()
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute JS Code (Sandbox)',
            description:
                'Run arbitrary JavaScript to automate tasks in a secure sandbox. IMPORTANT: You MUST use the `mj` object (NOT `api`, `journal`, or `mcp`) to access tools. DO NOT use import() or require(); the `mj` tools are globally available in the sandbox. Available tools are mapped directly from MCP tool names, converted to camelCase (e.g., `create_entry` -> `mj.createEntry()`, `search_entries` -> `mj.searchEntries()`). Anti-Hallucination Hint: DO NOT GUESS parameter keys (e.g., passing `repo` instead of `repo_name` will fail). ALWAYS inspect the schema first if unsure: `return await mj.createEntry.schema()`. Execution limit: 30s. Network access (`fetch`) disabled. Example: `return await mj.searchEntries({ query: "PowerShell" })`',
            group: 'codemode',
            inputSchema: ExecuteCodeSchemaMcp,
            outputSchema: undefined,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                const start = performance.now()

                try {
                    // 1. Configuration Validation (must precede any payload synthesis or regex healing)
                    if (context.config?.codemodeEnabled !== true) {
                        throw new ConfigurationError('Code Mode is disabled in the server configuration.')
                    }

                    // 1b. Rate Limiting (must precede expensive payload synthesis)
                    const clientId = context.auth?.sub ?? context.auth?.subject ?? 'default'
                    if (!securityManager.checkRateLimit(clientId)) {
                        return {
                            success: false,
                            error: 'Rate limit exceeded: Maximum code executions per minute reached.',
                            project_id: undefined,
                            executionTimeMs: 0,
                        }
                    }

                    const input = ExecuteCodeSchema.parse(params)
                    const healingEnabled = context.config?.agentHealing !== false

                    const rawCodeCandidate = typeof input.code === 'string' ? input.code : typeof input.script === 'string' ? input.script : undefined
                    if (rawCodeCandidate !== undefined && Buffer.byteLength(rawCodeCandidate, 'utf-8') > securityManager.getConfig().maxCodeLength) {
                        return {
                            success: false,
                            error: `Security validation failed: Code exceeds maximum length of ${String(securityManager.getConfig().maxCodeLength)} bytes`,
                            project_id: undefined,
                            executionTimeMs: 0,
                        }
                    }

                    const payloadRes = resolveExecutionPayload(input, params, healingEnabled, start)
                    if ('earlyReturn' in payloadRes) {
                        return payloadRes.earlyReturn
                    }
                    const executionCode = payloadRes.executionCode

                    // 1c. Security Validation
                    const validation = securityManager.validateCode(executionCode)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join(', ')}`,
                            project_id: undefined,
                            executionTimeMs: 0,
                        }
                    }

                    // 2. Project & Session Context Resolution
                    const sessionRes = await resolveCodeModeSessionContext(context, input)
                    if ('errorResponse' in sessionRes) {
                        return sessionRes.errorResponse
                    }
                    const { sessionContext, projectId, numericProjectId, workspaceId } = sessionRes

                    // 2b. Fetch all tools and enforce Tool Filter & Readonly Mode
                    let tools = collectNonCodeModeTools(sessionContext)
                    if (
                        context.config?.codemodeInternalFullAccess !== true &&
                        context.config?.filterConfig?.enabledTools !== undefined
                    ) {
                        const enabledSet = context.config.filterConfig.enabledTools
                        tools = tools.filter((t) => enabledSet.has(t.name))
                    }
                    let isGlobalReadonly = false
                    if (context.config?.filterConfig?.raw !== undefined && context.config.filterConfig.raw !== '') {
                        const rawFilter = context.config.filterConfig.raw
                        if (rawFilter.includes('readonly') && !rawFilter.includes('-readonly')) {
                            isGlobalReadonly = true
                        }
                    }
                    const isSandboxReadonly = Boolean(input.readonly) || isGlobalReadonly
                    if (isSandboxReadonly) {
                        tools = tools.filter((t) => t.annotations?.readOnlyHint === true)
                    }

                    // 3. Create the secure dispatcher wrapper around tool handlers
                    const secureDispatcher = createSecureDispatcher({
                        tools,
                        sessionContext,
                        projectId,
                        workspaceId,
                        autoVersion: input.auto_version,
                        dryRun: input.dry_run,
                    })

                    // Prepare API bindings using the unified JournalApi factory
                    const journalApi = createJournalApi(tools, secureDispatcher)
                    const apiBindings = journalApi.createSandboxBindings(sessionContext.progress)
                    const schemas = journalApi.createSandboxSchemas()

                    // 4. Execute Code in Sandbox Worker
                    const pool = getSandboxPool()
                    const { userContext, requestedMaxResultSize } = buildSandboxUserContext(
                        input,
                        sessionContext,
                        projectId,
                        numericProjectId,
                        workspaceId
                    )

                    let execResult: SandboxResult | undefined
                    const authCtx = getAuthContext()
                    const reqCtx = getRequestContext()

                    const runSandbox = async (codeToRun: string): Promise<void> => {
                        if (authCtx !== undefined) {
                            await runWithAuthContext(authCtx, async () => {
                                execResult = await pool.execute(
                                    codeToRun,
                                    apiBindings,
                                    schemas,
                                    input.timeout ?? input.timeout_ms,
                                    userContext,
                                    isSandboxReadonly,
                                    requestedMaxResultSize
                                )
                            })
                        } else {
                            execResult = await pool.execute(
                                codeToRun,
                                apiBindings,
                                schemas,
                                input.timeout ?? input.timeout_ms,
                                userContext,
                                isSandboxReadonly,
                                requestedMaxResultSize
                            )
                        }
                    }

                    await requestContextStorage.run(reqCtx ?? {}, async () => {
                        await runSandbox(executionCode)

                        if (
                            healingEnabled &&
                            execResult !== undefined &&
                            !execResult.success &&
                            typeof execResult.error === 'string'
                        ) {
                            const errLower = execResult.error.toLowerCase()
                            if (
                                errLower.includes('syntax error') ||
                                errLower.includes('is not a function') ||
                                errLower.includes('unexpected token') ||
                                errLower.includes('unexpected identifier') ||
                                errLower.includes('missing ) after argument list') ||
                                errLower.includes('is not valid json') ||
                                errLower.includes('[object object]')
                            ) {
                                const originalInput = typeof input.code === 'string' ? input.code : executionCode
                                const recoveredCode =
                                    extractAndRecoverSqlCode(originalInput) ??
                                    extractAndRecoverEntryCode(originalInput) ??
                                    extractAndRecoverJsonCode(originalInput)
                                if (recoveredCode !== null && recoveredCode !== executionCode) {
                                    logger.info('CODEMODE_AUTONOMOUS_RECOVERY', {
                                        originalError: execResult.error,
                                        recoveredCode,
                                    })
                                    await runSandbox(recoveredCode)
                                }
                            }
                        }
                    })

                    const executionTime = performance.now() - start

                    // 5. Format and return results
                    return {
                        success: Boolean(execResult?.success),
                        executionTimeMs: Math.round(executionTime * 100) / 100,
                        result: execResult?.result,
                        error: execResult?.error,
                        metrics: execResult?.metrics,
                        simulated: input.dry_run ? true : undefined,
                        project_id: projectId,
                    }
                } catch (err) {
                    logger.error('CODEMODE_HANDLER_ERROR', { error: err })
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
