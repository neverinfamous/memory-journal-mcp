/**
 * Copilot Review Tools - 1 tool
 *
 * Tools: get_copilot_reviews
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerErrorResponse } from '../../../utils/error-helpers.js'
import { CopilotReviewsOutputSchema } from './schemas.js'
import { relaxedNumber } from '../schemas.js'
import { resolveOwnerRepo } from './helpers.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getCopilotReviewTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'get_copilot_reviews',
            title: 'Get Copilot Code Reviews',
            description:
                'Get Copilot\'s code review findings for a pull request. Returns review state (approved/changes_requested/commented/none) and file-level comments with paths and line numbers. Use to learn from Copilot\'s review patterns and create journal entries with tag "copilot-finding".',
            group: 'github',
            inputSchema: z.object({
                pr_number: relaxedNumber().describe('Pull request number'),
                owner: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
                repo: z.string().optional().describe('LEAVE EMPTY to auto-detect from git'),
            }),
            outputSchema: CopilotReviewsOutputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            handler: async (params: unknown) => {
                try {
                    const input = z
                        .object({
                            pr_number: z.number(),
                            owner: z.string().optional(),
                            repo: z.string().optional(),
                        })
                        .parse(params)

                    const resolved = await resolveOwnerRepo(context, input)
                    if ('error' in resolved) return resolved.response

                    const summary = await resolved.github.getCopilotReviewSummary(
                        resolved.owner,
                        resolved.repo,
                        input.pr_number
                    )

                    return {
                        prNumber: summary.prNumber,
                        state: summary.state,
                        commentCount: summary.commentCount,
                        comments: summary.comments.map((c) => ({
                            body: c.body,
                            path: c.path,
                            line: c.line,
                        })),
                        owner: resolved.owner,
                        repo: resolved.repo,
                        detectedOwner: resolved.detectedOwner,
                        detectedRepo: resolved.detectedRepo,
                    }
                } catch (err) {
                    return formatHandlerErrorResponse(err)
                }
            },
        },
    ]
}
