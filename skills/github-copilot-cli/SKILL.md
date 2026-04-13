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

The GitHub Copilot CLI (`@github/copilot`) acts as an interactive, terminal-native representation of the Copilot agentic ecosystem.

When integrated into an AI workflow (AI evaluating AI), it acts as a robust secondary reviewer mapping against different context windows and potentially different foundational models than the primary agent, significantly reducing confirmation bias during PR or full-repository reviews.

## Installation & Authentication Baseline

Before using the CLI in automated pipelines, ensure the terminal environment is equipped and authenticated:

```bash
# 1. Verify availability
npm list -g @github/copilot

# 2. Install if missing
npm i -g @github/copilot

# 3. Authenticate (Requires human interaction/browser approval)
copilot auth
```

## Agentic Interaction Strategies

Because the Copilot CLI launches an interactive REPL (`? What would you like to do?`), standalone non-interactive agents cannot easily navigate its interactive curses UI natively.

To effectively harness it during automated reviews, you must format non-interactive input buffers or leverage its single-shot explanation endpoints:

### Non-Interactive Command Piping

While primarily interactive, you can echo requests directly into the tool for one-shot evaluation loops.

```bash
# Full Repository Security Audit
echo "Please perform a comprehensive security analysis of all files in this repository. Point out unchecked injections, logic flaws, and credential leaks. Present it in markdown." | copilot

# Pre-Push PR Diff Review
git diff main | copilot "Act as a strict PR reviewer. Here is my local diff against main. List specifically what will break, style issues, and any unhandled edge cases."
```

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
