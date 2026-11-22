import type { ToolDefinition, ToolContext, ProjectRegistryEntry } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sanitizeErrorForLogging } from '../../../utils/security-utils.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext, getAuthContext } from '../../../auth/auth-context.js'
import { ConfigurationError } from '../../../types/errors.js'
import { loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'
import {
    captureActiveProjectRegistryState,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
    setFallbackProjectRegistryLoader,
} from '../../../codemode/normalizers/project-alias-helpers.js'
import type { SandboxResult } from '../../../codemode/types.js'

setFallbackProjectRegistryLoader(loadProjectRegistryFromConfig)

import { ExecuteCodeSchema, ExecuteCodeSchemaMcp } from './schemas.js'
import { getOrCreateCodemodeBundle, getSandboxPool, getSecurityManager } from './singleton-state.js'
import { runWithCodemodeInvocation } from './invocation-store.js'
import { healCodeModeScript, healTemplateBackticksOnRuntimeError, isValidJsScript } from './code-healer.js'
import { extractAndRecoverJsonCode, extractAndRecoverEntryCode } from './json-entry-recovery.js'
import { extractAndRecoverSqlCode, extractAndRecoverPreparedStatementCode } from './sql-recovery.js'
import { resolveExecutionPayload, buildSandboxUserContext, type ExecuteCodeInput } from './payload-synthesizer.js'
import { resolveCodeModeSessionContext } from './secure-dispatcher.js'
import { validateRawPayloadSize } from './payload-byte-bounds.js'

export {
    healCodeModeScript,
    extractAndRecoverJsonCode,
    extractAndRecoverEntryCode,
    extractAndRecoverSqlCode,
    extractAndRecoverPreparedStatementCode,
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
    apiBindings: Record<string, unknown>
    schemas: Record<string, Record<string, string>>
    timeoutMs: number | undefined
    userContext: Record<string, unknown>
    isSandboxReadonly: boolean
    isDryRun: boolean
    useTestDb: boolean
    sessionId?: string | undefined
    requestedMaxResultSize: number | undefined
    maxToolInputElements?: number | undefined
    healingEnabled: boolean
    projectRegistry?: Record<string, ProjectRegistryEntry> | undefined
    getMutated: () => boolean
    resetMutated: () => void
}

function runWithScopedRegistry<T>(
    registry: Record<string, ProjectRegistryEntry> | undefined,
    fn: () => T
): T {
    const prev = captureActiveProjectRegistryState()
    setActiveProjectRegistry(registry)
    try {
        return fn()
    } finally {
        restoreActiveProjectRegistryState(prev)
    }
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
                opts.userContext, opts.isSandboxReadonly, opts.requestedMaxResultSize,
                {
                    dryRunMode: opts.isDryRun,
                    useTestDbMode: effectiveUseTestDb,
                    maxToolInputElements: opts.maxToolInputElements,
                }
            )
        }
        await (authCtx !== undefined ? runWithAuthContext(authCtx, executePool) : executePool())
    }

    await requestContextStorage.run(nextRequestContext, async () => {
        await runSandbox(opts.executionCode)
        if (opts.getMutated() || !opts.healingEnabled || !execResult || execResult.success || typeof execResult.error !== 'string') return
        if (!isRecoverableSyntaxError(execResult.error)) return
        const originalInput = opts.originalCode ?? opts.executionCode
        const recoveredCode = runWithScopedRegistry(opts.projectRegistry, () =>
            isValidJsScript(opts.executionCode)
                ? healTemplateBackticksOnRuntimeError(opts.executionCode)
                : extractAndRecoverSqlCode(originalInput) ??
                  extractAndRecoverEntryCode(originalInput) ??
                  extractAndRecoverJsonCode(originalInput) ??
                  healTemplateBackticksOnRuntimeError(opts.executionCode)
        )
        if (recoveredCode === null || recoveredCode === opts.executionCode) return
        // [BOUNDARY] Recovered code is re-validated before it ever runs.
        const retryValidation = opts.securityManager.validateCode(recoveredCode)
        if (!retryValidation.valid) {
            logger.warning('CODEMODE_RECOVERY_REJECTED', { errors: retryValidation.errors })
            return
        }
        logger.info('CODEMODE_AUTONOMOUS_RECOVERY', {
            originalError: execResult.error,
            recoveredBytes: Buffer.byteLength(recoveredCode, 'utf-8'),
        })
        await runSandbox(recoveredCode)
    })
    return execResult
}

function buildSecurityErrorResult(error: string): Record<string, unknown> {
    return { success: false, error, project_id: undefined, executionTimeMs: 0 }
}

