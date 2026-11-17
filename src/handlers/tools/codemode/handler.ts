import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext, getAuthContext } from '../../../auth/auth-context.js'
import { ConfigurationError } from '../../../types/errors.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'
import { setFallbackProjectRegistryLoader } from '../../../codemode/normalizers/generic-field-aliases.js'
import { createJournalApi } from '../../../codemode/api/journal-api.js'
import type { SandboxResult } from '../../../codemode/types.js'

setFallbackProjectRegistryLoader(loadProjectRegistryFromConfig)

import { isFilterEffectivelyReadOnly, isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { ExecuteCodeSchema, ExecuteCodeSchemaMcp } from './schemas.js'
import { collectNonCodeModeTools, getSandboxPool, getSecurityManager } from './singleton-state.js'
import { healCodeModeScript, healTemplateBackticksOnRuntimeError, isValidJsScript } from './code-healer.js'
import { extractAndRecoverJsonCode, extractAndRecoverEntryCode } from './json-entry-recovery.js'
import { extractAndRecoverSqlCode, extractAndRecoverPreparedStatementCode } from './sql-recovery.js'
import { resolveExecutionPayload, buildSandboxUserContext, type ExecuteCodeInput } from './payload-synthesizer.js'
import { createSecureDispatcher, resolveCodeModeSessionContext } from './secure-dispatcher.js'

const MAX_CONTEXT_BYTES = 5 * 1024 * 1024

function checkSerializedByteLimit(val: unknown, limitBytes: number, errorMsg: string): string | null {
    try {
        const serialized = typeof val === 'string' ? val : JSON.stringify(val)
        if (typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf-8') > limitBytes) {
            return errorMsg
        }
        return null
    } catch {
        return 'Security validation failed: Invalid non-serializable payload object'
    }
}

function validateRawPayloadSize(params: unknown, maxCodeLength: number): string | null {
    const overLimit = (): string => `Security validation failed: Code exceeds maximum length of ${String(maxCodeLength)} bytes`
    if (typeof params === 'string') {
        return Buffer.byteLength(params, 'utf-8') > maxCodeLength ? overLimit() : null
    }
    if (!isRecord(params)) return null
    for (const [key, val] of Object.entries(params)) {
        if (val === undefined || val === null) continue
        if (key === 'context') {
            const ctxErr = checkSerializedByteLimit(
                val,
                MAX_CONTEXT_BYTES,
                `Security validation failed: Context exceeds maximum length of ${String(MAX_CONTEXT_BYTES)} bytes`
            )
            if (ctxErr !== null) return ctxErr
            continue
        }
        if (typeof val === 'string') {
            if (Buffer.byteLength(val, 'utf-8') > maxCodeLength) return overLimit()
        } else if (typeof val === 'object') {
            const objErr = checkSerializedByteLimit(val, maxCodeLength, overLimit())
            if (objErr !== null) return objErr
        }
    }
    return null
}

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
        const rawFilter = context.config.filterConfig.raw
        tools = tools.filter(
            (t) =>
                enabledSet.has(t.name) &&
                isToolVisibleForFilter(t.name, t.annotations?.readOnlyHint, rawFilter)
        )
    }
    const allEnabledTools = tools
    const filterConfig = context.config?.filterConfig
    const isGlobalReadonly =
        filterConfig !== null && filterConfig !== undefined
            ? isFilterEffectivelyReadOnly(filterConfig)
            : false
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

interface RecoveryRunOptions {
    pool: ReturnType<typeof getSandboxPool>
    securityManager: ReturnType<typeof getSecurityManager>
    executionCode: string
    originalCode: string | undefined
    apiBindings: ReturnType<ReturnType<typeof createJournalApi>['createSandboxBindings']>
    schemas: ReturnType<ReturnType<typeof createJournalApi>['createSandboxSchemas']>
    timeoutMs: number | undefined
    userContext: Record<string, unknown>
    isSandboxReadonly: boolean
    useTestDb: boolean
    sessionId?: string | undefined
    requestedMaxResultSize: number | undefined
    healingEnabled: boolean
    getMutated: () => boolean
    resetMutated: () => void
}

