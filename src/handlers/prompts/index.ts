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
import type { GitHubIntegration } from '../../github/github-integration/index.js'

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
        teamDb?: IDatabaseAdapter,
        github?: GitHubIntegration
    ) => Promise<{ messages: PromptMessage[] }> | { messages: PromptMessage[] }
}

/**
 * Execute a raw SQL query on the database
 */
export function execQuery(
    db: IDatabaseAdapter,
    sql: string,
    params: unknown[] = []
): Record<string, unknown>[] {
    const result = db.executeRawQuery(sql, params)
    if (result.length === 0) return []

    const columns = result[0]?.columns ?? []
    return (result[0]?.values ?? []).map((values: unknown[]) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col: string, i: number) => {
            obj[col] = values[i]
        })
        return obj
    })
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
export async function getPrompt(
    name: string,
    args: Record<string, string>,
    db: IDatabaseAdapter,
    teamDb?: IDatabaseAdapter,
    github?: GitHubIntegration
): Promise<{ messages: PromptMessage[] }> {
    const prompts = getAllPromptDefinitions()
    const prompt = prompts.find((p) => p.name === name)

    if (!prompt) {
        throw new ResourceNotFoundError('Prompt', name)
    }

    return prompt.handler(args, db, teamDb, github)
}

/**
 * Get all prompt definitions by composing sub-module definitions
 */
function getAllPromptDefinitions(): InternalPromptDef[] {
    return [...getWorkflowPromptDefinitions(), ...getGitHubPromptDefinitions()]
}