function resolveCodeModeRunOptions(input: ExecuteCodeInput): {
    sessionId: string | undefined
    timeoutMs: number | undefined
    readonlyRequested: boolean
    isDryRun: boolean
    useTestDb: boolean
} {
    const rawSession = input.session_id ?? input.sessionId
    const sessionId = typeof rawSession === 'string' && rawSession.trim() !== '' ? rawSession.trim() : undefined
    return {
        sessionId,
        timeoutMs: input.timeout ?? input.timeout_ms ?? input.timeoutMs,
        readonlyRequested: input.readonly === true || input.read_only === true || input.readOnly === true,
        isDryRun: input.dry_run,
        useTestDb: input.use_test_db === true || input.useTestDb === true,
    }
}

async function executeSandboxedInvocation(options: {
    context: ToolContext
    securityManager: ReturnType<typeof getSecurityManager>
    input: ExecuteCodeInput
    executionCode: string
    sessionRes: Extract<Awaited<ReturnType<typeof resolveCodeModeSessionContext>>, { sessionContext: ToolContext }>
    timeoutMs: number | undefined
    readonlyRequested: boolean | undefined
    isDryRun: boolean
    useTestDb: boolean
    sessionId: string | undefined
}): Promise<SandboxResult | undefined> {
    const { context, securityManager, input, executionCode, sessionRes, timeoutMs, readonlyRequested, isDryRun, useTestDb, sessionId } = options
    const { sessionContext, projectId, numericProjectId, workspaceId, explicitWorkspace } = sessionRes
    const { isSandboxReadonly, apiBindings, schemas } = getOrCreateCodemodeBundle(
        sessionContext,
        context,
        readonlyRequested
    )
    let mutatedDuringRun = false
    const { userContext, requestedMaxResultSize } = buildSandboxUserContext(
        input, sessionContext, projectId, numericProjectId, workspaceId, explicitWorkspace
    )
    return await runWithCodemodeInvocation(
        {
            sessionContext, projectId, workspaceId, explicitWorkspace, sessionId,
            autoVersion: input.auto_version ?? input.autoVersion ?? true,
            dryRun: isDryRun,
            projectRegistry: context.config?.projectRegistry,
            onMutatingDispatch: () => { mutatedDuringRun = true },
        },
        () =>
            runSandboxWithAutonomousRecovery({
                pool: getSandboxPool(), securityManager, executionCode,
                originalCode: input.code, apiBindings, schemas, timeoutMs,
                userContext, isSandboxReadonly, isDryRun, useTestDb, sessionId,
                requestedMaxResultSize, maxToolInputElements: context.config?.maxToolInputElements,
                healingEnabled: context.config?.agentHealing !== false,
                projectRegistry: context.config?.projectRegistry,
                getMutated: () => mutatedDuringRun,
                resetMutated: () => { mutatedDuringRun = false },
            })
    )
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
        const sizeErr = validateRawPayloadSize(params, securityManager.getConfig().maxCodeLength, context.config?.maxToolInputElements)
        if (sizeErr !== null) return buildSecurityErrorResult(sizeErr)

        const input: ExecuteCodeInput = ExecuteCodeSchema.parse(params)
        const { sessionId, timeoutMs, readonlyRequested, isDryRun, useTestDb } = resolveCodeModeRunOptions(input)
        const healingEnabled = context.config?.agentHealing !== false
        const payloadRes = runWithScopedRegistry(context.config?.projectRegistry, () =>
            resolveExecutionPayload(input, params, healingEnabled, start)
        )
        if ('earlyReturn' in payloadRes) return payloadRes.earlyReturn
        const executionCode = payloadRes.executionCode

        const validation = securityManager.validateCode(executionCode)
        if (!validation.valid) return buildSecurityErrorResult(`Security validation failed: ${validation.errors.join(', ')}`)

        const sessionRes = await resolveCodeModeSessionContext(context, input)
        if ('errorResponse' in sessionRes) return sessionRes.errorResponse

        const execResult = await executeSandboxedInvocation({
            context, securityManager, input, executionCode, sessionRes,
            timeoutMs, readonlyRequested, isDryRun, useTestDb, sessionId,
        })
        return {
            success: Boolean(execResult?.success),
            executionTimeMs: Math.round((performance.now() - start) * 100) / 100,
            result: execResult?.result,
            error: typeof execResult?.error === 'string' ? sanitizeErrorForLogging(execResult.error) : execResult?.error,
            metrics: execResult?.metrics,
            simulated: isDryRun ? true : undefined,
            project_id: sessionRes.projectId,
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
