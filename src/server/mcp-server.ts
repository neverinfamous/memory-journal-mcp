/**
 * Memory Journal MCP Server - Main Server
 *
 * MCP server implementation with tools, resources, and prompts.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { DatabaseAdapterFactory } from '../database/adapter-factory.js'
import { VectorSearchManager } from '../vector/vector-search-manager.js'
import { GitHubIntegration } from '../github/github-integration/index.js'
import { logger } from '../utils/logger.js'
import {
    parseToolFilter,
    getToolFilterFromEnv,
    getFilterSummary,
    type ToolFilterConfig,
} from '../filtering/tool-filter.js'
import { getTools, callTool } from '../handlers/tools/index.js'
import { getResources, readResource } from '../handlers/resources/index.js'
import { getPrompts, getPrompt } from '../handlers/prompts/index.js'
import { generateInstructions } from '../constants/server-instructions.js'
import { Scheduler, type SchedulerOptions } from './scheduler.js'
import { HttpTransport } from '../transports/http/index.js'
import { setDefaultSandboxMode, type SandboxMode } from '../codemode/index.js'
import { DEFAULT_BRIEFING_CONFIG, type BriefingConfig } from '../handlers/resources/shared.js'
import pkg from '../../package.json' with { type: 'json' }

export interface ServerOptions {
    transport: 'stdio' | 'http'
    port?: number
    host?: string
    dbPath: string
    teamDbPath?: string
    toolFilter?: string
    defaultProjectNumber?: number
    autoRebuildIndex?: boolean
    statelessHttp?: boolean
    corsOrigins?: string[]
    authToken?: string
    scheduler?: SchedulerOptions
    sandboxMode?: SandboxMode
    // OAuth 2.1 options
    oauthEnabled?: boolean
    oauthIssuer?: string
    oauthAudience?: string
    oauthJwksUri?: string
    oauthClockTolerance?: number
    // Briefing configuration
    briefingConfig?: BriefingConfig
}

/**
 * Create and start the MCP server
 */
