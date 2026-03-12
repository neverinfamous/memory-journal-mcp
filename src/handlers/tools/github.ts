/**
 * GitHub Tool Group - 16 tools
 *
 * Tools: get_github_issues, get_github_prs, get_github_issue, get_github_pr,
 *        get_github_context, get_kanban_board, move_kanban_item,
 *        create_github_issue_with_entry, close_github_issue_with_entry,
 *        get_github_milestones, get_github_milestone,
 *        create_github_milestone, update_github_milestone, delete_github_milestone,
 *        get_repo_insights,
 *        get_copilot_reviews
 */

import type { ToolDefinition, ToolContext } from '../../types/index.js'
import { getGitHubReadTools } from './github/read-tools.js'
import { getGitHubMutationTools } from './github/mutation-tools.js'
import { getGitHubMilestoneTools } from './github/milestone-tools.js'
import { getGitHubInsightsTools } from './github/insights-tools.js'
import { getCopilotReviewTools } from './github/copilot-tools.js'

// Re-export schemas used by other modules
export {
    GitHubIssueOutputSchema,
    GitHubPullRequestOutputSchema,
    GitHubMilestoneOutputSchema,
} from './github/schemas.js'

// ============================================================================
// Tool Definitions
// ============================================================================

export function getGitHubTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getGitHubReadTools(context),
        ...getGitHubMutationTools(context),
        ...getGitHubMilestoneTools(context),
        ...getGitHubInsightsTools(context),
        ...getCopilotReviewTools(context),
    ]
}
