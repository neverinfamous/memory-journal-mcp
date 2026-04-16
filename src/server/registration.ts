/**
 * MCP Server Registration Helpers
 *
 * Extracted from mcp-server.ts to keep it under 500 lines.
 * Handles resource and prompt registration with the MCP SDK.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import { z } from 'zod'

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { getPrompt } from '../handlers/prompts/index.js'
import { getGlobalAuditLogger } from '../handlers/tools/index.js'
import { auditOperation } from '../audit/interceptor.js'
import type { ServerRuntime } from '../utils/maintenance-lock.js'

// ============================================================================
// Types
// ============================================================================

/** Raw resource definition from getResources() */
export interface ResourceDefinition {
    uri: string
    name: string
    description?: string
    mimeType?: string
    icons?: { src: string; mimeType?: string; sizes?: string[] }[]
}

/** Raw prompt definition from getPrompts() */
export interface PromptDefinition {
    name: string
    description?: string
    arguments?: { name: string; description: string; required?: boolean }[]
    icons?: { src: string; mimeType?: string; sizes?: string[] }[]
}

/** Callback that reads a resource by URI and returns structured content. */
export type ResourceReadHandler = (
    uri: URL,
    mimeType: string
) => Promise<{
    contents: {
        uri: string
        mimeType: string
        text: string
        annotations?: Record<string, unknown>
    }[]
}>

// ============================================================================
// Resource Registration
// ============================================================================

/**
 * Register all resources with the MCP server.
 *
 * Handles both static URIs and template URIs (containing `{variable}` patterns).
 */
export function registerResources(
    server: McpServer,
    resources: ResourceDefinition[],
    handleResourceRead: ResourceReadHandler,
    runtime?: ServerRuntime
): void {
    for (const resDef of resources) {
        const mimeType = resDef.mimeType ?? 'application/json'
        const meta = {
            description: resDef.description ?? '',
            mimeType,
            ...(resDef.icons ? { icons: resDef.icons } : {}),
        }

        // Check if this is a template URI (contains {variable} patterns)
        const isTemplate = resDef.uri.includes('{')

        if (isTemplate) {
            const template = new ResourceTemplate(resDef.uri, { list: undefined })
            server.registerResource(
                resDef.name,
                template,
                meta,
                async (uri: URL, _variables: Variables) => {
                    const auditLog = runtime ? runtime.auditLogger : getGlobalAuditLogger()
                    return auditOperation(auditLog, 'resource', resDef.name, async () => {
                        if (!runtime && process.env['NODE_ENV'] !== 'test') {
                            throw new Error('ServerRuntime is logically required for secure resource execution.')
                        }
                        return runtime ? runtime.maintenanceManager.withActiveJob(() => handleResourceRead(uri, mimeType)) : handleResourceRead(uri, mimeType)
                    })
                }
            )
        } else {
            server.registerResource(resDef.name, resDef.uri, meta, async (uri: URL) => {
                const auditLog = runtime ? runtime.auditLogger : getGlobalAuditLogger()
                return auditOperation(auditLog, 'resource', resDef.name, async () => {
                    if (!runtime && process.env['NODE_ENV'] !== 'test') {
                        throw new Error('ServerRuntime is logically required for secure resource execution.')
                    }
                    return runtime ? runtime.maintenanceManager.withActiveJob(() => handleResourceRead(uri, mimeType)) : handleResourceRead(uri, mimeType)
                })
            })
        }
    }
}

// ============================================================================
// Prompt Registration
// ============================================================================

/**
 * Register all prompts with the MCP server.
 *
 * Builds Zod schemas from prompt argument definitions.
 * Only creates argsSchema when there are actual arguments; passing an empty
 * shape causes the SDK to wrap it in z.object({}) which rejects undefined
 * when the client omits arguments (e.g. session-summary with no args).
 */
export function registerPrompts(
    server: McpServer,
    prompts: PromptDefinition[],
    db: IDatabaseAdapter,
    teamDb?: IDatabaseAdapter,
    runtime?: ServerRuntime
): void {
    for (const promptDef of prompts) {
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
                const auditLog = runtime ? runtime.auditLogger : getGlobalAuditLogger()
                return auditOperation(auditLog, 'prompt', promptDef.name, async () => {
                    if (!runtime && process.env['NODE_ENV'] !== 'test') {
                        throw new Error('ServerRuntime is logically required for secure prompt execution.')
                    }
                    
                    const executePrompt = (): Promise<{ messages: { role: 'user' | 'assistant'; content: { type: 'text'; text: string } }[] }> => {
                        const args = providedArgs as Record<string, string>
                        const promptResult = getPrompt(promptDef.name, args, db, teamDb)
                        return Promise.resolve({
                            messages: promptResult.messages.map((m) => ({
                                role: m.role as 'user' | 'assistant',
                                content: m.content as { type: 'text'; text: string },
                            })),
                        })
                    }
                    
                    return runtime ? await runtime.maintenanceManager.withActiveJob(executePrompt) : await executePrompt()
                })
            }
        )
    }
}
