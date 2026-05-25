# GitHub Automation Templates

Full templates for GitHub workflows, Dependabot, issue templates, and PR templates. Read on demand when setting up a new repo.

---

## Workflows

### .github/workflows/codeql.yml

All actions are SHA-pinned per security standards.

```yaml
name: "CodeQL Analysis"

on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]
  schedule:
    - cron: "0 0 * * 1"
  workflow_dispatch:

jobs:
  analyze:
    runs-on: ubuntu-latest
    if: ${{ github.event_name == 'workflow_dispatch' || github.event_name == 'schedule' || github.event_name == 'push' || github.event_name == 'pull_request' }}
    permissions:
      actions: read
      contents: read
      security-events: write
    strategy:
      fail-fast: false
      matrix:
        language: ["javascript-typescript"]
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
      - name: Check for JS/TS files
        id: check-files
        run: |
          if find . -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.mjs" -o -name "*.cjs" \) | grep -q .; then
            echo "has_code=true" >> $GITHUB_OUTPUT
          else
            echo "has_code=false" >> $GITHUB_OUTPUT
          fi
      - uses: github/codeql-action/init@0d579ffd059c29b07949a3cce3983f0780820c98 # v4
        if: steps.check-files.outputs.has_code == 'true'
        with:
          languages: ${{ matrix.language }}
          queries: security-extended,security-and-quality
      - uses: github/codeql-action/autobuild@0d579ffd059c29b07949a3cce3983f0780820c98 # v4
        if: steps.check-files.outputs.has_code == 'true'
      - uses: github/codeql-action/analyze@0d579ffd059c29b07949a3cce3983f0780820c98 # v4
        if: steps.check-files.outputs.has_code == 'true'
        with:
          category: "/language:${{matrix.language}}"
      - name: Skip notification
        if: steps.check-files.outputs.has_code == 'false'
        run: echo "No JavaScript/TypeScript files found. Skipping CodeQL analysis."
```

---

### .github/workflows/lint-and-test.yml

```yaml
name: Lint and Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22.x, 24.x, 25.x]

    steps:
      - name: Checkout code
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: ${{ matrix.node-version }}
          cache: "npm"

      - name: Cache node_modules
        id: cache-node-modules
        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4
        with:
          path: node_modules
          key: node-modules-${{ matrix.node-version }}-${{ hashFiles('package-lock.json') }}

      - name: Install dependencies
        if: steps.cache-node-modules.outputs.cache-hit != 'true'
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript check
        run: npm run typecheck

      - name: Build
        run: npm run build

      - name: Run tests
        run: npm run test

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Setup Node.js
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: "24.x"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run npm audit
        run: npm audit --audit-level=moderate
```

---

### .github/workflows/secrets-scanning.yml

```yaml
name: Secret Scanning

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          fetch-depth: 0

      - name: TruffleHog Secret Scanning
        uses: trufflesecurity/trufflehog@6c05c4a00b91aa542267d8e32a8254774799d68d # v3.93.8
        with:
          path: ./
          base: ${{ github.event.before || 'HEAD~1' }}
          head: HEAD
          extra_args: --only-verified

      - name: GITLEAKS Secret Scanning
        uses: gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### .github/workflows/dependabot-auto-merge.yml

```yaml
name: Dependabot auto-merge

on:
  pull_request:
    paths:
      - "package*.json"
      - ".github/workflows/dependabot-auto-merge.yml"

permissions:
  pull-requests: write
  contents: write

jobs:
  dependabot:
    runs-on: ubuntu-latest
    if: ${{ github.actor == 'dependabot[bot]' }}
    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@21025c705c08248db411dc16f3619e6b5f9ea21a # v2
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Enable auto-merge for Dependabot PRs
        if: ${{ steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor' }}
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Comment on major version updates
        if: ${{ steps.metadata.outputs.update-type == 'version-update:semver-major' }}
        uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '⚠️ This is a major version update. Please review carefully before merging.'
            })
