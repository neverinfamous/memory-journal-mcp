# Copilot Skill Prompts

Reference for Phase 4 — independent validation via the GitHub Copilot CLI.

## Prerequisites

1. **Copilot CLI installed**: `npm list -g @github/copilot`
2. **Authenticated**: `copilot auth`

If unavailable, skip Phase 4 gracefully.

## Prompt Templates

### Skill Quality Review

Primary Phase 4 prompt:

```bash
echo "You are an expert in AI agent instruction design. Review these agent skill files for quality. Each skill is a markdown file with YAML frontmatter that controls when an AI agent loads it, and a body of instructions the agent follows.

Evaluate each skill on:
1. **Trigger reliability** — Will the description reliably trigger the skill for relevant user prompts? Is it too narrow (misses valid prompts) or too broad (fires on unrelated prompts)?
2. **Instruction clarity** — Are the instructions clear, unambiguous, and in imperative form? Will an AI agent follow them correctly or deviate?
3. **Completeness** — Are edge cases handled? What happens when prerequisites are missing?
4. **Token efficiency** — Is the description concise (~100 words)? Is the body under ~500 lines? Is content appropriately split between main file and references?
5. **Security** — Are there any instructions that could cause unsafe agent behavior (reading secrets, destructive actions without user approval)?

Here are the skill files:

$(find skills/ -name 'SKILL.md' | while read f; do echo "=== \$f ==="; head -80 "\$f"; echo; done)

Output a Markdown table with columns: #, Skill, Category, Severity, Finding, Suggestion." | copilot
```

### Trigger Collision Analysis

```bash
echo "You are an AI agent routing expert. Given these skill descriptions, identify which skills would compete to handle the same user prompt. For each collision, suggest how to disambiguate.

Skill descriptions:

$(find skills/ -name 'SKILL.md' | while read f; do echo "=== \$f ==="; head -15 "\$f" | grep -A 20 'description:'; echo; done)

Test these ambiguous prompts:
- 'Deploy my app'
- 'Set up the database'
- 'Write tests for this'
- 'Fix security issues'
- 'Optimize performance'
- 'Build a server'
- 'Set up CI/CD'

Output a collision table and disambiguation recommendations." | copilot
```

## Parsing Copilot Output

1. **Extract findings** — parse tables or numbered lists
2. **Map to categories** — classify against the 8 per-skill or 4
   directory-level categories
3. **Deduplicate** — compare against Phase 2 findings
4. **Disposition** — apply Accept/Reject/Modify/Defer from Phase 3

## Prompt Selection Guide

| Audit Depth | Prompts to Use |
| --- | --- |
| Surface | Skill Quality only |
| Standard | Skill Quality + Trigger Collision |
| Thorough | Both prompts |
