# neverinfamous-agent-skills

Reusable instruction sets that establish permanent AI behavior paradigms and extend agent capabilities for specialized tasks. 

## Installation & Distribution

This directory is published as a standalone internal NPM package. Developers can pull the latest skills into their local workspaces by running:

```bash
npx neverinfamous-agent-skills@latest
```

This command will automatically download and synchronize the latest `SKILL.md` files into `./.agents/skills/`.

## Structure

```
skills/
└── <skill-name>/
    ├── SKILL.md          # Main instruction file (required)
    ├── scripts/          # Helper scripts and utilities
    ├── examples/         # Reference implementations
    └── resources/        # Templates, assets, reference docs
```

### SKILL.md Format

Every skill must have a `SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name
description: When and why to load this skill.
---
```

The markdown body contains the full instructions the agent follows once the skill is activated.

## Inventory

| Skill | Description |
|-------|-------------|
| `bun` | Master the Bun all-in-one toolkit — runtime, package manager, test runner, and bundler |
| `github-commander` | GitHub pipeline workflows for orchestrating issues, regressions, and deployments |
| `golang` | Master Go development with production-grade best practices from Google and Uber style guides |
| `mysql` | Enterprise MySQL production rules — query safety, connection pooling, strict schema configurations |
| `postgres` | Advanced PostgreSQL patterns — indexing layouts, JSONB querying, transactional guardrails, and RLS |
| `rust` | Master Rust development using a layer-based "meta-cognition" framework for borrowing, lifetimes, and architecture |
| `shadcn-ui` | Deep knowledge of shadcn/ui components, patterns, forms, and best practices |
| `sqlite` | Production configurations for concurrency (WAL), typing (STRICT), and data integrity |

## Adding a Skill

1. Create a new directory: `skills/<skill-name>/`
2. Add `SKILL.md` with the frontmatter and instructions
3. Optionally add `scripts/`, `examples/`, or `resources/` sub-directories
4. The skill auto-registers — agents discover it via the directory listing