```

---

### .github/workflows/e2e.yml

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    timeout-minutes: 15
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: lts/*
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Browsers
        run: npx playwright install --with-deps

      - name: Build
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          if-no-files-found: warn
          retention-days: 7
```

---

## Dependabot

### .github/dependabot.yml

Adapt the `groups` section to match the project's actual dependencies.

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "America/New_York"
    open-pull-requests-limit: 10
    reviewers:
      - "neverinfamous"
    labels:
      - "dependencies"
      - "npm"
    groups:
      build-tools:
        patterns:
          - "typescript*"
          - "tsup*"
          - "@types/*"
        update-types:
          - "minor"
          - "patch"
      linting:
        patterns:
          - "eslint*"
          - "@eslint/*"
          - "typescript-eslint*"
        update-types:
          - "minor"
          - "patch"
    commit-message:
      prefix: "chore"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "10:00"
      timezone: "America/New_York"
    open-pull-requests-limit: 5
    reviewers:
      - "neverinfamous"
    labels:
      - "dependencies"
      - "github-actions"
    groups:
      actions:
        patterns:
          - "actions/*"
        update-types:
          - "minor"
          - "patch"
    commit-message:
      prefix: "chore"
```

---

## Issue Templates

### .github/ISSUE_TEMPLATE/bug_report.md

```markdown
---
name: Bug Report
about: Create a report to help us improve
title: "[BUG] "
labels: ["bug"]
assignees: ""
---

## 🐛 Bug Description

A clear and concise description of what the bug is.

## 🔄 Steps to Reproduce

1. Go to '...'
2. Execute command '...'
3. See error

## ✅ Expected Behavior

A clear and concise description of what you expected to happen.

## ❌ Actual Behavior

A clear and concise description of what actually happened.

## 📱 Environment

- **OS:** [e.g. Windows 11, macOS 14, Ubuntu 22.04]
- **Node.js:** [e.g. 24.0.0]
- **Version:** [e.g. 1.0.0]
- **Installation:** [npm, Docker, local build]

## 🔍 Error Logs

```
Paste any error messages or stack traces here
```

## 🔧 Additional Context

Add any other context about the problem here.
```

---

### .github/ISSUE_TEMPLATE/feature_request.md

```markdown
---
name: Feature Request
about: Suggest a feature
title: "[FEATURE] "
labels: ["enhancement"]
assignees: ""
---

## 🚀 Feature Summary

A clear and concise description of the feature you'd like to see.

## 💡 Problem Statement

What problem does this solve? Why is it needed?

## 🎯 Proposed Solution

How could this work?

## 📊 Example Usage

```javascript
// Example of how this would be used
```

## 🔀 Alternatives Considered

Any alternative solutions or features you've considered.

## 📝 Additional Context

Any other context, mockups, or screenshots.
```

---

### .github/ISSUE_TEMPLATE/config.yml

```yaml
blank_issues_enabled: true
contact_links:
  - name: 📖 Documentation
    url: https://github.com/neverinfamous/{{REPO_NAME}}/wiki
    about: Check the wiki for documentation and guides
  - name: 💬 Discussions
    url: https://github.com/neverinfamous/{{REPO_NAME}}/discussions
    about: Ask questions and share ideas
```

---

### .github/pull_request_template.md

```markdown
## 📋 Summary

Brief description of the changes in this PR.

## 🎯 Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to change)
- [ ] 📚 Documentation update
- [ ] 🔧 Refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [ ] 🧪 Test addition or improvement

## 🔗 Related Issues

- Fixes #(issue number)

## 🔄 Changes Made

- Change 1: Description
- Change 2: Description

## 🧪 Testing Performed

- [ ] Manual testing
- [ ] Unit tests pass locally
- [ ] E2E tests pass locally

## ✅ Checklist

- [ ] Code follows the project's style guidelines
- [ ] Self-review of the code completed
- [ ] Tests added/updated as needed
- [ ] Documentation updated as needed
- [ ] No new warnings or errors introduced
```
