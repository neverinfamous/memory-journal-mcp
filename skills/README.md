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
    ├── references/       # Progressive disclosure docs to reduce token bloat
    ├── scripts/          # Helper scripts and utilities
    ├── examples/         # Reference implementations
    └── resources/        # Templates, assets, external docs
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
| `adversarial-performance`            | Multi-pass adversarial performance audit — iterative profiling, stress-testing critique, and Copilot validation       |
| `adversarial-planner`                | Multi-pass adversarial planning — iterative plan drafting, structured critique, and Copilot validation                |
| `adversarial-security`               | Multi-pass adversarial security audit — iterative threat modeling, attack surface analysis, and Copilot validation    |
| `adversarial-skill-audit`            | Multi-pass adversarial skill audit — iterative quality evaluation, trigger stress-testing, and Copilot validation     |
| `adversarial-workflow-audit`         | Multi-pass adversarial workflow audit — sequential clarity, HITL safety gates, loop prevention, and Copilot validation |
| `agents-sdk`                         | Build AI agents on Cloudflare Workers using the Agents SDK                                                            |
| `auth-identity`                      | Standards for Authentication and Identity management (OAuth, JWTs, RBAC)                                              |
| `autonomous-dev`                     | Harness for autonomous software development — alignment gates, adversarial agents, Git workflows, and CI/CD pipelines |
| `aws`                                | Comprehensive AWS best practices — IAM, Serverless, S3, RDS, networking, and IaC                      |
| `azure`                              | Microsoft Azure best practices — Entra ID, App Service, AKS, Cosmos DB, networking, and Bicep         |
| `bun`                                | Master the Bun all-in-one toolkit — runtime, package manager, test runner, and bundler                                |
| `cloudflare`                         | Comprehensive Cloudflare platform skill — decision trees, product index, retrieval sources                            |
| `docker`                             | Production-grade Docker — multi-stage builds, security hardening, Compose v2, BuildKit, and CI/CD integration         |
| `drizzle-orm`                        | Drizzle ORM best practices — database configuration, schemas, relational queries, migrations                          |
| `durable-objects`                    | Create and review Durable Objects — RPC, SQLite storage, alarms, WebSockets                                           |
| `gcp`                                | Google Cloud Platform best practices — IAM, Cloud Run, BigQuery, VPC SC, and Terraform                |
| `github-actions`                     | GitHub Actions CI/CD — SHA pinning, reusable workflows, caching, matrix strategies, and artifacts v4                  |
| `github-commander`                   | GitHub pipeline workflows for orchestrating issues, regressions, and deployments                                      |
| `github-copilot-cli`                 | Adversarial pre-push validation and full repository code audits driven natively by the `gh copilot` CLI               |
| `github-repo-setup`                  | Scaffold public TypeScript/Node.js repos under `{{ORG_NAME}}`                                                         |
| `gitlab`                             | Specialized assistant skill for managing repositories, code search, and CI/CD in GitLab                               |
| `golang`                             | Master Go development with production-grade best practices from Google and Uber style guides                          |
| `graphql`                            | GraphQL best practices — schema design, resolvers, DataLoader for N+1 issues, and mutations                           |
| `hono`                               | Hono framework best practices — edge runtimes, RPC, middleware, validation                                            |
| `journal-optimizer`                  | Guided database pruning and optimization — importance audits, orphan cleanup, duplicate detection, and safe soft-delete |
| `llm-app-engineering`                | Master modern LLM application engineering patterns — prompt chains, token management, streaming                       |
| `mcp-builder`                        | Build high-quality MCP servers with structured errors, HTTP hardening, OAuth, Code Mode, and dynamic instructions     |
| `multi-agent-orchestration`          | Patterns for multi-agent systems and agentic workflows (e.g. Plan-and-Execute, Supervisor)                            |
| `mysql`                              | Enterprise MySQL production rules — query safety, connection pooling, strict schema configurations                    |
| `next-best-practices`               | Next.js file conventions, RSC boundaries, data patterns, metadata, error handling                                     |
| `opentelemetry`                      | Observability standards using OpenTelemetry — tracing, spans, metrics, exporters                                      |
| `playwright-standard`               | Opinionated guidance for Playwright E2E/API tests, Page Object Models, and CI/CD resilience                           |
| `postgres`                           | Advanced PostgreSQL patterns — indexing layouts, JSONB querying, transactional guardrails, and RLS                    |
| `python`                             | Modern Python engineering — uv, ruff, type hints, pytest, Pydantic v2, and src/ layout project structure              |
| `rag-pipelines`                      | Best practices for Retrieval-Augmented Generation (RAG) pipelines — embeddings, chunking, retrieval                   |
| `react-best-practices`              | Vercel engineering guidelines for React/Next.js performance, hooks, and bundle optimization                           |
| `redis`                              | Redis best practices — caching strategies, connection pooling, TTLs, and data structures                              |
| `render`                             | Render deployment best practices — Blueprints, Web Services, databases, and persistent disks            |
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

## Automated Auditing

The `adversarial-skill-audit` skill includes automated scripts for evaluating the skills directory:
- `skills/adversarial-skill-audit/scripts/check-skills.ps1`: Generates an inventory of all skills, checking line counts, trigger lengths, and frontmatter compliance.
- `skills/adversarial-skill-audit/scripts/run-copilot.ps1`: Runs independent validation against the Copilot CLI.

> **Latest Audit**: May 26, 2026. The 49 skills in this repository were audited via a multi-pass GitHub Copilot validation sweep, achieving an A- directory-level quality score.

## Adding a Skill

1. Create a new directory: `skills/<skill-name>/`
2. Add `SKILL.md` with the frontmatter and instructions
3. Optionally add `scripts/`, `examples/`, or `resources/` sub-directories
4. The skill auto-registers — agents discover it via the directory listing
