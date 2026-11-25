import type { Command } from 'commander'
import { initializeDependencies } from '../../server/mcp-server/initialization.js'
import { buildBaseToolConfig, closeServerResources, teardownVectorManagers } from '../../server/mcp-server/core-helpers.js'
import { resolveActiveBriefingConfig } from '../../server/mcp-server/tool-registration/register-tools-helpers.js'
import { callTool } from '../../handlers/tools/index.js'
import { disposeCodemodeResources } from '../../handlers/tools/codemode/singleton-state.js'
import { closeCrossTeamAdapters } from '../../handlers/tools/search/cross-team.js'
import { flushAgentIssues } from '../../utils/issue-logger.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import type { ServerContext } from '../../server/mcp-server/types.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { findCanonicalRegistryKey } from '../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../utils/write-scope.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'
import { type z } from 'zod'
import { execOptionsSchema } from '../schemas.js'
import { readBoundedCliInputFile } from './cli-input-reader.js'
import { formatCliError, writeCliResult } from './cli-output.js'

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
    if (options.workspace?.trim() === '') {
        configErrors.push("Invalid --workspace '': expected a non-empty workspace identifier.")
    }
    if (options.defaultWorkspaceId?.trim() === '') {
        configErrors.push("Invalid --default-workspace-id '': expected a non-empty workspace identifier.")
    }
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
    const envConfig = process.env['MEMORY_JOURNAL_CONFIG']?.trim()
    const configPath = options.config ?? (envConfig !== undefined && envConfig !== '' ? envConfig : undefined)
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
        configErrors.forEach((err) => process.stderr.write(` - ${formatCliError(err)}\n`))
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
        return readBoundedCliInputFile(scriptPath, 'script')
    } catch (err) {
        process.stderr.write(`Failed to read script: ${formatCliError(err)}\n`)
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
        ...buildBaseToolConfig(
            serverOptions,
            context.runtime,
            context.allowedIoRoots,
            currentConfig.toolFilterConfig
        ),
        defaultProjectNumber: resolvedDefaultProj,
        defaultWorkspaceId:
            execWorkspaceId ?? serverOptions.defaultWorkspaceId ?? briefingConfig.defaultWorkspaceId,
        projectRegistry: effectiveRegistry,
        briefingConfig,
    }
    return customToolHandlerConfig
}

async function cleanupExecResources(context: ServerContext): Promise<void> {
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
    await flushAgentIssues().catch(() => undefined)
    try {
        disposeCodemodeResources()
    } catch {
        // best-effort codemode worker teardown
    }
    await teardownVectorManagers(context.runtime)
    try {
        closeServerResources([context.db, context.testDb, context.teamDb, context.testTeamDb])
    } catch {
        // best-effort db close
    }
    try {
        closeCrossTeamAdapters()
    } catch {
        // best-effort cross-team db close
    }
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
        const execProjectNumber =
            options.defaultProject ??
            (execWorkspaceId !== undefined ? customToolHandlerConfig.defaultProjectNumber : undefined)
        const result = await callTool(
            'mj_execute_code',
            {
                code: scriptContent,
                ...(execWorkspaceId !== undefined ? { workspace_id: execWorkspaceId } : {}),
                ...(execProjectNumber !== undefined ? { project_number: execProjectNumber } : {}),
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
        process.stderr.write(`Execution failed: ${formatCliError(error)}\n`)
        exitCode = 1
    } finally {
        await cleanupExecResources(context)
    }
    process.exit(exitCode)
}
