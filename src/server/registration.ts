/**
 * MCP Server Registration Helpers
 *
 * Extracted from mcp-server.ts to keep it under 500 lines.
 * Handles resource and prompt registration with the MCP SDK.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { ResourceTemplate } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { getPrompt } from '../handlers/prompts/index.js'
import { auditOperation } from '../audit/interceptor.js'
import type { ServerRuntime } from '../utils/maintenance-lock.js'
import { ConfigurationError } from '../types/errors.js'
import { enforceAccessBoundary } from '../auth/validation.js'
import type { BriefingConfig } from '../handlers/resources/shared.js'
import type { GitHubIntegration } from '../github/github-integration/index.js'
import {
    attachResourceQueryHandler,
    createAuditedResourceCallback,
} from './resource-query-registration.js'

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
    capabilities?: {
        requiresTeamScope?: boolean
        requiresAdminScope?: boolean
        requiresAuditScope?: boolean
    }
}

/** Raw prompt definition from getPrompts() */
export interface PromptDefinition {
    name: string
    description?: string
    arguments?: { name: string; description: string; required?: boolean }[]
    icons?: { src: string; mimeType?: string; sizes?: string[] }[]
    capabilities?: {
        requiresTeamScope?: boolean
        requiresAdminScope?: boolean
        requiresAuditScope?: boolean
    }
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

const resourceTemplateCache = new Map<string, ResourceTemplate>()
const promptArgsSchemaCache = new WeakMap<PromptDefinition, z.ZodObject<Record<string, z.ZodType>>>()

function getCachedResourceTemplate(uri: string): ResourceTemplate {
    let template = resourceTemplateCache.get(uri)
    if (template === undefined) {
        template = new ResourceTemplate(uri, { list: undefined })
        resourceTemplateCache.set(uri, template)
    }
    return template
}

function getCachedPromptArgsSchema(
    promptDef: PromptDefinition
): z.ZodObject<Record<string, z.ZodType>> | undefined {
    if (promptDef.arguments === undefined || promptDef.arguments.length === 0) {
        return undefined
    }
    let cached = promptArgsSchemaCache.get(promptDef)
    if (cached === undefined) {
        const shape: Record<string, z.ZodType> = {}
        for (const arg of promptDef.arguments) {
            const described = z.string().describe(arg.description)
            shape[arg.name] = arg.required === true ? described : described.optional()
        }
        cached = z.object(shape)
        promptArgsSchemaCache.set(promptDef, cached)
    }
    return cached
}

/**
 * Register all resources with the MCP server.
 *
 * Handles both static URIs and template URIs (containing `{variable}` patterns),
 * and wraps `resources/read` so `?query` parameters match base registrations cleanly.
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
        const readCallback = createAuditedResourceCallback(
            resDef,
            mimeType,
            handleResourceRead,
            runtime
        )

        if (resDef.uri.includes('{')) {
            server.registerResource(
                resDef.name,
                getCachedResourceTemplate(resDef.uri),
                meta,
                readCallback
            )
        } else {
            server.registerResource(resDef.name, resDef.uri, meta, readCallback)
        }
    }

    attachResourceQueryHandler(server)
}

// ============================================================================
// Prompt Registration
// ============================================================================

/**
 * Register all prompts with the MCP server.
 *
 * Builds Zod schemas from prompt argument definitions. Prompts with no
 * arguments omit argsSchema, because an empty object schema rejects a
 * missing arguments payload. Prompts whose arguments are all optional still
 * get a schema of optional strings so prompts/get receives those values.
 * The SDK validates with `args ?? {}`, so omitting the arguments still works.
 */
export function registerPrompts(
    server: McpServer,
    prompts: PromptDefinition[],
    db: IDatabaseAdapter,
    teamDb?: IDatabaseAdapter,
    runtime?: ServerRuntime,
    github?: GitHubIntegration,
    briefingConfig?: BriefingConfig | (() => BriefingConfig)
): void {
    for (const promptDef of prompts) {
        const argsZodSchema = getCachedPromptArgsSchema(promptDef)

        server.registerPrompt(
            promptDef.name,
            {
                description: promptDef.description ?? '',
                ...(argsZodSchema !== undefined ? { argsSchema: argsZodSchema } : {}),
                ...(promptDef.icons ? { icons: promptDef.icons } : {}),
            },
            (providedArgs) => {
                if (!runtime) {
                    throw new ConfigurationError(
                        'ServerRuntime is logically required for secure prompt execution.'
                    )
                }
                const auditLog = runtime.auditLogger
                enforceAccessBoundary(promptDef.name, 'prompt', promptDef.capabilities, auditLog)
                const forceAudit =
                    promptDef.capabilities?.requiresTeamScope === true ||
                    promptDef.capabilities?.requiresAuditScope === true ||
                    promptDef.capabilities?.requiresAdminScope === true
                return auditOperation(
                    auditLog,
                    'prompt',
                    promptDef.name,
                    async () => {
                        const executePrompt = async (): Promise<{
                            messages: {
                                role: 'user' | 'assistant'
                                content: { type: 'text'; text: string }
                            }[]
                        }> => {
                            const args = providedArgs as Record<string, string>
                            const resolvedBriefingConfig =
                                typeof briefingConfig === 'function'
                                    ? briefingConfig()
                                    : briefingConfig
                            const promptResult = await getPrompt(
                                promptDef.name,
                                args,
                                db,
                                teamDb,
                                github,
                                resolvedBriefingConfig,
                                runtime
                            )
                            return {
                                messages: promptResult.messages.map((m) => ({
                                    role: m.role as 'user' | 'assistant',
                                    content: m.content as { type: 'text'; text: string },
                                })),
                            }
                        }

                        return await runtime.maintenanceManager.withActiveJob(executePrompt)
                    },
                    { forceAudit, capabilities: promptDef.capabilities }
                )
            }
        )
    }
}
