# Deployment Variants Reference

GitHub Actions workflows must adhere to the baseline standards, plus the specific standards for their target environment. The Evaluator must determine the correct variant based on the presence of npm publishing steps, Docker image builds, or purely GitHub-native operations (like linting or releases).

## 1. GitHub-Only Variant (Baseline Standard)

This variant applies to ALL workflows. If a workflow only builds, lints, tests, or manages GitHub releases, this is the only standard that applies.

**Requirements:**
- **SHA Pinning:** All `uses:` directives must use a full commit SHA. Tag pinning (`uses: actions/checkout@v4`) is strictly forbidden.
- **Minimum Permissions:** Workflow must specify restrictive default permissions (e.g., `permissions: contents: read`). Elevated permissions (e.g., `packages: write`) must be scoped to individual jobs.
- **Concurrency Control:** Workflows triggered by `pull_request` or `push` must include a `concurrency` block with `cancel-in-progress: true` to prevent stale runs and save runner minutes.
- **V4 Artifacts:** Must use `actions/upload-artifact@v4` and `actions/download-artifact@v4`. Mixing v3 and v4 is incompatible.
- **Fail-Fast Testing:** Matrix test jobs should set `fail-fast: false` to ensure all permutations run even if one fails.

## 2. NPM Deployment Variant

This variant applies to workflows that publish packages to the npm registry.

**Additional Requirements:**
- **Dependency Installation:** Must use `--frozen-lockfile` (e.g., `pnpm install --frozen-lockfile`) to ensure deterministic builds.
- **Package Manager Caching:** Must use the package manager's specific caching actions (e.g., `actions/setup-node` with `cache: pnpm`) rather than manually caching `node_modules`.
- **Secret Management:** NPM tokens must be injected safely (e.g., `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`). Never hardcode tokens or use `secrets: inherit` in reusable workflows.
- **Provenance:** Provenance generation should be enabled for npm publishes where applicable, following security best practices.

## 3. Docker Deployment Variant

This variant applies to workflows that build and push Docker images to registries (e.g., GHCR, Docker Hub).

**Additional Requirements:**
- **Multi-Stage Builds:** Dockerfiles triggered by the workflow must utilize multi-stage builds to keep the final image minimal.
- **Layer Caching:** Workflows should utilize Docker build layer caching (`actions/cache` or native registry caching `type=registry`) to speed up subsequent builds.
- **Vulnerability Scanning:** The workflow MUST include a security scanning step (e.g., `docker/scout-action` or Trivy) before pushing the final image. `continue-on-error: true` is forbidden on this step.
- **Immutable Tags:** Images must be tagged with explicit versions or commit SHAs. Pushing solely to the `latest` tag is an anti-pattern.

## Enforcement

When auditing, the Adversarial Tester must aggressively attempt to find violations of the appropriate variant's requirements. If a workflow is an NPM publisher, it must meet both the Baseline AND NPM variant rules.
