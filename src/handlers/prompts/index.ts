/**
 * Memory Journal MCP Server - Prompt Handlers
 *
 * Barrel file composing prompt definitions from sub-modules.
 * Exports all MCP prompts for workflow guidance.
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { McpIcon } from '../../types/index.js'
import { getWorkflowPromptDefinitions } from './workflow.js'
import { getAnalyticsPromptDefinitions } from './analytics.js'
import { getGitHubPromptDefinitions } from './github.js'
import { getGitPromptDefinitions } from './git.js'
import type { BriefingConfig } from '../resources/shared.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'

import { getAdversarialPromptDefinitions } from './adversarial.js'
import { getOptimizerPromptDefinitions } from './optimizer.js'
import { getLoadBriefingPromptDefinitions } from './load-briefing.js'
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
        teamDb?: IDatabaseAdapter,
        github?: GitHubIntegration,
        briefingConfig?: BriefingConfig
    ) => { messages: PromptMessage[] } | Promise<{ messages: PromptMessage[] }>
}

/**
 * Get all prompt definitions for MCP list
 */
export function getPrompts(): object[] {
    return getAllPromptDefinitions().map((def) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { handler: _handler, ...rest } = def
        return rest
    })
}

/**
 * Execute a prompt by name
 */
export function getPrompt(
    name: string,
    args: Record<string, string>,
    db: IDatabaseAdapter,
    teamDb?: IDatabaseAdapter,
    github?: GitHubIntegration,
    briefingConfig?: BriefingConfig
): Promise<{ messages: PromptMessage[] }> {
    const prompts = getAllPromptDefinitions()
    const prompt = prompts.find((p) => p.name === name)

    if (!prompt) {
        throw new ResourceNotFoundError('Prompt', name)
    }

    return Promise.resolve(prompt.handler(args, db, teamDb, github, briefingConfig))
}

/**
 * Get all prompt definitions by composing sub-module definitions
 */
export function getAllPromptDefinitions(): InternalPromptDef[] {
    return [
        ...getWorkflowPromptDefinitions(),
        ...getAnalyticsPromptDefinitions(),
        ...getGitHubPromptDefinitions(),
        ...getGitPromptDefinitions(),
        ...getAdversarialPromptDefinitions(),
        ...getOptimizerPromptDefinitions(),
        ...getLoadBriefingPromptDefinitions(),
    ]
}
