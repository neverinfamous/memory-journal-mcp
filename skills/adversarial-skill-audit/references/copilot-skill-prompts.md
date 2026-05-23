# Copilot Skill Prompts

Reference for Phase 4 — independent validation via the GitHub Copilot CLI.

## Prerequisites

1. **Copilot CLI installed**: `gh extension list | grep copilot` or install via `gh extension install github/gh-copilot`
2. **Authenticated**: `gh auth status` and `gh copilot --version`

If unavailable, skip Phase 4 gracefully.

## Prompt Templates

### Skill Quality Review

> **Note:** The `gh copilot` CLI extension does not natively support non-interactive file stream piping for open-ended prompts like the deprecated `@github/copilot` npm package did.
> For Phase 4 audits, you must either:
> 1. Fall back to manual Copilot Chat window usage with the prompt templates.
> 2. Document the limitation in the `skill_audit_copilot` journal entry and mark Phase 4 as manually bypassed.

If using Copilot Chat manually, you can use these prompts:

**Skill Quality:**
"You are an expert in AI agent instruction design. Review these agent skill files for quality. Evaluate each skill on:
1. **Trigger reliability** — Will the description reliably trigger the skill for relevant user prompts?
2. **Instruction clarity** — Are the instructions clear, unambiguous, and in imperative form?
3. **Completeness** — Are edge cases handled? What happens when prerequisites are missing?
4. **Token efficiency** — Is the description concise (~100 words)? Is the body under ~500 lines?
5. **Security** — Are there any instructions that could cause unsafe agent behavior?"

**Trigger Collision Analysis:**
"You are an AI agent routing expert. Given these skill descriptions, identify which skills would compete to handle the same user prompt. For each collision, suggest how to disambiguate. Test these ambiguous prompts:
- 'Deploy my app'
- 'Set up the database'
- 'Write tests for this'
- 'Fix security issues'
- 'Optimize performance'
- 'Build a server'
- 'Set up CI/CD'"

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
