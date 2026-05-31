# Copilot Skill Prompts

Reference for Phase 4 — independent validation via the GitHub Copilot CLI.

## Prerequisites

1. **GitHub CLI installed**: `gh --version` (v2.x+)
2. **Authenticated**: `gh auth status` passing
3. **Copilot available**: `gh copilot --version` — the `copilot` subcommand is built into modern `gh` CLI (no separate extension needed)

If Copilot CLI is not available, skip Phase 4 gracefully.

## Prompt Templates

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in
> non-interactive mode using the `-p` (or `--prompt`) flag. Interactive mode
> will hang indefinitely in an automated agent context. Use:
>
> ```
> gh copilot -p "<prompt>" --allow-tool "shell(find,cat,head,grep)"
> ```
>
> The `--allow-tool` flag grants Copilot read access to the repository files.

- Expect 60–120 seconds per prompt. In environments with hard synchronous timeouts (like Antigravity's 10s `WaitMsBeforeAsync` limit), allow the command to naturally fall into the background. Use the `schedule` tool or wait for the system notification to retrieve the results. Do not skip execution due to timeout constraints.

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

**Ecosystem Consistency and Coverage Gap Analysis:**
"You are an expert in developer tooling ecosystems. Evaluate the overall structure and coverage of this skills directory. Identify:

1. Are there common development tasks or technologies relevant to modern Node/TypeScript/Cloudflare stacks that are missing skill coverage?
2. Are there organizational or naming inconsistencies across the skills?
3. Which skills should potentially be merged or deprecated due to high overlap?"

## Parsing Copilot Output

1. **Extract findings** — parse tables or numbered lists
2. **Map to categories** — classify against the 8 per-skill or 4
   directory-level categories
3. **Deduplicate** — compare against Phase 2 findings
4. **Disposition** — apply Accept/Reject/Modify/Defer from Phase 3

## Prompt Selection Guide

| Audit Depth | Prompts to Use                                            |
| ----------- | --------------------------------------------------------- |
| Surface     | Skill Quality only                                        |
| Standard    | Skill Quality + Trigger Collision + Ecosystem Consistency |
| Thorough    | All three prompts                                         |
