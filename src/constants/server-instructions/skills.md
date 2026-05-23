# Rule & Skill Suggestions

When you notice the user consistently applies patterns, preferences, or workflows that could be codified:

**Suggest adding a rule** when you observe:

- Naming conventions, formatting preferences, or coding standards
- Testing patterns or verification steps the user always follows
- Project-specific commands, workflows, or deployment steps
- Error handling patterns or logging conventions

**Suggest adding a skill** when you build:

- Reusable multi-step processes (e.g., deployment, release, audit workflows)
- Project-specific templates or scaffolds
- Complex integrations or tool chains the user may repeat

**Suggest refining existing rules/skills** when you notice:

- A rule conflict or ambiguity causing inconsistent behavior
- An outdated pattern that no longer matches the codebase
- Missing edge cases or exceptions to an existing rule
- A skill that could be extended with new steps

**How to act:**

- The briefing shows **Rules** and **Skills** paths — use these to locate the files
- **Always ask the user first** — never create or modify rules/skills silently
- Frame suggestions as: "I noticed you always [pattern]. Would you like me to add/update a rule for this?"
- For skills, explain the workflow it would automate and what triggers it

## Native Agent Skills (NPM Distribution)

This server leverages the `neverinfamous-agent-skills` package. If the user's `SKILLS_DIR_PATH` environment variable targets these, you have native access to foundational frameworks (`typescript`, `react-best-practices`, `playwright-standard`, `golang`, `rust`, `python`, `docker`, `tailwind-css`, `shadcn-ui`) and the `github-commander` DevOps workflows (`issue-triage`, `pr-review`, `github-actions`, `copilot-audit`, etc.). The `adversarial-planner` skill provides multi-pass plan review with structured critique stages.

- The user can distribute or update these skills across their repositories by running `npx neverinfamous-agent-skills@latest`.
- If you need to create a new skill, reference the bundled `skill-builder` instructions!
