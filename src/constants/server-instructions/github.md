# GitHub Integration

- Include `issue_number`/`pr_number` and `project_number` in `create_entry` to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → `actions-failure-digest` prompt or `memory://actions/recent`
- Kanban: `get_kanban_board` → `add_kanban_item` / `move_kanban_item` / `delete_kanban_item` → document completion (project_number auto-resolves if repo is registered). **⚠️ Eventual Consistency:** GitHub Projects V2 read index is heavily eventually consistent. Do NOT rely on `get_kanban_board` to immediately reflect items that were just added or moved.
- Milestones: `get_github_milestones` → track project progress, `memory://github/milestones`
- **Project Initialization**: To register a new project workspace, create an entry with `project_number: N`. Instruct the user to manually update their `PROJECT_REGISTRY` config, as agents cannot directly edit protected IDE config files.
- **Multi-Project Routing**: If `memory://briefing` shows "Registered Workspaces":
  - **Tools**: Pass a `repo` parameter to ALL GitHub tools (including `get_github_context`) to explicitly target a specific project.
  - **Resources**: You MUST use the dynamic `{repo}` variants for resources (e.g., `memory://github/status/{repo}`, `memory://github/insights/{repo}`) rather than the base URI (`memory://github/status`), which will fail with a detection error.
  - **Dynamic Briefings**: You can explicitly request the briefing for a specific project by reading `memory://briefing/{repo}` instead of the global `memory://briefing` resource.

## Copilot Review Patterns

When the user has GitHub Copilot code review enabled:

**Learn from reviews** — After a PR is merged or reviewed, use `get_copilot_reviews({ pr_number, repo })` to read Copilot's findings (pass `repo` in multi-project setups). If patterns emerge (e.g., repeated null check warnings, missing error handling), suggest adding a rule or updating existing rules. Create journal entries tagged `copilot-finding` and link to the PR via `pr_number`.

**Pre-emptive checking** — Before creating or modifying code, search journal entries with tag `copilot-finding` for patterns relevant to the current work. Apply those patterns proactively to reduce review cycles.
