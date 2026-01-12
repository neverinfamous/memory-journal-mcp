/**
 * Memory Journal MCP Server - Main Server
 * 
 * MCP server implementation with tools, resources, and prompts.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { SqliteAdapter } from '../database/SqliteAdapter.js';
import { VectorSearchManager } from '../vector/VectorSearchManager.js';
import { GitHubIntegration } from '../github/GitHubIntegration.js';
import { logger } from '../utils/logger.js';
import {
    parseToolFilter,
    getToolFilterFromEnv,
    getFilterSummary,
    type ToolFilterConfig
} from '../filtering/ToolFilter.js';
import { getTools, callTool } from '../handlers/tools/index.js';
import { getResources, readResource } from '../handlers/resources/index.js';
import { getPrompts, getPrompt } from '../handlers/prompts/index.js';
import { generateInstructions } from '../constants/ServerInstructions.js';

export interface ServerOptions {
    transport: 'stdio' | 'http';
    port?: number;
    dbPath: string;
    toolFilter?: string;
}

/**
 * Create and start the MCP server
 */
export async function createServer(options: ServerOptions): Promise<void> {
    const { transport, dbPath, toolFilter } = options;

    // Initialize database (async for sql.js)
    const db = new SqliteAdapter(dbPath);
    await db.initialize();
    logger.info('Database initialized', { module: 'McpServer', dbPath });

    // Initialize vector search manager (lazy loading - model loads on first use)
    const vectorManager = new VectorSearchManager(dbPath);
    logger.info('Vector search manager created (lazy initialization)', { module: 'McpServer' });

    // Initialize GitHub integration
    const github = new GitHubIntegration();
    logger.info('GitHub integration initialized', { module: 'McpServer', hasToken: github.isApiAvailable() });

    // Parse tool filter
    let filterConfig: ToolFilterConfig | null = null;
    if (toolFilter) {
        filterConfig = parseToolFilter(toolFilter);
        logger.info('Tool filter applied', {
            module: 'McpServer',
            summary: getFilterSummary(filterConfig)
        });
    } else {
        filterConfig = getToolFilterFromEnv();
        if (filterConfig) {
            logger.info('Tool filter from env', {
                module: 'McpServer',
                summary: getFilterSummary(filterConfig)
            });
        }
    }

    // Get resources and prompts for instruction generation
    const resources = getResources();
    const prompts = getPrompts();

    // Generate dynamic instructions based on enabled tools, resources, and prompts
    const instructions = generateInstructions(
        filterConfig?.enabledTools ?? new Set(getTools(db, null, vectorManager, github).map(t => (t as { name: string }).name)),
        resources.map(r => {
            const res = r as { uri: string; name: string; description?: string };
            return { uri: res.uri, name: res.name, description: res.description };
        }),
        prompts.map(p => {
            const prompt = p as { name: string; description?: string };
            return { name: prompt.name, description: prompt.description };
        })
    );

    // Create MCP server with capabilities and instructions
    const server = new McpServer(
        {
            name: 'memory-journal-mcp',
            version: '3.1.2',
        },
        {
            capabilities: {
                logging: {}
            },
            instructions
        }
    );

    // Get filtered tools and register them dynamically
    const tools = getTools(db, filterConfig, vectorManager, github);
    for (const tool of tools) {
        const toolDef = tool as {
            name: string;
            description?: string;
            inputSchema?: z.ZodType;
            annotations?: Record<string, unknown>;
        };

        // Build tool options matching MCP SDK expectations
        const toolOptions: Record<string, unknown> = {
            description: toolDef.description ?? '',
        };

        if (toolDef.inputSchema) {
            toolOptions['inputSchema'] = toolDef.inputSchema;
        }

        if (toolDef.annotations) {
            toolOptions['annotations'] = toolDef.annotations;
        }

        server.registerTool(
            toolDef.name,
            toolOptions as { description?: string; inputSchema?: z.ZodType },
            async (args: unknown) => {
                try {
                    const result = await callTool(toolDef.name, args as Record<string, unknown>, db, vectorManager, github);
                    return {
                        content: [{
                            type: 'text' as const,
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        }],
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                        isError: true,
                    };
                }
            }
        );
    }

    // Register resources (reusing resources from instruction generation)
    for (const resource of resources) {
        const resDef = resource as { uri: string; name: string; description?: string; mimeType?: string };

        // Check if this is a template URI (contains {variable} patterns)
        const isTemplate = resDef.uri.includes('{');

        if (isTemplate) {
            // Use ResourceTemplate for parametrized URIs
            const template = new ResourceTemplate(
                resDef.uri,
                { list: undefined }  // No enumeration support needed
            );
            server.registerResource(
                resDef.name,
                template,
                { description: resDef.description ?? '', mimeType: resDef.mimeType ?? 'application/json' },
                async (uri: URL, _variables: Variables) => {
                    const result = await readResource(uri.href, db, vectorManager, filterConfig, github);
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: resDef.mimeType ?? 'application/json',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        }],
                    };
                }
            );
        } else {
            server.registerResource(
                resDef.name,
                resDef.uri,
                { description: resDef.description ?? '', mimeType: resDef.mimeType ?? 'application/json' },
                async (uri: URL) => {
                    const result = await readResource(uri.href, db, vectorManager, filterConfig, github);
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: resDef.mimeType ?? 'application/json',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        }],
                    };
                }
            );
        }
    }

    // Register prompts (reusing prompts from instruction generation)
    for (const prompt of prompts) {
        const promptDef = prompt as {
            name: string;
            description?: string;
            arguments?: { name: string; description: string; required?: boolean }[];
        };

        // Build Zod schema from prompt.arguments definitions
        const zodShape: Record<string, z.ZodType> = {};
        if (promptDef.arguments) {
            for (const arg of promptDef.arguments) {
                zodShape[arg.name] = arg.required === true
                    ? z.string().describe(arg.description)
                    : z.string().optional().describe(arg.description);
            }
        }

        server.registerPrompt(
            promptDef.name,
            {
                description: promptDef.description ?? '',
                argsSchema: zodShape
            },
            (providedArgs) => {
                const args = providedArgs as Record<string, string>;
                const promptResult = getPrompt(promptDef.name, args, db);
                // Map to MCP SDK expected format
                const result = {
                    messages: promptResult.messages.map(m => ({
                        role: m.role as 'user' | 'assistant',
                        content: m.content as { type: 'text'; text: string }
                    }))
                };
                return Promise.resolve(result);
            }
        );
    }

    // Start server based on transport
    if (transport === 'stdio') {
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);
        logger.info('MCP server started on stdio', { module: 'McpServer' });
    } else {
        // HTTP transport - TODO: implement SSE transport
        throw new Error('HTTP transport not yet implemented');
    }

    // Handle shutdown
    process.on('SIGINT', () => {
        logger.info('Shutting down...', { module: 'McpServer' });
        db.close();
        process.exit(0);
    });
}

export { SqliteAdapter };
