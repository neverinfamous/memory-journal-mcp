/**
 * Memory Journal MCP Server - Main Server
 *
 * MCP server implementation with tools, resources, and prompts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { z } from 'zod'

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { DatabaseAdapterFactory } from '../database/adapter-factory.js'
import { VectorSearchManager } from '../vector/vector-search-manager.js'
import { getGitHubIntegration } from '../github/github-integration/index.js'
import { logger } from '../utils/logger.js'
import {
    parseToolFilter,
    getToolFilterFromEnv,
    getFilterSummary,
    getEnabledGroups,
    type ToolFilterConfig,
} from '../filtering/tool-filter.js'
import {
    getTools,
    callTool,
    initializeAuditLogger,
    getGlobalAuditLogger,
} from '../handlers/tools/index.js'
import { getRequiredScope } from '../auth/scope-map.js'
import { getResources, readResource } from '../handlers/resources/index.js'
import { getPrompts } from '../handlers/prompts/index.js'
import { generateInstructions } from '../constants/server-instructions.js'
import { Scheduler, type SchedulerOptions } from './scheduler.js'
import { HttpTransport } from '../transports/http/index.js'

import { DEFAULT_BRIEFING_CONFIG, type BriefingConfig } from '../handlers/resources/shared.js'
import type { ProjectRegistryEntry, ToolHandlerConfig } from '../types/index.js'
import type { AuditConfig } from '../audit/index.js'
import {
    registerResources,
    registerPrompts,
    type ResourceDefinition,
    type PromptDefinition,
    type ResourceReadHandler,
} from './registration.js'
import { VERSION } from '../version.js'

export type McpServerFactory = () => McpServer

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
    enableHSTS?: boolean
    scheduler?: SchedulerOptions

    // OAuth 2.1 options
    oauthEnabled?: boolean
    oauthIssuer?: string
    oauthAudience?: string
    oauthJwksUri?: string
    oauthClockTolerance?: number
    // Briefing configuration
    briefingConfig?: BriefingConfig
    // Project Registry
    projectRegistry?: Record<string, ProjectRegistryEntry>
    // Instruction level
    instructionLevel?: 'essential' | 'standard' | 'full'
    // Audit configuration
    auditConfig?: AuditConfig
    // Hush Protocol flag vocabulary
    flagVocabulary?: string[]
}

/**
 * Create and start the MCP server
 */
