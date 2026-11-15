import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext, getAuthContext } from '../../../auth/auth-context.js'
import { ConfigurationError } from '../../../types/errors.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { createJournalApi } from '../../../codemode/api/journal-api.js'
import type { SandboxResult } from '../../../codemode/types.js'

import { ExecuteCodeSchema, ExecuteCodeSchemaMcp } from './schemas.js'
import { collectNonCodeModeTools, getSandboxPool, getSecurityManager } from './singleton-state.js'
import { healCodeModeScript, healTemplateBackticksOnRuntimeError, isValidJsScript } from './code-healer.js'
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

function filterToolsForSandbox(
    sessionContext: ToolContext,
    context: ToolContext,
    readonlyRequested: boolean | undefined
): { tools: ToolDefinition[]; allEnabledTools: ToolDefinition[]; isSandboxReadonly: boolean } {
    let tools = collectNonCodeModeTools(sessionContext)
    if (
        context.config?.codemodeInternalFullAccess !== true &&
        context.config?.filterConfig?.enabledTools !== undefined
    ) {
        const enabledSet = context.config.filterConfig.enabledTools
        tools = tools.filter((t) => enabledSet.has(t.name))
    }
    const allEnabledTools = tools
    let isGlobalReadonly = false
    if (context.config?.filterConfig?.raw !== undefined && context.config.filterConfig.raw !== '') {
        const rawTokens = context.config.filterConfig.raw
            .split(',')
            .map((s) => s.trim().toLowerCase())
        for (const token of rawTokens) {
            if (token === 'readonly' || token === '+readonly') {
                isGlobalReadonly = true
            } else if (token === '-readonly') {
                isGlobalReadonly = false
            }
        }
    }
    const isSandboxReadonly = Boolean(readonlyRequested) || isGlobalReadonly
    if (isSandboxReadonly) {
        tools = tools.filter((t) => t.annotations?.readOnlyHint === true)
    }
    return { tools, allEnabledTools, isSandboxReadonly }
}

function isRecoverableSyntaxError(errorMessage: string): boolean {
    const errLower = errorMessage.toLowerCase()
    return (
        errLower.includes('syntax error') ||
        errLower.includes('is not a function') ||
        errLower.includes('unexpected token') ||
        errLower.includes('unexpected identifier') ||
        errLower.includes('missing ) after argument list') ||
        errLower.includes('is not valid json') ||
        errLower.includes('[object object]')
    )
}

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    const securityManager = getSecurityManager()
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute JS Code (Sandbox)',
            description:
                'Run arbitrary JavaScript to automate tasks in a secure sandbox. IMPORTANT: You MUST use the `mj` object (NOT `api`, `journal`, or `mcp`) to access tools. DO NOT use import() or require(); the `mj` tools are globally available in the sandbox. Available tools are mapped directly from MCP tool names, converted to camelCase (e.g., `create_entry` -> `mj.core.createEntry()`, `search_entries` -> `mj.search.searchEntries()`). Anti-Hallucination Hint: Use canonical `repo` as the top-level repository override parameter (`repo_name` is accepted only as a compatibility alias) and inspect unfamiliar schemas first via `return await mj.core.createEntry.schema()`. Execution limit: 30s. Network access (`fetch`) disabled. Example: `return await mj.search.searchEntries({ query: "PowerShell" })`',
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
                    if (context.config?.codemodeEnabled !== true) {
                        throw new ConfigurationError('Code Mode is disabled in the server configuration.')
                    }

                    const clientId =
                        getAuthContext()?.claims?.sub ??
                        context.auth?.sub ??
                        context.auth?.subject ??
                        'default'
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

                    const validation = securityManager.validateCode(executionCode)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join(', ')}`,
                            project_id: undefined,
                            executionTimeMs: 0,
                        }
                    }

                    const sessionRes = await resolveCodeModeSessionContext(context, input)
                    if ('errorResponse' in sessionRes) {
                        return sessionRes.errorResponse
                    }
                    const { sessionContext, projectId, numericProjectId, workspaceId, explicitWorkspace } = sessionRes

                    const { tools, allEnabledTools, isSandboxReadonly } = filterToolsForSandbox(
                        sessionContext,
                        context,
                        input.readonly
                    )

                    let mutatedDuringRun = false
                    const secureDispatcher = createSecureDispatcher({
                        tools,
                        sessionContext,
                        projectId,
                        workspaceId,
                        explicitWorkspace,
                        autoVersion: input.auto_version,
                        dryRun: input.dry_run,
                        onMutatingDispatch: () => {
                            mutatedDuringRun = true
                        },
                    })

                    const journalApi = createJournalApi(
                        tools,
                        secureDispatcher,
                        () => activeProjectRegistry(context.config?.projectRegistry)
                    )
                    const apiBindings = journalApi.createSandboxBindings(sessionContext.progress)
                    const schemaSourceApi = isSandboxReadonly
                        ? createJournalApi(allEnabledTools)
                        : journalApi
                    const schemas = schemaSourceApi.createSandboxSchemas()

                    const pool = getSandboxPool()
                    const { userContext, requestedMaxResultSize } = buildSandboxUserContext(
                        input,
                        sessionContext,
                        projectId,
                        numericProjectId,
                        workspaceId,
                        explicitWorkspace
                    )

                    let execResult: SandboxResult | undefined
                    const authCtx = getAuthContext()
                    const reqCtx = getRequestContext()

                    const runSandbox = async (codeToRun: string): Promise<void> => {
                        mutatedDuringRun = false
                        const executePool = async (): Promise<void> => {
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
                        if (authCtx !== undefined) {
                            await runWithAuthContext(authCtx, executePool)
                        } else {
                            await executePool()
                        }
                    }

                    await requestContextStorage.run(reqCtx ?? {}, async () => {
                        await runSandbox(executionCode)

                        if (
                            !mutatedDuringRun &&
                            healingEnabled &&
                            execResult !== undefined &&
                            !execResult.success &&
                            typeof execResult.error === 'string' &&
                            isRecoverableSyntaxError(execResult.error)
                        ) {
                            const originalInput = typeof input.code === 'string' ? input.code : executionCode
                            const wasValidJs = isValidJsScript(executionCode)
                            const recoveredCode = wasValidJs
                                ? healTemplateBackticksOnRuntimeError(executionCode)
                                : extractAndRecoverSqlCode(originalInput) ??
                                  extractAndRecoverEntryCode(originalInput) ??
                                  extractAndRecoverJsonCode(originalInput) ??
                                  healTemplateBackticksOnRuntimeError(executionCode)
                            if (recoveredCode !== null && recoveredCode !== executionCode) {
                                // [BOUNDARY] Recovered code is re-validated before it ever runs.
                                const retryValidation = securityManager.validateCode(recoveredCode)
                                if (!retryValidation.valid) {
                                    logger.warning('CODEMODE_RECOVERY_REJECTED', {
                                        errors: retryValidation.errors,
                                    })
                                    return
                                }
                                logger.info('CODEMODE_AUTONOMOUS_RECOVERY', {
                                    originalError: execResult.error,
                                    recoveredCode,
                                })
                                await runSandbox(recoveredCode)
                            }
                        }
                    })

                    const executionTime = performance.now() - start

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
