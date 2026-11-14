import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { initializeDependencies } from '../../server/mcp-server/initialization.js'
import { resolveActiveBriefingConfig } from '../../server/mcp-server/tool-registration/register-tools-helpers.js'
import { callTool } from '../../handlers/tools/index.js'
import { globalSubscriptionManager } from '../../server/subscription-manager.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'
import { type z } from 'zod'
import { execOptionsSchema } from '../schemas.js'

export const execSchema = execOptionsSchema

export async function execAction(scriptPath: string, options: z.infer<typeof execSchema>, command: Command): Promise<void> {
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

    if (options.workspace?.trim() === '*' || options.defaultWorkspaceId?.trim() === '*') {
        configErrors.push("Wildcard '*' is not allowed for --workspace or --default-workspace-id.")
    }

    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    if (options.dumpConfig === true) {
        dumpConfigAndExit(serverOptions)
    }

    // Override config-sourced test databases for exec unless explicitly passed on the CLI
    if (options.testDb === undefined) {
        serverOptions.testDbPath = undefined
    }
    if (options.testTeamDb === undefined) {
        serverOptions.testTeamDbPath = undefined
    }

    const scriptContent = readFileSync(scriptPath, 'utf8')

    const context = await initializeDependencies(serverOptions)
    const { 
        db, teamDb, runtime, vectorManager, teamVectorManager, 
        github, configManager, allowedIoRoots 
    } = context

    const currentConfig = configManager.getConfig()
    const filterConfig = currentConfig.toolFilterConfig
    const briefingConfig = resolveActiveBriefingConfig(
        currentConfig.briefingConfig,
        serverOptions,
        allowedIoRoots
    )
    const baseConfig: ToolHandlerConfig = {
        defaultProjectNumber:
            serverOptions.defaultProjectNumber ?? briefingConfig.defaultProjectNumber,
        defaultWorkspaceId:
            options.workspace ??
            serverOptions.defaultWorkspaceId ??
            briefingConfig.defaultWorkspaceId,
        projectRegistry: serverOptions.projectRegistry ?? briefingConfig.projectRegistry,
        additionalTeamDbs: serverOptions.additionalTeamDbs,
        allowedIoRoots,
        filterConfig,
        authEnabled: Boolean(serverOptions.authToken ?? process.env['MCP_AUTH_TOKEN']),
        oauthEnabled: serverOptions.oauthEnabled,
        codemodeEnabled: true, // Force enabled for the exec command
        codemodeInternalFullAccess: serverOptions.codemodeInternalFullAccess,
        agentHealing: serverOptions.agentHealing,
        teamDefaultRole: serverOptions.teamDefaultRole,
        teamAdmin: serverOptions.teamAdmin,
        briefingConfig,
        runtime,
        subscriptionManager: globalSubscriptionManager,
    }

    const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig }
    const dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
        callTool(name, args, db, vectorManager, github, customToolHandlerConfig, undefined, teamDb ?? undefined, teamVectorManager ?? undefined)
    customToolHandlerConfig.dispatch = dispatch

    const execWorkspaceId =
        options.workspace !== undefined && options.workspace.trim() !== ''
            ? options.workspace.trim()
            : undefined
    let exitCode = 0
    try {
        const result = await callTool(
            'mj_execute_code',
            {
                code: scriptContent,
                ...(execWorkspaceId !== undefined ? { workspace_id: execWorkspaceId } : {}),
                ...(options.defaultProject !== undefined
                    ? { project_number: options.defaultProject }
                    : {}),
            },
            db,
            vectorManager,
            github,
            customToolHandlerConfig,
            undefined,
            teamDb ?? undefined,
            teamVectorManager ?? undefined
        )
        if (
            typeof result === 'object' &&
            result !== null &&
            'success' in result &&
            result.success === false
        ) {
            exitCode = 1
        }

        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (error) {
        process.stderr.write("Execution failed: " + (error instanceof Error ? error.message : String(error)) + '\n')
        exitCode = 1
    } finally {
        runtime.stopBackgroundTasks?.()
        configManager.close()
        if (runtime.auditLogger) await runtime.auditLogger.close()
        if (context.activeMetricsPath) await runtime.metrics.saveToFile(context.activeMetricsPath)
        db.close()
        teamDb?.close()
    }
    process.exit(exitCode)
}