export async function createServer(options: ServerOptions): Promise<void> {
    const { transport, dbPath, teamDbPath, toolFilter, defaultProjectNumber } = options


    // Initialize database
    const db = await DatabaseAdapterFactory.create(dbPath)
    await db.initialize()
    logger.info('Database initialized', { module: 'McpServer', dbPath })

    // Initialize audit logging if configured
    if (options.auditConfig?.enabled) {
        initializeAuditLogger(options.auditConfig)
        logger.info('Audit logging enabled', {
            module: 'McpServer',
            path: options.auditConfig.logPath,
            redact: options.auditConfig.redact,
            auditReads: options.auditConfig.auditReads,
        })
    }

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

    // Initialize team vector search manager if team DB is configured
    let teamVectorManager: VectorSearchManager | undefined
    if (teamDb) {
        teamVectorManager = new VectorSearchManager(teamDb)
        logger.info('Team vector search manager created', { module: 'McpServer' })
    }

    // Auto-rebuild vector index if enabled
    if (options.autoRebuildIndex) {
        logger.info('Auto-rebuilding vector index on startup...', { module: 'McpServer' })
        await vectorManager.initialize()
        const { indexed: count } = await vectorManager.rebuildIndex(db)
        logger.info('Vector index rebuilt on startup', {
            module: 'McpServer',
            entriesIndexed: count,
        })
    }

    // Initialize GitHub integration
    let githubPath = '.'
    if (options.projectRegistry && Object.keys(options.projectRegistry).length > 0) {
        if (options.defaultProjectNumber !== undefined) {
            const defaultEntry = Object.values(options.projectRegistry).find(
                (r) => r.project_number === options.defaultProjectNumber
            )
            if (defaultEntry?.path) {
                githubPath = defaultEntry.path
            }
        }

        // Fallback: If no explicit default matched, use the first project in the registry
        if (githubPath === '.') {
            const firstEntry = Object.values(options.projectRegistry)[0]
            if (firstEntry?.path) {
                githubPath = firstEntry.path
            }
        }
    }
    const github = getGitHubIntegration(githubPath)
    try {
        // Pre-populate repository cache so synchronous tools (e.g. create_entry) can resolve GitHub URLs
        await github.getRepoInfo()
    } catch {
        // Ignore failing silently if not within a git repository workspace
    }

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

    // Initialize scheduler (HTTP/SSE only) — must be before handleResourceRead
    // which captures scheduler in its closure.
    let scheduler: Scheduler | null = null
    if (options.scheduler) {
        const hasAnyJob =
            options.scheduler.backupIntervalMinutes > 0 ||
            options.scheduler.vacuumIntervalMinutes > 0 ||
            options.scheduler.rebuildIndexIntervalMinutes > 0 ||
            options.scheduler.digestIntervalMinutes > 0

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

    const createServerInstance = (): McpServer => {
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
        
            const baseConfig: ToolHandlerConfig = {
                defaultProjectNumber,
                projectRegistry: options.projectRegistry,
                flagVocabulary: options.flagVocabulary,
                // SEC-1.2: Thread active filter into Code Mode so --tool-filter is enforced inside sandbox
                filterConfig,
            }

            // SEC-1.1: Build a callTool()-backed dispatcher for Code Mode.
            // Uses baseConfig (without dispatch itself) to prevent recursive self-referencing.
            const dispatch = (
                name: string,
                args: Record<string, unknown>
            ): Promise<unknown> =>
                callTool(
                    name,
                    args,
                    db,
                    vectorManager,
                    github,
                    baseConfig,
                    undefined,
                    teamDb,
                    teamVectorManager
                )

            const customToolHandlerConfig: ToolHandlerConfig = { ...baseConfig, dispatch }

            // Get all tools once (unfiltered) for both instruction generation and registration
            const allTools = getTools(
                db,
                null,
                vectorManager,
                github,
                customToolHandlerConfig,
                teamDb,
                teamVectorManager
            )
            const allToolNames = new Set(allTools.map((t) => t.name))
        
            // SECURITY CHECK: Verify all tools have an explicit scope mapping natively at startup.
            // This will crash early (fail-closed) if any new tools bypass the authorization mapping.
            for (const toolName of allToolNames) {
                getRequiredScope(toolName)
            }
        
            // Generate dynamic instructions based on enabled tools, prompts, and latest entry
            const enabledToolSet = filterConfig?.enabledTools ?? allToolNames
            const enabledGroups = filterConfig ? getEnabledGroups(filterConfig.enabledTools) : undefined
            const instructions = generateInstructions(
                enabledToolSet,
                prompts.map((p) => {
                    const prompt = p as { name: string; description?: string }
                    return { name: prompt.name, description: prompt.description }
                }),
                latestEntry,
                options.instructionLevel ?? 'standard',
                enabledGroups
            )
        
            // Create MCP server with capabilities and instructions
            const server = new McpServer(
                {
                    name: 'memory-journal-mcp',
                    version: VERSION,
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
                ? getTools(
                      db,
                      filterConfig,
                      vectorManager,
                      github,
                      customToolHandlerConfig,
                      teamDb,
                      teamVectorManager
                  )
                : allTools
            for (const tool of tools) {
                // Build tool options matching MCP SDK expectations
                const toolOptions: Record<string, unknown> = {
                    description: tool.description,
                }
        
                // MCP 2025-11-25: Pass title for human-readable display
                if (tool.title) {
                    toolOptions['title'] = tool.title
                }
        
                if (tool.inputSchema !== undefined) {
                    const schema = tool.inputSchema
                    if (
                        typeof schema === 'object' &&
                        schema !== null &&
                        'partial' in schema &&
                        typeof (schema as { partial: unknown }).partial === 'function'
                    ) {
                        // .partial() makes all fields optional so the SDK accepts `{}`.
                        // .passthrough() preserves unrecognized keys so handler can normalize.
                        // Wrapped in try/catch: if partial() returns something without passthrough()
                        // (non-ZodObject wrapper), fall back to the original schema to avoid
                        // a startup throw.
                        try {
                            const relaxed = (
                                schema as { partial: () => { passthrough?: () => z.ZodType } }
                            ).partial()
                            toolOptions['inputSchema'] =
                                typeof relaxed.passthrough === 'function' ? relaxed.passthrough() : schema
                        } catch {
                            toolOptions['inputSchema'] = schema
                        }
                    } else {
                        toolOptions['inputSchema'] = schema
                    }
                }
        
                // MCP 2025-11-25: Pass outputSchema for structured responses
                if (tool.outputSchema !== undefined) {
                    const outSchema = tool.outputSchema
                    if (
                        typeof outSchema === 'object' &&
                        outSchema !== null &&
                        'passthrough' in outSchema &&
                        typeof (outSchema as { passthrough: unknown }).passthrough === 'function'
                    ) {
                        try {
                            toolOptions['outputSchema'] = (
                                outSchema as { passthrough: () => z.ZodType }
                            ).passthrough()
                        } catch {
                            toolOptions['outputSchema'] = outSchema
                        }
                    } else {
                        toolOptions['outputSchema'] = outSchema
                    }
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
                                customToolHandlerConfig,
                                progressContext,
                                teamDb,
                                teamVectorManager
                            )
        
                            // MCP 2025-11-25: If tool has outputSchema, return both:
                            // - structuredContent: validated JSON for clients that support it
                            // - content: compact text fallback (~15-20% payload reduction per §3.1)
                            if (hasOutputSchema) {
                                // Protocol Optimization: Return structured objects natively without redundant text stringification.
                                // Emits a lightweight marker for clients that don't support structuredContent.
                                return {
                                    content: [
                                        {
                                            type: 'text' as const,
                                            text: '[Structured output attached]',
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
                            const errorMessage = error instanceof Error ? error.message : String(error)
                            const errorResult = {
                                success: false,
                                error: errorMessage,
                                code: 'INTERNAL_ERROR',
                                category: 'internal',
                                recoverable: false,
                            }
                            return {
                                content: [
                                    {
                                        type: 'text' as const,
                                        text: JSON.stringify(errorResult, null, 2),
                                    },
                                ],
                                ...(hasOutputSchema ? { structuredContent: errorResult } : {}),
                                isError: true,
                            }
                        }
                    }
                )
            }

        // Resource read handler shared by template and static branches (D2 fix)
            const handleResourceRead = async (
                uri: URL,
                mimeType: string
            ): Promise<{
                contents: {
                    uri: string
                    mimeType: string
                    text: string
                    annotations?: Record<string, unknown>
                }[]
            }> => {
                const activeBriefingConfig: typeof DEFAULT_BRIEFING_CONFIG = {
                    ...(options.briefingConfig ?? DEFAULT_BRIEFING_CONFIG),
                    // Ensure defaultProjectNumber is available to resource handlers
                    // (may come via briefingConfig from CLI, or directly from server options)
                    defaultProjectNumber:
                        options.briefingConfig?.defaultProjectNumber ?? defaultProjectNumber,
                    projectRegistry: options.projectRegistry,
                    flagVocabulary: options.flagVocabulary,
                }
                const result = await readResource(
                    uri.href,
                    db,
                    vectorManager,
                    filterConfig,
                    github,
                    scheduler,
                    teamDb,
                    activeBriefingConfig
                )
                const dataStr =
                    typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
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
            registerResources(
                server,
                resources as ResourceDefinition[],
                handleResourceRead as ResourceReadHandler
            )
        
            // Register prompts (reusing prompts from instruction generation)
            registerPrompts(server, prompts as PromptDefinition[], db, teamDb)

        return server
    }

        // Start server based on transport
    if (transport === 'stdio') {
        const stdioTransport = new StdioServerTransport()
        const server = createServerInstance()
        await server.connect(stdioTransport)
        logger.info('MCP server started on stdio', { module: 'McpServer' })

        // Handle shutdown for stdio
        process.on('SIGINT', () => {
            logger.info('Shutting down...', { module: 'McpServer' })
            // Flush audit log before exit
            const auditLogger = getGlobalAuditLogger()
            if (auditLogger) {
                void auditLogger.close()
            }
            db.close()
            teamDb?.close()
            process.exit(0)
        })
    } else {
        // HTTP transport
        const port = options.port ?? 3000
        const host = options.host ?? 'localhost'
        const corsRaw = process.env['MCP_CORS_ORIGIN']
        const corsOrigins = options.corsOrigins ?? (corsRaw ? corsRaw.split(',').map((s) => s.trim()) : [])
        const authToken = options.authToken ?? process.env['MCP_AUTH_TOKEN'] ?? undefined

        const httpTransport = new HttpTransport({
            port,
            host,
            corsOrigins,
            stateless: options.statelessHttp === true,
            authToken,
            enableHSTS: options.enableHSTS,
            oauthEnabled: options.oauthEnabled,
            oauthIssuer: options.oauthIssuer,
            oauthAudience: options.oauthAudience,
            oauthJwksUri: options.oauthJwksUri,
            oauthClockTolerance: options.oauthClockTolerance,
        })

        await httpTransport.start(createServerInstance, scheduler)

        // Handle shutdown
        process.on('SIGINT', () => {
            void (async () => {
                await httpTransport.stop(scheduler)
                // Flush audit log before exit
                const auditLogger = getGlobalAuditLogger()
                if (auditLogger) {
                    await auditLogger.close()
                }
                db.close()
                teamDb?.close()
                process.exit(0)
            })()
        })
    }
}

export type { IDatabaseAdapter as SqliteAdapter }