export async function createServer(options: ServerOptions): Promise<void> {
    const { transport, dbPath, teamDbPath, toolFilter, defaultProjectNumber } = options

    // Configure sandbox mode for Code Mode
    if (options.sandboxMode) {
        setDefaultSandboxMode(options.sandboxMode)
        logger.info('Code Mode sandbox configured', {
            module: 'McpServer',
            sandboxMode: options.sandboxMode,
        })
    }

    // Initialize database
    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    logger.info('Database initialized', { module: 'McpServer', dbPath })

    // Initialize team database if configured
    let teamDb: IDatabaseAdapter | undefined
    if (teamDbPath) {
        teamDb = await DatabaseAdapterFactory.create(teamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        logger.info('Team database initialized', { module: 'McpServer', teamDbPath })
    }

    // Initialize vector search manager (lazy loading - model loads on first use)
    const vectorManager = new VectorSearchManager(db)
    logger.info('Vector search manager created (lazy initialization)', { module: 'McpServer' })

    // Auto-rebuild vector index if enabled
    if (options.autoRebuildIndex) {
        logger.info('Auto-rebuilding vector index on startup...', { module: 'McpServer' })
        await vectorManager.initialize()
        const count = await vectorManager.rebuildIndex(db)
        logger.info('Vector index rebuilt on startup', {
            module: 'McpServer',
            entriesIndexed: count,
        })
    }

    // Initialize GitHub integration
    const github = new GitHubIntegration()
    logger.info('GitHub integration initialized', {
        module: 'McpServer',
        hasToken: github.isApiAvailable(),
    })

    // Parse tool filter
    let filterConfig: ToolFilterConfig | null = null
    if (toolFilter) {
        filterConfig = parseToolFilter(toolFilter)
        logger.info('Tool filter applied', {
            module: 'McpServer',
            summary: getFilterSummary(filterConfig),
        })
    } else {
        filterConfig = getToolFilterFromEnv()
        if (filterConfig) {
            logger.info('Tool filter from env', {
                module: 'McpServer',
                summary: getFilterSummary(filterConfig),
            })
        }
    }

    // Get resources and prompts for instruction generation
    const resources = getResources()
    const prompts = getPrompts()

    // Fetch latest entry for initial briefing context
    const recentEntries = db.getRecentEntries(1)
    const latestEntry = recentEntries[0]
        ? {
              id: recentEntries[0].id,
              timestamp: recentEntries[0].timestamp,
              entryType: recentEntries[0].entryType,
              content: recentEntries[0].content,
          }
        : undefined

    // Get all tools once (unfiltered) for both instruction generation and registration
    const allTools = getTools(db, null, vectorManager, github, { defaultProjectNumber }, teamDb)
    const allToolNames = new Set(allTools.map((t) => t.name))

    // Generate dynamic instructions based on enabled tools, prompts, and latest entry
    const instructions = generateInstructions(
        filterConfig?.enabledTools ?? allToolNames,
        prompts.map((p) => {
            const prompt = p as { name: string; description?: string }
            return { name: prompt.name, description: prompt.description }
        }),
        latestEntry
    )

    // Create MCP server with capabilities and instructions
    const server = new McpServer(
        {
            name: 'memory-journal-mcp',
            version: pkg.version,
        },
        {
            capabilities: {
                logging: {},
            },
            instructions,
        }
    )

    // Apply filter to get the set of tools to register
    const tools = filterConfig
        ? getTools(db, filterConfig, vectorManager, github, { defaultProjectNumber }, teamDb)
        : allTools
    for (const tool of tools) {
        // Build tool options matching MCP SDK expectations
        const toolOptions: Record<string, unknown> = {
            description: tool.description,
        }

        if (tool.inputSchema !== undefined) {
            toolOptions['inputSchema'] = tool.inputSchema
        }

        // MCP 2025-11-25: Pass outputSchema for structured responses
        if (tool.outputSchema !== undefined) {
            toolOptions['outputSchema'] = tool.outputSchema
        }

        if (tool.annotations !== undefined) {
            toolOptions['annotations'] = tool.annotations
        }

        // MCP 2025-11-25: Pass icons for visual representation
        if (tool.icons) {
            toolOptions['icons'] = tool.icons
        }

        // Capture whether this tool has outputSchema for response handling
        const hasOutputSchema = Boolean(tool.outputSchema)

        server.registerTool(
            tool.name,
            toolOptions as {
                description?: string
                inputSchema?: z.ZodType
                outputSchema?: z.ZodType
            },
            async (args, extra) => {
                try {
                    // Build progress context for progress notifications
                    // Extract progressToken from extra._meta (SDK passes RequestHandlerExtra)
                    const extraMeta = extra as { _meta?: { progressToken?: string | number } }
                    const progressToken = extraMeta?._meta?.progressToken
                    const progressContext =
                        progressToken !== undefined
                            ? { server: server.server, progressToken }
                            : undefined

                    const result = await callTool(
                        tool.name,
                        args as Record<string, unknown>,
                        db,
                        vectorManager,
                        github,
                        { defaultProjectNumber },
                        progressContext,
                        teamDb
                    )

                    // MCP 2025-11-25: If tool has outputSchema, return both:
                    // - structuredContent: validated JSON for clients that support it
                    // - content: formatted text fallback for clients that don't (e.g., AntiGravity)
                    if (hasOutputSchema) {
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: JSON.stringify(result, null, 2),
                                },
                            ],
                            structuredContent: result as Record<string, unknown>,
                        }
                    }

                    // Otherwise, return text content
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text:
                                    typeof result === 'string'
                                        ? result
                                        : JSON.stringify(result, null, 2),
                            },
                        ],
                    }
                } catch (error) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                            },
                        ],
                        isError: true,
                    }
                }
            }
        )
    }

    // Initialize scheduler (HTTP/SSE only) — must be before handleResourceRead
    // which captures scheduler in its closure.
    let scheduler: Scheduler | null = null
    if (options.scheduler) {
        const hasAnyJob =
            options.scheduler.backupIntervalMinutes > 0 ||
            options.scheduler.vacuumIntervalMinutes > 0 ||
            options.scheduler.rebuildIndexIntervalMinutes > 0

        if (hasAnyJob && transport === 'stdio') {
            logger.warning(
                'Scheduler options ignored for stdio transport (session is ephemeral). ' +
                    'Use HTTP/SSE transport for automated scheduling.',
                { module: 'Scheduler' }
            )
        } else if (hasAnyJob) {
            scheduler = new Scheduler(options.scheduler, db, vectorManager)
        }
    }

    // Resource read handler shared by template and static branches (D2 fix)
    const handleResourceRead = async (uri: URL, mimeType: string): Promise<{
        contents: { uri: string; mimeType: string; text: string; annotations?: Record<string, unknown> }[]
    }> => {
        const result = await readResource(
            uri.href,
            db,
            vectorManager,
            filterConfig,
            github,
            scheduler,
            teamDb,
            options.briefingConfig ?? DEFAULT_BRIEFING_CONFIG
        )
        const dataStr =
            typeof result.data === 'string'
                ? result.data
                : JSON.stringify(result.data, null, 2)
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType,
                    text: dataStr,
                    ...(result.annotations ? { annotations: result.annotations } : {}),
                },
            ],
        }
    }

    // Register resources (reusing resources from instruction generation)
    for (const resource of resources) {
        const resDef = resource as {
            uri: string
            name: string
            description?: string
            mimeType?: string
            icons?: { src: string; mimeType?: string; sizes?: string[] }[]
        }
        const mimeType = resDef.mimeType ?? 'application/json'
        const meta = {
            description: resDef.description ?? '',
            mimeType,
            ...(resDef.icons ? { icons: resDef.icons } : {}),
        }

        // Check if this is a template URI (contains {variable} patterns)
        const isTemplate = resDef.uri.includes('{')

        if (isTemplate) {
            const template = new ResourceTemplate(
                resDef.uri,
                { list: undefined }
            )
            server.registerResource(
                resDef.name,
                template,
                meta,
                async (uri: URL, _variables: Variables) => handleResourceRead(uri, mimeType)
            )
        } else {
            server.registerResource(
                resDef.name,
                resDef.uri,
                meta,
                async (uri: URL) => handleResourceRead(uri, mimeType)
            )
        }
    }

    // Register prompts (reusing prompts from instruction generation)
    for (const prompt of prompts) {
        const promptDef = prompt as {
            name: string
            description?: string
            arguments?: { name: string; description: string; required?: boolean }[]
            icons?: { src: string; mimeType?: string; sizes?: string[] }[] // MCP 2025-11-25
        }

        // Build Zod schema from prompt.arguments definitions
        // Only create argsSchema when there are actual arguments; passing an empty
        // shape causes the SDK to wrap it in z.object({}) which rejects undefined
        // when the client omits arguments (e.g. session-summary with no args).
        let argsSchema: Record<string, z.ZodType> | undefined
        if (promptDef.arguments && promptDef.arguments.length > 0) {
            argsSchema = {}
            for (const arg of promptDef.arguments) {
                argsSchema[arg.name] =
                    arg.required === true
                        ? z.string().describe(arg.description)
                        : z.string().optional().describe(arg.description)
            }
        }

        server.registerPrompt(
            promptDef.name,
            {
                description: promptDef.description ?? '',
                ...(argsSchema ? { argsSchema } : {}),
                ...(promptDef.icons ? { icons: promptDef.icons } : {}),
            },
            (providedArgs) => {
                const args = providedArgs as Record<string, string>
                const promptResult = getPrompt(promptDef.name, args, db)
                // Map to MCP SDK expected format
                const result = {
                    messages: promptResult.messages.map((m) => ({
                        role: m.role as 'user' | 'assistant',
                        content: m.content as { type: 'text'; text: string },
                    })),
                }
                return Promise.resolve(result)
            }
        )
    }


    // Start server based on transport
    if (transport === 'stdio') {
        const stdioTransport = new StdioServerTransport()
        await server.connect(stdioTransport)
        logger.info('MCP server started on stdio', { module: 'McpServer' })

        // Handle shutdown for stdio
        process.on('SIGINT', () => {
            logger.info('Shutting down...', { module: 'McpServer' })
            db.close()
            teamDb?.close()
            process.exit(0)
        })
    } else {
        // HTTP transport
        const port = options.port ?? 3000
        const host = options.host ?? 'localhost'
        const corsRaw = process.env['MCP_CORS_ORIGIN'] ?? '*'
        const corsOrigins = options.corsOrigins ?? corsRaw.split(',').map((s) => s.trim())
        const authToken = options.authToken ?? process.env['MCP_AUTH_TOKEN'] ?? undefined

        const httpTransport = new HttpTransport({
            port,
            host,
            corsOrigins,
            stateless: options.statelessHttp === true,
            authToken,
            oauthEnabled: options.oauthEnabled,
            oauthIssuer: options.oauthIssuer,
            oauthAudience: options.oauthAudience,
            oauthJwksUri: options.oauthJwksUri,
            oauthClockTolerance: options.oauthClockTolerance,
        })

        await httpTransport.start(server, scheduler)

        // Handle shutdown
        process.on('SIGINT', () => {
            void (async () => {
                await httpTransport.stop(scheduler)
                db.close()
                teamDb?.close()
                process.exit(0)
            })()
        })
    }
}

export type { IDatabaseAdapter as SqliteAdapter }
