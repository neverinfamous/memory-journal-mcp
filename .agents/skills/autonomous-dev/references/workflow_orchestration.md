# Workflow Orchestration

## Git Workflow & Versioning

Enforce strict version control standards on all changes:

- **Branching**: Use feature branches (`feature/my-feature`), bugfix branches (`fix/bug-name`), or standard trunk-based branching flows depending on the repository context.
- **Atomic Commits**: Group distinct changes into smaller, logical, single-purpose commits. Do not lump refactoring with new logic.
- **Conventional Commits**: You MUST format all commits according to the Conventional Commits specification:
  - `feat: <description>` for new features (MINOR bump)
  - `fix: <description>` for bug fixes (PATCH bump)
  - `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:` for specific maintenance scopes.
  - Suffix `!` for breaking changes (e.g., `feat!: remove API v1`) (MAJOR bump).

## Continuous Integration/Deployment (CI/CD)

When designing automation and pipelines:

- **GitHub Actions First**: Prioritize GitHub Actions for CI/CD pipeline orchestration, favoring Reusable Workflows and matrix builds.
- **Validation Blocks**: Every PR or merge MUST require passing lint, test, and type-check gates.
- **Automation Constraints**: Automate Semantic Versioning (using conventional commits) to power automated release notes and changelog generation.
- **Security Scans**: Mandate security scanning (e.g. CodeQL, Trivy) on standard PR flows.