async function runSandboxWithAutonomousRecovery(opts: RecoveryRunOptions): Promise<SandboxResult | undefined> {
    let execResult: SandboxResult | undefined
    const authCtx = getAuthContext()
    const reqCtx = getRequestContext()
    const effectiveUseTestDb = opts.useTestDb || reqCtx?.useTestDb === true
    const nextRequestContext = {
        ...(reqCtx ?? {}),
        ...(effectiveUseTestDb ? { useTestDb: true } : {}),
        ...(opts.sessionId !== undefined && opts.sessionId !== '' ? { sessionId: opts.sessionId } : {}),
    }

    const runSandbox = async (codeToRun: string): Promise<void> => {
        opts.resetMutated()
        const executePool = async (): Promise<void> => {
            execResult = await opts.pool.execute(
                codeToRun, opts.apiBindings, opts.schemas, opts.timeoutMs,
                opts.userContext, opts.isSandboxReadonly, opts.requestedMaxResultSize
            )
        }
        await (authCtx !== undefined ? runWithAuthContext(authCtx, executePool) : executePool())
    }

    await requestContextStorage.run(nextRequestContext, async () => {
        await runSandbox(opts.executionCode)
        if (opts.getMutated() || !opts.healingEnabled || !execResult || execResult.success || typeof execResult.error !== 'string') return
        if (!isRecoverableSyntaxError(execResult.error)) return
        const originalInput = opts.originalCode ?? opts.executionCode
        const recoveredCode = isValidJsScript(opts.executionCode)
            ? healTemplateBackticksOnRuntimeError(opts.executionCode)
            : extractAndRecoverSqlCode(originalInput) ??
              extractAndRecoverEntryCode(originalInput) ??
              extractAndRecoverJsonCode(originalInput) ??
              healTemplateBackticksOnRuntimeError(opts.executionCode)
        if (recoveredCode === null || recoveredCode === opts.executionCode) return
        // [BOUNDARY] Recovered code is re-validated before it ever runs.
        const retryValidation = opts.securityManager.validateCode(recoveredCode)
        if (!retryValidation.valid) {
            logger.warning('CODEMODE_RECOVERY_REJECTED', { errors: retryValidation.errors })
            return
        }
        logger.info('CODEMODE_AUTONOMOUS_RECOVERY', { originalError: execResult.error, recoveredCode })
        await runSandbox(recoveredCode)
    })
    return execResult
}

function buildSecurityErrorResult(error: string): Record<string, unknown> {
    return { success: false, error, project_id: undefined, executionTimeMs: 0 }
}

async function executeCodeModeHandler(
    context: ToolContext,
    securityManager: ReturnType<typeof getSecurityManager>,
    params: unknown
): Promise<Record<string, unknown>> {
    const start = performance.now()
    try {
        if (context.config?.codemodeEnabled !== true) {
            throw new ConfigurationError('Code Mode is disabled in the server configuration.')
        }
        const clientId = getAuthContext()?.claims?.sub ?? context.auth?.sub ?? context.auth?.subject ?? 'default'
        if (!securityManager.checkRateLimit(clientId)) {
            return buildSecurityErrorResult('Rate limit exceeded: Maximum code executions per minute reached.')
        }
        const sizeErr = validateRawPayloadSize(params, securityManager.getConfig().maxCodeLength)
        if (sizeErr !== null) return buildSecurityErrorResult(sizeErr)

        const input: ExecuteCodeInput = ExecuteCodeSchema.parse(params)
        const sessionId =
            typeof input.session_id === 'string' && input.session_id.trim() !== '' ? input.session_id.trim() : undefined
        const healingEnabled = context.config?.agentHealing !== false
        const payloadRes = resolveExecutionPayload(input, params, healingEnabled, start)
        if ('earlyReturn' in payloadRes) return payloadRes.earlyReturn
        const executionCode = payloadRes.executionCode

        const validation = securityManager.validateCode(executionCode)
        if (!validation.valid) return buildSecurityErrorResult(`Security validation failed: ${validation.errors.join(', ')}`)

        const sessionRes = await resolveCodeModeSessionContext(context, input)
        if ('errorResponse' in sessionRes) return sessionRes.errorResponse
        const { sessionContext, projectId, numericProjectId, workspaceId, explicitWorkspace } = sessionRes

        const readonlyRequested = input.readonly === true || input.read_only === true || input.readOnly === true
        const { tools, allEnabledTools, isSandboxReadonly } = filterToolsForSandbox(sessionContext, context, readonlyRequested)
        const isDryRun = input.dry_run || input.dryRun === true
        let mutatedDuringRun = false
        const secureDispatcher = createSecureDispatcher({
            tools,
            sessionContext,
            projectId,
            workspaceId,
            explicitWorkspace,
            sessionId,
            autoVersion: input.autoVersion ?? input.auto_version,
            dryRun: isDryRun,
            onMutatingDispatch: () => { mutatedDuringRun = true },
        })
        const journalApi = createJournalApi(tools, secureDispatcher, () => activeProjectRegistry(context.config?.projectRegistry))
        const schemas = (isSandboxReadonly ? createJournalApi(allEnabledTools) : journalApi).createSandboxSchemas()
        const { userContext, requestedMaxResultSize } = buildSandboxUserContext(
            input, sessionContext, projectId, numericProjectId, workspaceId, explicitWorkspace
        )
        const execResult = await runSandboxWithAutonomousRecovery({
            pool: getSandboxPool(), securityManager, executionCode, originalCode: input.code,
            apiBindings: journalApi.createSandboxBindings(sessionContext.progress), schemas,
            timeoutMs: input.timeout ?? input.timeout_ms, userContext, isSandboxReadonly,
            useTestDb: input.use_test_db === true || input.useTestDb === true,
            sessionId,
            requestedMaxResultSize, healingEnabled,
            getMutated: () => mutatedDuringRun, resetMutated: () => { mutatedDuringRun = false },
        })
        return {
            success: Boolean(execResult?.success),
            executionTimeMs: Math.round((performance.now() - start) * 100) / 100,
            result: execResult?.result,
            error: execResult?.error,
            metrics: execResult?.metrics,
            simulated: isDryRun ? true : undefined,
            project_id: projectId,
        }
    } catch (err) {
        logger.error('CODEMODE_HANDLER_ERROR', { error: err })
        return { ...formatHandlerError(err) }
    }
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
            handler: async (params: unknown) => executeCodeModeHandler(context, securityManager, params),
        },
    ]
}
