export const GITHUB_HELP = `# GitHub Integration

- Include \`issue_number\`/\`pr_number\` alongside \`project_number\` and \`workspace_id\` in \`create_entry\` / \`mj.core.createEntry\` (or \`--project\` on \`memory-journal-mcp entry create\` CLI) to link work to GitHub issues and PRs.
- After closing an issue or merging a PR → create a summary entry with learnings.
- CI failures → \`actions-failure-digest\` prompt or \`memory://actions/recent/{+repo}\`.
- Kanban: \`get_kanban_board\` → \`add_kanban_item\` / \`move_kanban_item\` / \`delete_kanban_item\` → document completion (\`project_number\` auto-resolves if repo is registered). **⚠️ Eventual Consistency:** GitHub Projects V2 read index is eventually consistent. Do NOT rely on \`get_kanban_board\` to immediately reflect items that were just added or moved.
- Milestones: \`get_github_milestones\` → track project progress, \`memory://github/milestones\` (\`delete_github_milestone\` requires \`confirm: true\`).
- Repo Insights & Commits: \`get_repo_insights\` defaults to \`sections: "stars"\` unless additional sections are requested; \`memory://commits/{project_number}/by-issue\` and \`memory://commits/{project_number}/by-pr\` group commits by referenced issues/PRs.
- Rate Limits & Status: Check \`memory://github/status/{+repo}\` (or \`memory://github/status\`) before expensive API operations.
- **Project Initialization**: Register a workspace with \`register_project\` / \`update_project\` (\`mj.admin.registerProject\` / \`mj.admin.updateProject\`) or \`memory-journal-mcp project create <name> --path <path> --number <N>\`.
- **Multi-Project Routing**: When \`memory://briefing/{+repo}\` shows multiple workspaces:
  - **Tools**: Pass \`repo\` explicitly (\`owner\` and \`repo\` auto-detect from git when omitted — omit them rather than passing empty strings \`""\`).
  - **Resources**: Prefer repo-scoped templates (\`memory://github/status/{+repo}\`, \`memory://actions/recent/{+repo}\`, \`memory://briefing/{+repo}\`, \`memory://kanban/{project_number}\`).

## Copilot Review Patterns

When the user has GitHub Copilot code review enabled:

**Learn from reviews** — After a PR is merged or reviewed, use \`get_copilot_reviews({ pr_number })\` (omit \`owner\` and \`repo\` to auto-detect from git, or pass \`repo\` explicitly) to read Copilot's findings. If patterns emerge (e.g., repeated null check warnings, missing error handling), suggest adding a rule or updating existing rules. Create journal entries tagged \`copilot-finding\` and link to the PR via \`pr_number\`.

**Pre-emptive checking** — Before creating or modifying code, search journal entries with tag \`copilot-finding\` for patterns relevant to the current work. Apply those patterns proactively to reduce review cycles.

## Available Tools

- **Issues**: \`get_github_issues\`, \`get_github_issue\`, \`create_github_issue_with_entry\`, \`close_github_issue_with_entry\`
- **Pull Requests**: \`get_github_prs\`, \`get_github_pr\`, \`get_copilot_reviews\`
- **Context & Insights**: \`get_github_context\`, \`get_repo_insights\`
- **Kanban**: \`get_kanban_board\`, \`add_kanban_item\`, \`move_kanban_item\`, \`delete_kanban_item\`
- **Milestones**: \`get_github_milestones\`, \`get_github_milestone\`, \`create_github_milestone\`, \`update_github_milestone\`, \`delete_github_milestone\`

`;
