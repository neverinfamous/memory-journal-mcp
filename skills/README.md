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

| Skill                                | Description                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `adversarial-planner`                | Multi-pass adversarial planning — iterative plan drafting, structured critique, and Copilot validation                |
| `agents-sdk`                         | Build AI agents on Cloudflare Workers using the Agents SDK                                                            |
| `autonomous-dev`                     | Harness for autonomous software development — alignment gates, adversarial agents, Git workflows, and CI/CD pipelines |
| `building-ai-agent-on-cloudflare`    | End-to-end guide for stateful AI agents with WebSockets, state, and tools                                             |
| `building-mcp-server-on-cloudflare`  | Remote MCP servers on Cloudflare Workers with OAuth and deployment                                                    |
| `bun`                                | Master the Bun all-in-one toolkit — runtime, package manager, test runner, and bundler                                |
| `cloudflare`                         | Comprehensive Cloudflare platform skill — decision trees, product index, retrieval sources                            |
| `docker`                             | Production-grade Docker — multi-stage builds, security hardening, Compose v2, BuildKit, and CI/CD integration         |
| `durable-objects`                    | Create and review Durable Objects — RPC, SQLite storage, alarms, WebSockets                                           |
| `github-actions`                     | GitHub Actions CI/CD — SHA pinning, reusable workflows, caching, matrix strategies, and artifacts v4                  |
| `github-commander`                   | GitHub pipeline workflows for orchestrating issues, regressions, and deployments                                      |
| `github-copilot-cli`                 | Adversarial pre-push validation and full repository code audits driven by the @github/copilot terminal harness        |
| `github-repo-setup`                  | Scaffold public TypeScript/Node.js repos under `neverinfamous`                                                        |
| `gitlab`                             | Specialized assistant skill for managing repositories, code search, and CI/CD in GitLab                               |
| `golang`                             | Master Go development with production-grade best practices from Google and Uber style guides                          |
| `mcp-builder`                        | Build high-quality MCP servers with structured errors, HTTP hardening, OAuth, Code Mode, and dynamic instructions     |
| `mysql`                              | Enterprise MySQL production rules — query safety, connection pooling, strict schema configurations                    |
| `next-best-practices`               | Next.js file conventions, RSC boundaries, data patterns, metadata, error handling                                     |
| `next-cache-components`             | Next.js 16 PPR, `use cache`, `cacheLife`, `cacheTag`, `updateTag`                                                     |
| `next-upgrade`                       | Upgrade Next.js following official migration guides and codemods                                                       |
| `playwright-standard`               | Opinionated guidance for Playwright E2E/API tests, Page Object Models, and CI/CD resilience                           |
| `postgres`                           | Advanced PostgreSQL patterns — indexing layouts, JSONB querying, transactional guardrails, and RLS                    |
| `python`                             | Modern Python engineering — uv, ruff, type hints, pytest, Pydantic v2, and src/ layout project structure              |
| `react-best-practices`              | Vercel engineering guidelines for React/Next.js performance, hooks, and bundle optimization                           |
| `rust`                               | Master Rust development using a layer-based "meta-cognition" framework for borrowing, lifetimes, and architecture     |
| `sandbox-sdk`                        | Sandboxed code execution — interpreters, CI/CD, untrusted code                                                        |
| `shadcn-ui`                          | Deep knowledge of shadcn/ui components, patterns, forms, and best practices                                           |
| `skill-builder`                      | Guide for creating, evaluating, and refining agent skills — progressive disclosure, triggers, and testing             |
| `sqlite`                             | Production configurations for concurrency (WAL), typing (STRICT), and data integrity                                  |
| `tailwind-css`                       | Tailwind CSS v4 — CSS-first configuration, @theme directive, dark mode, responsive design, and v3 migration           |
| `typescript`                         | Enterprise-grade TypeScript development with type-safe patterns, Zod validation, and modern tooling                   |
| `vitest-standard`                    | Comprehensive unit testing expertise covering Vitest, TDD, mocking strategies, and test architecture                  |
| `web-perf`                           | Chrome DevTools MCP performance auditing — Core Web Vitals, network, accessibility                                    |
| `workers-best-practices`            | Cloudflare Workers production patterns — streaming, bindings, secrets, observability                                  |
| `wrangler`                           | Cloudflare Workers CLI for deploying and managing Workers and bindings                                                |

## GitHub Commander Workflows

This package natively bundles the `github-commander` skill, which equips your AI agent with 8 autonomous DevOps workflows for repository stewardship:

- **`issue-triage`**: End-to-end bug replication, PR submission, and Kanban lifecycle linking.
- **`milestone-sprint`**: Sequential traversal of all open issues mapped to a specific release target.
- **`pr-review`**: Exhaustive local execution, typechecking, and heuristic code reviews against base branches.
- **`copilot-audit`**: AI-evaluating-AI adversarial evaluations covering localized diffs and whole codebases.
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
