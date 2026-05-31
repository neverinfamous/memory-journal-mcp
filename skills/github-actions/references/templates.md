# GitHub Actions Templates

## Resolve SHA Manually

To manually resolve a commit SHA for a GitHub Action using the GitHub CLI (`gh`):

```bash
# Resolve SHA: gh api /repos/actions/checkout/git/refs/heads/main --jq '.object.sha'
```

## Standard CI Template

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run typecheck

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: actions/setup-node@<sha> # v4
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
```
