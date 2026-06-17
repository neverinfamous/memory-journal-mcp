# Audit Categories Reference

The Adversarial Tester must evaluate the workflow against the following three strict categories. Any violation is a hard failure requiring immediate remediation.

## 1. Security Check

The most critical pass. Workflows are primary targets for supply chain attacks.

- **Untrusted Input Injection:** Reject any `run` script that directly interpolates untrusted GitHub contexts (e.g., `${{ github.event.pull_request.title }}`, `${{ github.head_ref }}`). These must be passed via intermediate environment variables.
- **Over-Permissioning:** Reject `permissions: write-all` entirely. Reject workflow-level write permissions if they can be scoped to a specific job.
- **SHA Pinning Bypass:** Reject any third-party action using a version tag (e.g., `@v4`, `@v2.1`). Must use a 40-character commit SHA, ideally with a trailing comment (e.g., `@<sha> # v4.0.0`).
- **Security Gate Suppression:** Reject `continue-on-error: true` on any step related to security scanning (Docker Scout, Trivy, CodeQL, npm audit).
- **Secret Bleed:** Ensure `secrets: inherit` is not used loosely in reusable workflows. Pass secrets explicitly.

## 2. Reliability Check

Ensuring the workflow executes deterministically and handles edge cases.

- **Missing Lockfiles:** Package installation must enforce lockfiles (`--frozen-lockfile`, `npm ci`).
- **Missing Concurrency Limits:** Workflows that run on PRs must include concurrency cancellation to prevent queue exhaustion from rapid commits.
- **Hardcoded Runtime Versions:** Reject hardcoded Node/Python versions (`node-version: 22`). Must use `.node-version` or `.python-version` files to prevent environment drift.
- **Artifact Version Collisions:** Using `@v3` and `@v4` artifact actions in the same pipeline will cause corruption. Enforce `@v4` uniformly.

## 3. Performance Check

Minimizing runner minutes and accelerating feedback loops.

- **Missing or Inefficient Caches:** Caching must be keyed off the lockfile hash (`hashFiles('pnpm-lock.yaml')`).
- **Redundant Matrix Runs:** If a matrix defines permutations that are invalid or unnecessary, enforce `exclude` blocks to prune them.
- **Bloated Images (Docker Variant):** If caching is absent for Docker builds, flag it for remediation to prevent pulling base images on every run.
- **Redundant Steps:** Identify any steps that install global tooling unnecessarily if the base runner already includes them, or steps that are not relevant to the job's outcome.
