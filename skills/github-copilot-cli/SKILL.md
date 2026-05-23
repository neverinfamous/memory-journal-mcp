---
name: github-copilot-cli
description: |
  Documentation and instructions for integrating the GitHub Copilot CLI (`copilot`)
  into agentic workflows. Use this skill when you need a "second opinion" adversarial
  review of a local codebase, a pre-push PR review using alternative advanced models,
  or shell suggestion capabilities from GitHub. Activates on "Copilot CLI", "local PR review",
  or "codebase Copilot review".
---

# GitHub Copilot CLI

The GitHub Copilot CLI (`gh copilot`) acts as an interactive, terminal-native representation of the Copilot agentic ecosystem.

When integrated into an AI workflow (AI evaluating AI), it acts as a robust secondary reviewer mapping against different context windows and potentially different foundational models than the primary agent, significantly reducing confirmation bias during PR or full-repository reviews.

## Installation & Authentication Baseline

Before using the CLI in automated pipelines, ensure the terminal environment is equipped and authenticated:

```bash
# 1. Verify availability
gh extension list | grep copilot

# 2. Install if missing
gh extension install github/gh-copilot

# 3. Authenticate (Requires human interaction/browser approval)
gh auth login
gh copilot --version
```

## Agentic Interaction Strategies

Because the Copilot CLI is primarily interactive, standalone non-interactive agents cannot easily navigate its interactive UI natively for arbitrary open-ended tasks.

However, you can leverage its single-shot explanation or suggestion endpoints for targeted tasks:

### Direct Tool Commands

For precise shell suggestions or file explanations:

```bash
# Shell Suggestion (Evaluates context and produces command)
gh copilot suggest "find all files over 5mb in the current directory"

# File Explanation
gh copilot explain "src/utils/crypto.ts"
```

## Workflows Integration

This skill works synergistically with `github-commander`. Use the `copilot-audit` workflow via `github-commander` to execute a structured, auditable validation loop utilizing this CLI before generating PRs.
