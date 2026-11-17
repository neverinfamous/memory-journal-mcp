import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { initializeDependencies } from '../../server/mcp-server/initialization.js'
import { resolveActiveBriefingConfig } from '../../server/mcp-server/tool-registration/register-tools-helpers.js'
import { callTool } from '../../handlers/tools/index.js'
import { globalSubscriptionManager } from '../../server/subscription-manager.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import type { ServerContext } from '../../server/mcp-server/types.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { findCanonicalRegistryKey } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'
import { type z } from 'zod'
import { execOptionsSchema } from '../schemas.js'
import { writeCliResult } from './cli-output.js'

export const execSchema = execOptionsSchema
type ExecOptions = z.infer<typeof execSchema>

interface PreparedExecConfig {
    serverOptions: ReturnType<typeof buildServerOptions>['serverOptions']
    execWorkspaceId: string | undefined
    explicitDefaultProject: boolean
}

function validateExecScope(
    options: ExecOptions,
    command: Command,
    serverOptions: PreparedExecConfig['serverOptions'],
    configErrors: string[]
): { execWorkspaceId: string | undefined; explicitDefaultProject: boolean } {
    if (options.workspace?.trim() === '*' || options.defaultWorkspaceId?.trim() === '*') {
        configErrors.push("Wildcard '*' is not allowed for --workspace or --default-workspace-id.")
    }
    const execWorkspaceId =
        options.workspace !== undefined && options.workspace.trim() !== ''
            ? options.workspace.trim()
            : undefined
    const explicitDefaultProject =
        options.defaultProject !== undefined ||
        command.getOptionValueSource('defaultProject') === 'cli'
    if (execWorkspaceId !== undefined && execWorkspaceId !== '*') {
        const prevDefaultWs = serverOptions.defaultWorkspaceId
        serverOptions.defaultWorkspaceId = execWorkspaceId
        if (!explicitDefaultProject && execWorkspaceId.toLowerCase() !== prevDefaultWs?.trim().toLowerCase()) {
            serverOptions.defaultProjectNumber = undefined
        }
        const preCheckProj =
            options.defaultProject ??
            (explicitDefaultProject ? serverOptions.defaultProjectNumber : undefined)
        if (preCheckProj !== undefined) {
            try {
                pairStoredScope(execWorkspaceId, preCheckProj, activeProjectRegistry(serverOptions.projectRegistry))
            } catch (err) {
                configErrors.push(err instanceof Error ? err.message : String(err))
            }
        }
    }
    return { execWorkspaceId, explicitDefaultProject }
}

function prepareExecServerOptions(options: ExecOptions, command: Command): PreparedExecConfig {
    let resolver: ConfigResolver
    const configPath = options.config ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []
    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }
    const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
    const { execWorkspaceId, explicitDefaultProject } = validateExecScope(
        options,
        command,
        serverOptions,
        configErrors
    )
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }
    if (options.dumpConfig === true) {
        dumpConfigAndExit(serverOptions)
    }
    // Override config-sourced test databases for exec unless explicitly passed on the CLI
    if (options.testDb === undefined) serverOptions.testDbPath = undefined
    if (options.testTeamDb === undefined) serverOptions.testTeamDbPath = undefined
    return { serverOptions, execWorkspaceId, explicitDefaultProject }
}

function readExecScriptOrExit(scriptPath: string): string {
    try {
        return readFileSync(scriptPath, 'utf8')
    } catch (err) {
        process.stderr.write(
            `Failed to read script '${scriptPath}': ${err instanceof Error ? err.message : String(err)}\n`
        )
        process.exit(1)
    }
}

