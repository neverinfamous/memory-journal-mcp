export const GITHUB_HELP = `# GitHub Integration

- Include \`issue_number\`/\`pr_number\` and \`--project\` in your \`memory-journal-mcp entry create\` CLI command to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → \`actions-failure-digest\` prompt or \`memory://actions/recent\`
- Kanban: \`get_kanban_board\` → \`add_kanban_item\` / \`move_kanban_item\` / \`delete_kanban_item\` → document completion (project_number auto-resolves if repo is registered). **⚠️ Eventual Consistency:** GitHub Projects V2 read index is heavily eventually consistent. Do NOT rely on \`get_kanban_board\` to immediately reflect items that were just added or moved.
- Milestones: \`get_github_milestones\` → track project progress, \`memory://github/milestones\`
- Commits: \`memory://commits/{project_number}/by-issue\` and \`memory://commits/{project_number}/by-pr\` group commits by referenced issues/PRs.
- Rate Limits: Before expensive API operations, check \`memory://github/rate-limit\` (or \`memory://github/rate-limit/{repo}\`) to proactively throttle.
- **Project Initialization**: To register a new project workspace, create an entry with \`project_number: N\`. Instruct the user to manually update their \`PROJECT_REGISTRY\` config, as agents cannot directly edit protected IDE config files.
- **Multi-Project Routing**: If \`memory://briefing\` shows "Registered Workspaces":
  - **Tools**: The \`repo\` parameter automatically resolves from \`project_number\`. If you omit both, they default to the primary project.
  - **Resources**: Resource URIs like \`memory://github/status\` will fallback to the default project. To explicitly target another project, use the \`{repo}\` variant (e.g., \`memory://github/status/{repo}\`).
  - **Dynamic Briefings**: You can explicitly request the briefing for a specific project by reading \`memory://briefing/{repo}\` instead of the global \`memory://briefing\` resource.

## Copilot Review Patterns

When the user has GitHub Copilot code review enabled:

**Learn from reviews** — After a PR is merged or reviewed, use \`get_copilot_reviews({ pr_number, repo })\` to read Copilot's findings (pass \`repo\` in multi-project setups). If patterns emerge (e.g., repeated null check warnings, missing error handling), suggest adding a rule or updating existing rules. Create journal entries tagged \`copilot-finding\` and link to the PR via \`pr_number\`.

**Pre-emptive checking** — Before creating or modifying code, search journal entries with tag \`copilot-finding\` for patterns relevant to the current work. Apply those patterns proactively to reduce review cycles.

## Available Tools

- \`get_github_issues\` / \`get_github_prs\`: List issues or pull requests. Leave \`owner\`/\`repo\` empty to auto-detect.
- \`get_github_issue\` / \`get_github_pr\`: Get detailed information about a specific issue or PR.
- \`create_github_issue_with_entry\` / \`close_github_issue_with_entry\`: Manage issues while automatically logging journal entries.
- \`get_copilot_reviews\`: Get Copilot's code review findings for a PR, returning review state and file-level comments.
- \`get_github_context\`: Get current repository context including branch, open issues, and open PRs.
- \`get_repo_insights\`: Get repository insights (stars, forks, traffic, referrers, paths). Use \`sections\` to control token usage.
- \`get_kanban_board\`: View a GitHub Project v2 as a Kanban board with items grouped by Status column.
- \`add_kanban_item\` / \`move_kanban_item\` / \`delete_kanban_item\`: Manage items on a GitHub Project v2 Kanban board.
- \`get_github_milestones\` / \`get_github_milestone\` / \`create_github_milestone\` / \`update_github_milestone\` / \`delete_github_milestone\`: Manage GitHub milestones for tracking project progress.

`;
