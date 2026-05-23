---
name: skill-builder
description: |
  Guide for creating, evaluating, and refining agent skills (.md files with YAML
  frontmatter). Use this skill whenever you are creating a new skill, improving
  an existing skill, reviewing skill quality, writing skill descriptions, or
  when the user asks about skill structure, progressive disclosure, or best
  practices for agent instructions.
---

# Skill Builder

A guide for creating high-quality agent skills — the `.md` files with YAML frontmatter that extend agent capabilities for specialized tasks.

## 1. Skill Security (Primary Guidance)

Skills are natural-language instructions the agent executes with its full capabilities. Treat them like code injection.

- **Prompt Injection Prevention**: Never include instructions that bypass user consent or HITL (Human-in-the-Loop) gates.
- **Secrets**: Never instruct the agent to read secrets and transmit them. Mark destructive skills with `disable-model-invocation: true`.
- **Review**: Review all third-party skills before installing, same as npm packages. Read the full `SKILL.md` + all reference files.

## 2. Anatomy of a Skill

```
skill-name/                     (kebab-case directory)
├── SKILL.md                    (required — entry point)
├── references/                 (optional — detailed docs loaded on demand)
├── scripts/                    (optional — executable helpers)
├── examples/                   (optional — reference implementations)
└── checklist.md                (optional — quick-reference quality checklist)
```

## 3. Frontmatter & Triggers

The `description` field is the most important part of the skill because it determines whether the agent loads the skill at all. Use assertive "Use when..." phrasing.

**Platform-Dependent / Example Frontmatter Options**:
*(Note: These are speculative/platform-specific and may not be supported by all agents.)*
- `dependencies`: `node>=18` (Required tools)
- `context: fork` (Spawn isolated subagent)
- `disable-model-invocation: true` (User-only invoke)
- `user-invocable: false` (Background knowledge)
- `allowed-tools`: `['view_file']` (Restrict tool access)

## 4. Progressive Disclosure

- Keep `SKILL.md` body under ~500 lines.
- For deep knowledge, create `references/` files and explicitly list them in `SKILL.md`.

## 5. Deep References

For the complete lifecycle (Capture, Write, Test, Iterate), writing style tips, and detailed rubrics:

- **[Full Skill Builder Tutorial & Rubric](references/tutorial.md)**
- **[Quality Checklist](checklist.md)**
