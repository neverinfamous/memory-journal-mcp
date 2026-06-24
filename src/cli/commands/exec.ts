import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import { initializeDependencies } from '../../server/mcp-server/initialization.js'
import { callTool } from '../../handlers/tools/index.js'
import { globalSubscriptionManager } from '../../server/subscription-manager.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'

export async function execAction(scriptPath: string, options: Record<string, unknown>, command: Command): Promise<void> {
    let resolver: ConfigResolver
    const configPath = (options['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
    
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    // Override test databases for exec so it doesn't try to eagerly initialize them without encryption keys
    serverOptions.testDbPath = undefined
    serverOptions.testTeamDbPath = undefined

    const scriptContent = readFileSync(scriptPath, 'utf8')

    const context = await initializeDependencies(serverOptions)
    const { 
        db, teamDb, runtime, vectorManager, teamVectorManager, 
        github, configManager, allowedIoRoots 
    } = context

    const filterConfig = configManager.getConfig().toolFilterConfig
    const baseConfig: ToolHandlerConfig = {
        defaultProjectNumber: serverOptions.defaultProjectNumber,
        defaultWorkspaceId: serverOptions.defaultWorkspaceId,
        projectRegistry: serverOptions.projectRegistry,
        additionalTeamDbs: serverOptions.additionalTeamDbs,
        allowedIoRoots,
        filterConfig,
        authEnabled: Boolean(serverOptions.authToken ?? process.env['MCP_AUTH_TOKEN']),
        oauthEnabled: serverOptions.oauthEnabled,
        codemodeEnabled: true, // Force enabled for the exec command
        codemodeInternalFullAccess: serverOptions.codemodeInternalFullAccess,
        teamDefaultRole: serverOptions.teamDefaultRole,
        teamAdmin: serverOptions.teamAdmin,
        runtime,
        subscriptionManager: globalSubscriptionManager,
    }

    const dispatch = (name: string, args: Record<string, unknown>): Promise<unknown> =>
        callTool(name, args, db, vectorManager, github, baseConfig, undefined, teamDb ?? undefined, teamVectorManager ?? undefined)

    const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig, dispatch }

    try {
        const result = await callTool(
            'mj_execute_code',
            { code: scriptContent },
            db,
            vectorManager,
            github,
            customToolHandlerConfig,
            undefined,
            teamDb ?? undefined,
            teamVectorManager ?? undefined
        )

        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } catch (error) {
        process.stderr.write("Execution failed: " + (error instanceof Error ? error.message : String(error)) + '\n')
        process.exit(1)
    } finally {
        if (runtime.auditLogger) await runtime.auditLogger.close()
        if (context.activeMetricsPath) await runtime.metrics.saveToFile(context.activeMetricsPath)
        db.close()
        teamDb?.close()
        process.exit(0)
    }
}
