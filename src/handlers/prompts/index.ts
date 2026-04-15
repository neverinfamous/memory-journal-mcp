/**
 * Memory Journal MCP Server - Prompt Handlers
 *
 * Barrel file composing prompt definitions from sub-modules.
 * Exports all MCP prompts for workflow guidance.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { McpIcon } from '../../types/index.js'
import { getWorkflowPromptDefinitions } from './workflow.js'
import { getGitHubPromptDefinitions } from './github.js'
import { ResourceNotFoundError } from '../../types/errors.js'

/**
 * Message format for MCP prompts
 */
export interface PromptMessage {
    role: string
    content: {
        type: string
        text: string
    }
}

/**
 * Internal prompt definition with db handler
 */
export interface InternalPromptDef {
    name: string
    description: string
    arguments?: {
        name: string
        description: string
        required?: boolean
    }[]
    icons?: McpIcon[]
    handler: (
        args: Record<string, string>,
        db: IDatabaseAdapter,
        teamDb?: IDatabaseAdapter
    ) => { messages: PromptMessage[] }
}

/**
 * Get all prompt definitions for MCP list
 */
export function getPrompts(): object[] {
    const prompts = getAllPromptDefinitions()
    return prompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
        icons: p.icons,
    }))
}

/**
 * Get a prompt by name
 */
export function getPrompt(
    name: string,
    args: Record<string, string>,
    db: IDatabaseAdapter,
    teamDb?: IDatabaseAdapter
): { messages: PromptMessage[] } {
    const prompts = getAllPromptDefinitions()
    const prompt = prompts.find((p) => p.name === name)

    if (!prompt) {
        throw new ResourceNotFoundError('Prompt', name)
    }

    return prompt.handler(args, db, teamDb)
}

/**
 * Get all prompt definitions by composing sub-module definitions
 */
function getAllPromptDefinitions(): InternalPromptDef[] {
    return [...getWorkflowPromptDefinitions(), ...getGitHubPromptDefinitions()]
}
