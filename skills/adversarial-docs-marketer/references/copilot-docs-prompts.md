# Copilot Documentation Marketing Prompts

Prompt templates for Phase 4 external validation using `gh copilot`. Each
prompt targets a specific dimension of documentation marketability.

> **⚠️ CRITICAL**: Use non-interactive mode (`-p` flag). See
> [copilot-usage.md](copilot-usage.md) for execution requirements.

---

## Prompt 1: First Impression Evaluation

```
gh copilot -p "You are a developer evaluating this project for the first time. Read README.md and answer in under 200 words: (1) What does this project do? (2) Why should I choose it over alternatives? (3) What's my fastest path to trying it? (4) What critical information is missing from the first screen? Rate the first impression 1-5." --allow-tool "shell(find,cat,head,grep)"
```

## Prompt 2: Feature Visibility Gap Analysis

```
gh copilot -p "Compare the features documented in README.md against the actual tool groups defined in the source code (check src/filtering/ for tool definitions). List any capabilities that exist in source code but are NOT prominently mentioned in the README. For each gap, rate its marketing impact as Critical/High/Medium/Low." --allow-tool "shell(find,cat,head,grep)"
```

## Prompt 3: Competitive Positioning Review

```
gh copilot -p "Read the README.md 'What Sets Us Apart' section (or equivalent). For each differentiator listed: (1) Is it specific or generic? (2) Is it backed by evidence? (3) Would it convince a skeptic? Then suggest 3 improvements to strengthen the competitive positioning." --allow-tool "shell(find,cat,head,grep)"
```

## Prompt 4: Onboarding Friction Assessment

```
gh copilot -p "Follow the Quick Start instructions in README.md as if you were setting up this project for the first time. Identify every point where you would need to: (1) look up external documentation, (2) make an assumption not documented, (3) troubleshoot an unclear step. Rate the onboarding experience 1-5." --allow-tool "shell(find,cat,head,grep)"
```

## Prompt 5: Cross-Surface Consistency Check

```
gh copilot -p "Compare README.md, DOCKER_README.md (if it exists), and any wiki pages in a .wiki/ directory. Report any inconsistencies in: (1) feature counts or tool numbers, (2) version references, (3) configuration examples, (4) feature naming or descriptions. List each inconsistency with its location." --allow-tool "shell(find,cat,head,grep)"
```

## Prompt 6: Documentation Tone Analysis

```
gh copilot -p "Analyze the writing tone across README.md. Report: (1) instances of passive voice that weaken the message, (2) hedging language (hopefully, should, might), (3) inconsistencies in formality level between sections, (4) overuse of superlatives without evidence. Suggest 5 specific tone improvements." --allow-tool "shell(find,cat,head,grep)"
```

---

## Repository Context

Before running any prompt, you MUST `Set-Location` to the target repository's
absolute path. The prompts reference files like `README.md` and
`DOCKER_README.md` relative to the working directory. If the target repo has
a wiki clone, ensure the `.wiki/` sibling directory is accessible from the
parent.

```powershell
# Example: targeting memory-journal-mcp
Set-Location C:\Users\chris\Desktop\memory-journal-mcp
```

If the repository has multiple documentation surfaces in different paths
(e.g., wiki clone at `<repo>.wiki/`), run wiki-related prompts from the
parent directory and adjust the prompt to specify the wiki path explicitly.

## Usage Notes

- Run each prompt separately — combining them degrades quality.
- Always `Set-Location` to the target repository before invoking.
- Expect 60–120 seconds per prompt.
- If `gh copilot` is unavailable, skip Phase 4 gracefully and note the skip.
- Merge Copilot findings with Phase 2 findings for the final disposition table.

## Prompt Improvement

These prompts are starting points, not fixed scripts. If a prompt produces
weak or unhelpful results during an audit:

1. **Note the gap** in your Phase 4 journal entry under
   `### Prompt Improvement Opportunity`
2. **Suggest a revision** — concrete wording changes, additional context, or
   restructured questions
3. **Test the revision** if time permits — run the improved prompt in the
   same session to validate

Over time, these observations accumulate in the journal and inform future
skill refinement cycles. The goal is for each audit to leave the skill
slightly better than it found it.
