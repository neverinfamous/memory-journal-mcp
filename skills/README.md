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
| `playwright-standard` | Opinionated guidance for Playwright E2E/API tests, Page Object Models, and CI/CD resilience |
| `postgres` | Advanced PostgreSQL patterns — indexing layouts, JSONB querying, transactional guardrails, and RLS |
| `rust` | Master Rust development using a layer-based "meta-cognition" framework for borrowing, lifetimes, and architecture |
| `shadcn-ui` | Deep knowledge of shadcn/ui components, patterns, forms, and best practices |
| `skill-builder` | Guide for creating, evaluating, and refining agent skills — progressive disclosure, triggers, and testing |
| `sqlite` | Production configurations for concurrency (WAL), typing (STRICT), and data integrity |
| `vitest-standard` | Comprehensive unit testing expertise covering Vitest, TDD, mocking strategies, and test architecture |

## GitHub Commander Workflows

This package natively bundles the `github-commander` skill, which equips your AI agent with 8 autonomous DevOps workflows for repository stewardship:

- **`issue-triage`**: End-to-end bug replication, PR submission, and Kanban lifecycle linking.
- **`milestone-sprint`**: Sequential traversal of all open issues mapped to a specific release target.
- **`pr-review`**: Exhaustive local execution, typechecking, and heuristic code reviews against base branches.
- **`security-audit`**: Deep Trivy/CodeQL supply chain matrix evaluation.
- **`code-quality-audit`**: Enforcement of project guidelines, strict-typing boundaries, and import normalization.
- **`perf-audit`**: Bundle-size constraints, runtime hot-path execution, and CI/CD cache-hit evaluations.
- **`roadmap-kickoff`**: Parses implementation specifications to sequentially scaffold Epic hierarchies across issues and milestones.
- **`update-deps`**: Dependency constraint tracking, security patching, and major bump safety tests.

## Adding a Skill

1. Create a new directory: `skills/<skill-name>/`
2. Add `SKILL.md` with the frontmatter and instructions
3. Optionally add `scripts/`, `examples/`, or `resources/` sub-directories
4. The skill auto-registers — agents discover it via the directory listing