function buildExecToolConfig(
    context: ServerContext,
    serverOptions: PreparedExecConfig['serverOptions'],
    options: ExecOptions,
    execWorkspaceId: string | undefined,
    explicitDefaultProject: boolean
): ToolHandlerConfig {
    const currentConfig = context.configManager.getConfig()
    const briefingConfig = resolveActiveBriefingConfig(
        currentConfig.briefingConfig,
        context.allowedIoRoots
    )
    const effectiveRegistry = serverOptions.projectRegistry ?? briefingConfig.projectRegistry
    let resolvedDefaultProj = serverOptions.defaultProjectNumber ?? briefingConfig.defaultProjectNumber
    if (execWorkspaceId !== undefined) {
        const canonicalExecWs = findCanonicalRegistryKey(execWorkspaceId, effectiveRegistry) ?? execWorkspaceId
        const registryExecProj = effectiveRegistry?.[canonicalExecWs]?.project_number
        const briefingMatchesExecWs =
            briefingConfig.defaultWorkspaceId?.trim().toLowerCase() === canonicalExecWs.toLowerCase()
        resolvedDefaultProj = explicitDefaultProject
            ? (options.defaultProject ?? serverOptions.defaultProjectNumber)
            : (serverOptions.defaultProjectNumber ??
                  registryExecProj ??
                  (briefingMatchesExecWs ? briefingConfig.defaultProjectNumber : undefined))
        if (resolvedDefaultProj !== undefined) {
            pairStoredScope(canonicalExecWs, resolvedDefaultProj, activeProjectRegistry(effectiveRegistry))
        }
    }
    const customToolHandlerConfig: ToolHandlerConfig = {
        defaultProjectNumber: resolvedDefaultProj,
        defaultWorkspaceId:
            options.workspace ?? serverOptions.defaultWorkspaceId ?? briefingConfig.defaultWorkspaceId,
        projectRegistry: effectiveRegistry,
        additionalTeamDbs: serverOptions.additionalTeamDbs,
        allowedIoRoots: context.allowedIoRoots,
        filterConfig: currentConfig.toolFilterConfig,
        authEnabled: Boolean(serverOptions.authToken ?? process.env['MCP_AUTH_TOKEN']),
        oauthEnabled: serverOptions.oauthEnabled,
        codemodeEnabled: true, // Force enabled for the exec command
        codemodeInternalFullAccess: serverOptions.codemodeInternalFullAccess,
        agentHealing: serverOptions.agentHealing,
        teamDefaultRole: serverOptions.teamDefaultRole,
        teamAdmin: serverOptions.teamAdmin,
        briefingConfig,
        runtime: context.runtime,
        subscriptionManager: globalSubscriptionManager,
    }
    customToolHandlerConfig.dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
        callTool(
            name,
            args,
            context.db,
            context.vectorManager,
            context.github,
            customToolHandlerConfig,
            undefined,
            context.teamDb ?? undefined,
            context.teamVectorManager ?? undefined
        )
    return customToolHandlerConfig
}

export async function execAction(scriptPath: string, options: ExecOptions, command: Command): Promise<void> {
    const { serverOptions, execWorkspaceId, explicitDefaultProject } = prepareExecServerOptions(
        options,
        command
    )
    const scriptContent = readExecScriptOrExit(scriptPath)
    const context = await initializeDependencies(serverOptions)

    let exitCode = 0
    try {
        const customToolHandlerConfig = buildExecToolConfig(
            context,
            serverOptions,
            options,
            execWorkspaceId,
            explicitDefaultProject
        )
        const result = await callTool(
            'mj_execute_code',
            {
                code: scriptContent,
                ...(execWorkspaceId !== undefined ? { workspace_id: execWorkspaceId } : {}),
                ...(options.defaultProject !== undefined ? { project_number: options.defaultProject } : {}),
            },
            context.db,
            context.vectorManager,
            context.github,
            customToolHandlerConfig,
            undefined,
            context.teamDb ?? undefined,
            context.teamVectorManager ?? undefined
        )
        if (typeof result === 'object' && result !== null && 'success' in result && result.success === false) {
            exitCode = 1
        }
        writeCliResult(result, options.json, exitCode === 0 ? 'Execution completed.' : 'Execution failed.')
    } catch (error) {
        process.stderr.write(`Execution failed: ${error instanceof Error ? error.message : String(error)}\n`)
        exitCode = 1
    } finally {
        try {
            context.runtime.stopBackgroundTasks?.()
        } catch {
            // best-effort timer teardown
        }
        try {
            context.configManager.close()
        } catch {
            // best-effort config watcher teardown
        }
        if (context.runtime.auditLogger) {
            try {
                await context.runtime.auditLogger.close()
            } catch {
                // best-effort audit logger teardown
            }
        }
        if (context.activeMetricsPath) {
            try {
                await context.runtime.metrics.saveToFile(context.activeMetricsPath)
            } catch {
                // best-effort metrics flush
            }
        }
        try {
            context.db.close()
        } catch {
            // best-effort db close
        }
        try {
            context.teamDb?.close()
        } catch {
            // best-effort teamDb close
        }
    }
    process.exit(exitCode)
}
