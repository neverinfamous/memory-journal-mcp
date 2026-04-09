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
| `agents-sdk` | Build AI agents on Cloudflare Workers using the Agents SDK |
| `building-ai-agent-on-cloudflare` | End-to-end guide for stateful AI agents with WebSockets, state, and tools |
| `building-mcp-server-on-cloudflare` | Remote MCP servers on Cloudflare Workers with OAuth and deployment |
| `bun` | Master the Bun all-in-one toolkit — runtime, package manager, test runner, and bundler |
| `cloudflare` | Comprehensive Cloudflare platform skill — decision trees, product index, retrieval sources |
| `durable-objects` | Create and review Durable Objects — RPC, SQLite storage, alarms, WebSockets |
| `github-repo-setup` | Scaffold public TypeScript/Node.js repos under `neverinfamous` |
| `golang` | Master Go development with production-grade best practices from Google and Uber style guides |
| `mastering-typescript` | Master enterprise-grade TypeScript 6.0+ with type-safe patterns, Zod validation, and modern toolchains (Vite, pnpm, ESLint) |
| `mcp-builder` | Build high-quality MCP servers with structured errors, HTTP hardening, OAuth, Code Mode, and dynamic instructions |
| `next-best-practices` | Next.js file conventions, RSC boundaries, data patterns, metadata, error handling |
| `next-cache-components` | Next.js 16 PPR, `use cache`, `cacheLife`, `cacheTag`, `updateTag` |
| `next-upgrade` | Upgrade Next.js following official migration guides and codemods |
| `playwright-standard` | Comprehensive, opinionated guidance for Playwright E2E, API, and visual tests with "Golden Rules" for resilience |
| `react-best-practices` | React and Next.js performance optimization guidelines from Vercel Engineering |
| `rust` | Master Rust development using a layer-based "meta-cognition" framework for borrowing, lifetimes, and architecture |
| `sandbox-sdk` | Sandboxed code execution — interpreters, CI/CD, untrusted code |
| `shadcn-ui` | Deep knowledge of shadcn/ui components, patterns, forms, and best practices |
| `skill-builder` | Guide for creating, evaluating, and refining agent skills — progressive disclosure, triggers, and testing |
| `vitest-standard` | Production-grade unit testing with Vitest, emphasizing TDD, behavior-driven design, and clean mocking patterns |
| `web-perf` | Chrome DevTools MCP performance auditing — Core Web Vitals, network, accessibility |
| `workers-best-practices` | Cloudflare Workers production patterns — streaming, bindings, secrets, observability |
| `wrangler` | Cloudflare Workers CLI for deploying and managing Workers and bindings |

## Adding a Skill

1. Create a new directory: `skills/<skill-name>/`
2. Add `SKILL.md` with the frontmatter and instructions
3. Optionally add `scripts/`, `examples/`, or `resources/` sub-directories
4. The skill auto-registers — agents discover it via the directory listing
