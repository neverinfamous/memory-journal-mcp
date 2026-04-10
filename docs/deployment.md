# Deployment Instructions for memory-journal-mcp

## How deployment works

The full CI/CD pipeline (`gatekeeper.yml`) triggers automatically on push to `main` or a `v*` tag. It runs four security gates in parallel, then deploys if all pass:

1. **Lint + Tests** (`lint-and-test.yml`)
2. **CodeQL** (`codeql.yml`)
3. **Secrets scanning** (`secrets-scanning.yml`)
4. **Trivy security scan** (`security-update.yml`)

If all four pass → `docker-publish.yml` runs → then `publish-npm.yml` runs.

## To trigger a release

**Option A — Automatic (push to main or tag):** Simply merge/push a tag (e.g., `v7.3.0`) to `main`. _(Note: Pushing directly to main without a tag will just run the validation gates without publishing)._

**Option B — Manual npm publish only (no Docker):** Go to Actions → "Publish to NPM" → Run workflow. Useful if Docker already published but npm failed.

## Required GitHub Secrets

Make sure these are set in Settings → Secrets → Actions:

| Secret            | Purpose                             |
| ----------------- | ----------------------------------- |
| `DOCKER_USERNAME` | Docker Hub login (`writenotenow`)   |
| `DOCKER_PASSWORD` | Docker Hub password or access token |
| `NPM_TOKEN`       | npm automation token                |

## Required GitHub Environments

Two protected environments must exist with appropriate approval rules:

| Environment  | Used by                        | URL                                                      |
| ------------ | ------------------------------ | -------------------------------------------------------- |
| `production` | Docker manifest push (on tags) | https://hub.docker.com/r/writenotenow/memory-journal-mcp |
| `npm`        | npm publish                    | https://www.npmjs.com/package/memory-journal-mcp         |

## What gets published

- **Docker Hub:** `writenotenow/memory-journal-mcp:latest`, `writenotenow/memory-journal-mcp:v<version>`, and a short SHA tag. Multi-arch: linux/amd64 + linux/arm64.
- **npm:** `memory-journal-mcp` (public, with provenance). Version is read from `package.json`. If the current version is already on npm, publish is skipped silently.

## Version bump checklist (before deploying)

Per the release process memory:

1. Update `package.json` version
2. Update `package-lock.json` (run `npm install`)
3. Update `server.json` version field
4. Update the OCI identifier tag in `server.json`

## Docker Scout gate

A security scan runs before any image is pushed. If Docker Scout finds critical/high CVEs with available fixes, the build fails and nothing publishes (neither Docker nor npm). You'll need to address the CVEs first.
