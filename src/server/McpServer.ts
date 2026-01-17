/**
 * Memory Journal MCP Server - Main Server
 *
 * MCP server implementation with tools, resources, and prompts.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Express, Request, Response } from 'express'
import { z } from 'zod'

import { SqliteAdapter } from '../database/SqliteAdapter.js'
import { VectorSearchManager } from '../vector/VectorSearchManager.js'
import { GitHubIntegration } from '../github/GitHubIntegration.js'
import { logger } from '../utils/logger.js'
import {
    parseToolFilter,
    getToolFilterFromEnv,
    getFilterSummary,
    type ToolFilterConfig,
} from '../filtering/ToolFilter.js'
import { getTools, callTool } from '../handlers/tools/index.js'
import { getResources, readResource } from '../handlers/resources/index.js'
import { getPrompts, getPrompt } from '../handlers/prompts/index.js'
import { generateInstructions } from '../constants/ServerInstructions.js'
import pkg from '../../package.json' with { type: 'json' }

export interface ServerOptions {
    transport: 'stdio' | 'http'
    port?: number
    dbPath: string
    toolFilter?: string
    defaultProjectNumber?: number
    autoRebuildIndex?: boolean
}

/**
 * Create and start the MCP server
 */
export async function createServer(options: ServerOptions): Promise<void> {
    const { transport, dbPath, toolFilter, defaultProjectNumber } = options

    // Initialize database (async for sql.js)
    const db = new SqliteAdapter(dbPath)
    await db.initialize()
    logger.info('Database initialized', { module: 'McpServer', dbPath })

    // Initialize vector search manager (lazy loading - model loads on first use)
    const vectorManager = new VectorSearchManager(dbPath)
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

    // Generate dynamic instructions based on enabled tools, resources, prompts, and latest entry
    const instructions = generateInstructions(
        filterConfig?.enabledTools ??
            new Set(
                getTools(db, null, vectorManager, github, { defaultProjectNumber }).map(
                    (t) => (t as { name: string }).name
                )
            ),
        resources.map((r) => {
            const res = r as { uri: string; name: string; description?: string }
            return { uri: res.uri, name: res.name, description: res.description }
        }),
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

    // Get filtered tools and register them dynamically
    const tools = getTools(db, filterConfig, vectorManager, github, { defaultProjectNumber })
    for (const tool of tools) {
        const toolDef = tool as {
            name: string
            description?: string
            inputSchema?: z.ZodType
            outputSchema?: z.ZodType // MCP 2025-11-25
            annotations?: Record<string, unknown>
            icons?: { src: string; mimeType?: string; sizes?: string[] }[] // MCP 2025-11-25
        }

        // Build tool options matching MCP SDK expectations
        const toolOptions: Record<string, unknown> = {
            description: toolDef.description ?? '',
        }

        if (toolDef.inputSchema) {
            toolOptions['inputSchema'] = toolDef.inputSchema
        }

        // MCP 2025-11-25: Pass outputSchema for structured responses
        if (toolDef.outputSchema) {
            toolOptions['outputSchema'] = toolDef.outputSchema
        }

        if (toolDef.annotations) {
            toolOptions['annotations'] = toolDef.annotations
        }

        // MCP 2025-11-25: Pass icons for visual representation
        if (toolDef.icons) {
            toolOptions['icons'] = toolDef.icons
        }

        // Capture whether this tool has outputSchema for response handling
        const hasOutputSchema = Boolean(toolDef.outputSchema)

        server.registerTool(
            toolDef.name,
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
                        toolDef.name,
                        args as Record<string, unknown>,
                        db,
                        vectorManager,
                        github,
                        { defaultProjectNumber },
                        progressContext
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

    // Register resources (reusing resources from instruction generation)
    for (const resource of resources) {
        const resDef = resource as {
            uri: string
            name: string
            description?: string
            mimeType?: string
            icons?: { src: string; mimeType?: string; sizes?: string[] }[] // MCP 2025-11-25
        }

        // Check if this is a template URI (contains {variable} patterns)
        const isTemplate = resDef.uri.includes('{')

        if (isTemplate) {
            // Use ResourceTemplate for parametrized URIs
            const template = new ResourceTemplate(
                resDef.uri,
                { list: undefined } // No enumeration support needed
            )
            server.registerResource(
                resDef.name,
                template,
                {
                    description: resDef.description ?? '',
                    mimeType: resDef.mimeType ?? 'application/json',
                    ...(resDef.icons ? { icons: resDef.icons } : {}),
                },
                async (uri: URL, _variables: Variables) => {
                    const result = await readResource(
                        uri.href,
                        db,
                        vectorManager,
                        filterConfig,
                        github
                    )
                    const dataStr =
                        typeof result.data === 'string'
                            ? result.data
                            : JSON.stringify(result.data, null, 2)
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: resDef.mimeType ?? 'application/json',
                                text: dataStr,
                                // Include MCP 2025-11-25 annotations if provided
                                ...(result.annotations ? { annotations: result.annotations } : {}),
                            },
                        ],
                    }
                }
            )
        } else {
            server.registerResource(
                resDef.name,
                resDef.uri,
                {
                    description: resDef.description ?? '',
                    mimeType: resDef.mimeType ?? 'application/json',
                    ...(resDef.icons ? { icons: resDef.icons } : {}),
                },
                async (uri: URL) => {
                    const result = await readResource(
                        uri.href,
                        db,
                        vectorManager,
                        filterConfig,
                        github
                    )
                    const dataStr =
                        typeof result.data === 'string'
                            ? result.data
                            : JSON.stringify(result.data, null, 2)
                    return {
                        contents: [
                            {
                                uri: uri.href,
                                mimeType: resDef.mimeType ?? 'application/json',
                                text: dataStr,
                                // Include MCP 2025-11-25 annotations if provided
                                ...(result.annotations ? { annotations: result.annotations } : {}),
                            },
                        ],
                    }
                }
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
        const zodShape: Record<string, z.ZodType> = {}
        if (promptDef.arguments) {
            for (const arg of promptDef.arguments) {
                zodShape[arg.name] =
                    arg.required === true
                        ? z.string().describe(arg.description)
                        : z.string().optional().describe(arg.description)
            }
        }

        server.registerPrompt(
            promptDef.name,
            {
                description: promptDef.description ?? '',
                argsSchema: zodShape,
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
            process.exit(0)
        })
    } else {
        // HTTP transport with SSE support
        const port = options.port ?? 3000
        const app: Express = createMcpExpressApp()

        // Session transport storage
        const transports = new Map<string, StreamableHTTPServerTransport>()

        // POST /mcp - Handle JSON-RPC requests
        app.post('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            void (async () => {
                try {
                    let httpTransport: StreamableHTTPServerTransport | undefined

                    if (sessionId && transports.has(sessionId)) {
                        // Reuse existing transport
                        httpTransport = transports.get(sessionId)
                    } else if (sessionId === undefined && isInitializeRequest(req.body)) {
                        // New initialization request - create transport
                        const newTransport = new StreamableHTTPServerTransport({
                            sessionIdGenerator: () => randomUUID(),
                            onsessioninitialized: (sid: string) => {
                                logger.info('HTTP session initialized', {
                                    module: 'McpServer',
                                    sessionId: sid,
                                })
                                transports.set(sid, newTransport)
                            },
                        })

                        // Clean up on transport close
                        newTransport.onclose = () => {
                            const sid = newTransport.sessionId
                            if (sid !== undefined && transports.has(sid)) {
                                logger.info('HTTP transport closed', {
                                    module: 'McpServer',
                                    sessionId: sid,
                                })
                                transports.delete(sid)
                            }
                        }

                        // Connect transport to server before handling request
                        await server.connect(newTransport)
                        await newTransport.handleRequest(
                            req as unknown as IncomingMessage,
                            res as unknown as ServerResponse,
                            req.body as unknown
                        )
                        return
                    } else {
                        // Invalid request - no session ID or not initialization
                        res.status(400).json({
                            jsonrpc: '2.0',
                            error: {
                                code: -32000,
                                message: 'Bad Request: No valid session ID provided',
                            },
                            id: null,
                        })
                        return
                    }

                    // Handle request with existing transport
                    if (httpTransport !== undefined) {
                        await httpTransport.handleRequest(
                            req as unknown as IncomingMessage,
                            res as unknown as ServerResponse,
                            req.body as unknown
                        )
                    }
                } catch (error) {
                    logger.error('Error handling MCP request', {
                        module: 'McpServer',
                        error: error instanceof Error ? error.message : String(error),
                    })
                    if (!res.headersSent) {
                        res.status(500).json({
                            jsonrpc: '2.0',
                            error: { code: -32603, message: 'Internal server error' },
                            id: null,
                        })
                    }
                }
            })()
        })

        // GET /mcp - SSE stream for server-to-client notifications
        app.get('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            if (sessionId === undefined || !transports.has(sessionId)) {
                res.status(400).send('Invalid or missing session ID')
                return
            }

            const lastEventId = req.headers['last-event-id']
            if (lastEventId !== undefined) {
                logger.debug('Client reconnecting with Last-Event-ID', {
                    module: 'McpServer',
                    sessionId,
                    lastEventId,
                })
            }

            const httpTransport = transports.get(sessionId)
            if (httpTransport !== undefined) {
                void httpTransport.handleRequest(
                    req as unknown as IncomingMessage,
                    res as unknown as ServerResponse
                )
            }
        })

        // DELETE /mcp - Session termination
        app.delete('/mcp', (req: Request, res: Response): void => {
            const sessionId = req.headers['mcp-session-id'] as string | undefined

            if (sessionId === undefined || !transports.has(sessionId)) {
                res.status(400).send('Invalid or missing session ID')
                return
            }

            logger.info('Session termination requested', {
                module: 'McpServer',
                sessionId,
            })

            const httpTransport = transports.get(sessionId)
            if (httpTransport !== undefined) {
                void httpTransport.handleRequest(
                    req as unknown as IncomingMessage,
                    res as unknown as ServerResponse
                )
            }
        })

        // Start HTTP server
        app.listen(port, () => {
            logger.info('MCP server started on HTTP', {
                module: 'McpServer',
                port,
                endpoint: `http://localhost:${port}/mcp`,
            })
        })

        // Handle shutdown for HTTP
        process.on('SIGINT', () => {
            logger.info('Shutting down HTTP server...', { module: 'McpServer' })

            void (async () => {
                // Close all active transports
                for (const [sessionId, httpTransport] of transports) {
                    try {
                        logger.debug('Closing transport', { module: 'McpServer', sessionId })
                        await httpTransport.close()
                    } catch (error) {
                        logger.error('Error closing transport', {
                            module: 'McpServer',
                            sessionId,
                            error: error instanceof Error ? error.message : String(error),
                        })
                    }
                }
                transports.clear()

                db.close()
                logger.info('Shutdown complete', { module: 'McpServer' })
                process.exit(0)
            })()
        })
    }
}

export { SqliteAdapter }
