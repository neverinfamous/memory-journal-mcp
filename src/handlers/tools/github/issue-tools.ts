/**
 * GitHub Issue Tools - 2 tools
 *
 * Tools: create_github_issue_with_entry, close_github_issue_with_entry
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getCreateGitHubIssueTool } from './create-issue-tool.js'
import { getCloseGitHubIssueTool } from './close-issue-tool.js'

export { getCreateGitHubIssueTool, getCloseGitHubIssueTool }

export function getGitHubIssueTools(context: ToolContext): ToolDefinition[] {
    return [getCreateGitHubIssueTool(context), getCloseGitHubIssueTool(context)]
}
