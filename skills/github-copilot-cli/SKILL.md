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

The new GitHub Copilot agentic CLI is integrated directly into the GitHub CLI (`gh`). The older standalone `github-copilot-cli` package and the `gh-copilot` extension are deprecated. You must use `gh copilot` which now triggers the new agentic experience natively.

When integrated into an AI workflow (AI evaluating AI), it acts as a robust secondary reviewer mapping against different context windows and potentially different foundational models than the primary agent, significantly reducing confirmation bias during PR or full-repository reviews.

## Installation & Authentication Baseline

Before using the CLI in automated pipelines, ensure the terminal environment is equipped and authenticated:

```bash
# 1. Verify availability (will prompt to install the underlying component if missing)
gh copilot --version

# 2. Authenticate (Requires human interaction/browser approval)
gh auth login
```

## Agentic Interaction Strategies

Because the Copilot CLI is primarily interactive, standalone non-interactive agents cannot easily navigate its interactive UI natively for arbitrary open-ended tasks.

However, you can leverage its single-shot non-interactive mode (`-p`) for targeted tasks:

### Direct Tool Commands

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in non-interactive mode using the `-p` (or `--prompt`) flag. Omitting this flag will launch an interactive UI and hang the agent indefinitely. Use `-s` (silent) to suppress styling/decorations and output raw text.

For precise shell suggestions or file explanations in automated workflows:

```bash
# Shell Suggestion (Evaluates context and produces command)
gh copilot -p -s "find all files over 5mb in the current directory"

# File Explanation
gh copilot -p -s "explain src/utils/crypto.ts"
```

## Workflows Integration

This skill works synergistically with `github-commander`. Use the `copilot-audit` workflow via `github-commander` to execute a structured, auditable validation loop utilizing this CLI before generating PRs.
