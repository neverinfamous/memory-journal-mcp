# CI/CD Workflows

This directory contains all GitHub Actions workflows for the **memory-journal-mcp** project. The pipeline is organized into three layers: continuous integration, security scanning, and automated release/publishing.

## Workflow Map

```mermaid
flowchart LR
    subgraph Triggers["Triggers"]
        Push["push to main"]
        PR["pull_request"]
        Tag["release published"]
        Sched["schedule (cron)"]
        Manual["workflow_dispatch"]
    end

    subgraph CI["CI"]
        LT["lint-and-test"]
    end

    subgraph Security["Security"]
        CQL["codeql"]
        SS["secrets-scanning"]
        SU["security-update"]
    end

    subgraph Release["Release"]
        AR["auto-release"]
        NPM["publish-npm"]
        DP["docker-publish"]
    end

    subgraph Agentic["Agentic Workflows (Copilot)"]
        DM["dependency-maintenance"]
        CHM["ci-health-monitor"]
        DDD["docs-drift-detector"]
        AM["agentics-maintenance"]
    end

    Push --> LT
    PR --> LT
    Push --> CQL
    Push --> SS
    Push --> SU
    LT -->|workflow_run success| DP
    Push -->|commit contains '[deps]'| AR
    AR -->|creates release| NPM
    Tag --> NPM
    Sched --> CQL
    Sched --> SU
    Sched --> DM
    Sched --> CHM
    Sched --> AM
    PR --> DDD
    Manual --> SU
    Manual --> DM
    Manual --> CHM
    Manual --> AM
```

---

## Workflows

### CI

| File                                   | Trigger             | Purpose                                                                 |
| -------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| [lint-and-test.yml](lint-and-test.yml) | push / PR to `main` | Lint, typecheck, build, unit tests (Node 24.x + 25.x matrix), npm audit |

### Security

| File                                         | Trigger                                                             | Purpose                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [codeql.yml](codeql.yml)                     | push / PR / weekly (Mon 02:23 UTC)                                  | CodeQL static analysis for `javascript-typescript` and `actions`                                   |
| [secrets-scanning.yml](secrets-scanning.yml) | push / PR                                                           | TruffleHog (verified secrets) + Gitleaks scanning                                                  |
| [security-update.yml](security-update.yml)   | push (Dockerfile/package changes) / weekly (Sun 02:00 UTC) / manual | Docker image Trivy scan (CRITICAL/HIGH/MEDIUM), SARIF upload, auto-creates GitHub issue on failure |

### Release & Publishing

| File                                     | Trigger                                        | Purpose                                                                                                   |
| ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [auto-release.yml](auto-release.yml)     | push to `main` with `[deps]` in commit message | Creates git tag + GitHub release for dependency-maintenance patch bumps                                   |
| [publish-npm.yml](publish-npm.yml)       | release published / manual                     | Publishes to npm with version verification                                                                |
| [docker-publish.yml](docker-publish.yml) | `lint-and-test` workflow_run success on `main` | Multi-arch Docker build (amd64 + arm64), Docker Scout scan, manifest merge, Docker Hub description update |

### Agentic Workflows (GitHub Copilot)

These are AI-powered workflows using [GitHub Copilot Coding Agent](https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/about-assigning-tasks-to-copilot). Each `.md` file contains the agent prompt; the corresponding `.lock.yml` is the auto-generated compiled workflow (**do not edit `.lock.yml` files**).

| Prompt                                                 | Lock File                                                          | Schedule             | Purpose                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| [dependency-maintenance.md](dependency-maintenance.md) | [dependency-maintenance.lock.yml](dependency-maintenance.lock.yml) | Mon 14:00 UTC        | Batch-updates npm, Dockerfile patches, Alpine packages; validates, bumps patch version, creates PR |
| [ci-health-monitor.md](ci-health-monitor.md)           | [ci-health-monitor.lock.yml](ci-health-monitor.lock.yml)           | Wed 14:00 UTC        | Audits workflows for deprecated actions, Node.js runtime issues, stale Dependabot config           |
| [docs-drift-detector.md](docs-drift-detector.md)       | [docs-drift-detector.lock.yml](docs-drift-detector.lock.yml)       | PR (on code changes) | Audits README, DOCKER_README, CONTRIBUTING for drift against code changes                          |
| [agentics-maintenance.yml](agentics-maintenance.yml)   | —                                                                  | Daily 00:37 UTC      | Auto-closes expired discussions, issues, and PRs created by agentic workflows                      |

---

## Release Pipeline

The full release flow for dependency updates:

```
dependency-maintenance (Copilot)
  → creates PR with [deps] prefix
    → lint-and-test runs on PR
      → Copilot reviews + human merge
        → auto-release (creates tag + GitHub release)
          → publish-npm (triggered by release event)
          → docker-publish (triggered by lint-and-test on main)
```

For manual releases (feature/breaking changes), the maintainer runs `/bump-deploy` locally which pushes a tag and creates a GitHub release, triggering npm and Docker publish.

---

## Secrets Required

| Secret            | Used By                                             | Purpose                        |
| ----------------- | --------------------------------------------------- | ------------------------------ |
| `GITHUB_TOKEN`    | auto-release, security-update, agentics-maintenance | Git operations, issue creation |
| `NPM_TOKEN`       | publish-npm                                         | npm registry authentication    |
| `DOCKER_USERNAME` | docker-publish                                      | Docker Hub login               |
| `DOCKER_PASSWORD` | docker-publish                                      | Docker Hub login               |

---

## Editing Guidelines

- **YAML workflows** — edit directly, commit to `main` or via PR
- **Agentic `.md` prompts** — edit the `.md` file, then run `gh aw compile` to regenerate the `.lock.yml`
- **`.lock.yml` files** — **never edit manually**; always regenerate via `gh aw compile`
