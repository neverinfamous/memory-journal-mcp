---
name: skill-builder
description: |
  Guide for creating, evaluating, and refining agent skills (.md files with YAML
  frontmatter). Use this skill whenever you are creating a new skill, improving
  an existing skill, reviewing skill quality, writing skill descriptions, or
  when the user asks about skill structure, progressive disclosure, or best
  practices for agent instructions. Also use when someone says "turn this into
  a skill", "make a skill for X", or "improve this skill".
---

# Skill Builder

A guide for creating high-quality agent skills — the `.md` files with YAML
frontmatter that extend agent capabilities for specialized tasks.

This skill covers the full lifecycle: capturing intent, writing the skill,
testing it, and iterating based on feedback. The principles here apply regardless
of which agent platform you're targeting.

## Quick Reference

| Phase | What You Do |
|---|---|
| **1. Capture Intent** | Understand what the skill should do and when it should trigger |
| **2. Write the Skill** | Create SKILL.md with frontmatter, instructions, and references |
| **3. Test** | Write realistic prompts and validate the agent follows the skill |
| **4. Iterate** | Improve based on feedback, keep lean, bundle repeated patterns |
| **5. Optimize Description** | Tune the frontmatter description for reliable triggering |

---

## Phase 1 — Capture Intent

Start by understanding what the user wants. If the conversation already contains
a workflow worth capturing (e.g., "turn this into a skill"), extract as much as
you can from the conversation first — tools used, sequence of steps, corrections
the user made, input/output patterns observed.

### Questions to Answer

1. **What should this skill enable the agent to do?**
   The core capability — be specific about inputs, outputs, and scope.

2. **When should this skill trigger?**
   What user phrases, contexts, or tool patterns should activate it?
   Think broadly — agents tend to *under-trigger* skills, so include edge cases.

3. **What's the expected output format?**
   Files, structured data, reports, code changes, terminal commands?

4. **What are the edge cases?**
   Missing inputs, conflicting requirements, platform differences?

5. **What prerequisites does the skill assume?**
   Tools, CLIs, API keys, project structure?

---

## Phase 2 — Write the Skill

### Anatomy of a Skill

```
skill-name/                     (kebab-case directory)
├── SKILL.md                    (required — entry point)
├── references/                 (optional — detailed docs loaded on demand)
│   ├── api-reference.md
│   └── troubleshooting.md
├── scripts/                    (optional — executable helpers)
├── examples/                   (optional — reference implementations)
└── checklist.md                (optional — quick-reference quality checklist)
```

### YAML Frontmatter (Required)

```yaml
---
name: skill-name
description: |
  What the skill does AND when to use it. This is the primary triggering
  mechanism — include specific contexts, keywords, and phrases that should
  activate it. Be assertive to avoid under-triggering.
---
```

The `description` field is the most important part of the skill because it
determines whether the agent loads the skill at all. A description that's too
narrow or passive means the skill sits unused even when it would help.

### Optional Frontmatter Fields

```yaml
---
name: deploy-prod
description: |
  Deploy to production with validation gates...
dependencies: node>=18, gh>=2.0    # Required tools/runtimes
context: fork                       # Spawn isolated subagent (fresh context)
disable-model-invocation: true      # User-only invoke (prevents auto-trigger)
user-invocable: false              # Agent-only (background knowledge)
allowed-tools: ["view_file", "search"] # Restrict tool access during skill activation
metadata:
  internal: true                    # Hides from CLI discovery by default
---
```

| Field | When to Use |
|---|---|
| `dependencies` | Skill requires specific tools or runtimes — prevents cryptic failures |
| `context: fork` | Task is concrete, self-contained, and resource-heavy (deep file reads, prototyping). Prevents context pollution. **Don't use for guidelines-only skills** — fork returns empty without a concrete task |
| `disable-model-invocation` | Skill has destructive side effects (deploy, commit, delete). Agent can't auto-trigger |
| `user-invocable: false` | Background knowledge the agent should absorb, not a user-facing command |
| `allowed-tools` | Limit an agent's available tools when this skill triggers to enforce security guidelines. |
| `metadata.internal` | Set to `true` for WIP or CI-only skills. Requires `INSTALL_INTERNAL_SKILLS=1` to install via CLI. |

### Progressive Disclosure (3-Tier)

Skills use a three-level loading system to manage token budgets:

| Tier | What | Token Cost | When Loaded |
|---|---|---|---|
| **Metadata** | `name` + `description` in frontmatter | ~50-100 tokens | Always in context |
| **SKILL.md body** | Main instructions | ~500-2000 tokens | When skill triggers |
| **References** | Detailed docs in `references/` | Unlimited | On demand, as needed |

**Guidelines:**
- Keep `SKILL.md` body under ~500 lines. If approaching this, add a layer of
  hierarchy with `references/` files and clear pointers about when to read them
- Reference files can be any length but should include a table of contents if
  over ~300 lines
- For large reference files, include a summary at the top so the agent can
  decide whether to read the full content

### Domain Organization

When a skill supports multiple variants (frameworks, languages, platforms),
organize by variant in `references/`:

```
cloud-deploy/
├── SKILL.md                    (workflow + variant selection logic)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

The agent reads only the relevant reference file based on context, saving tokens.

### Context Hygiene

The description is always loaded (~50-100 tokens per skill). With many skills
installed, this adds up.

- **Challenge every token.** For each line in SKILL.md, ask: "Does this
  instruction justify its token cost in every conversation?"
- **Prefer pointers to copies.** Instead of embedding large code blocks, link
  to reference files. The agent loads them on demand.
- **Trust the model.** Instead of prescribing HOW to use a reference file,
  describe WHAT the file is. LLMs navigate references well on their own.
- **Keep reference depth shallow.** References should be one hop from SKILL.md —
  avoid chains (SKILL → ref-A → ref-B → ref-C).

---

## Phase 3 — Writing Style

The quality of a skill's instructions directly determines how well agents follow
them. These principles come from observing what actually works in practice.

### Explain the Why, Not Just the What

Today's LLMs are smart. They have good theory of mind and when given a good
explanation of *why* something matters, they go beyond rote instruction-following
and make better decisions in novel situations.

**Instead of:**
```markdown
ALWAYS use parameterized queries. NEVER interpolate user input into SQL.
```

**Prefer:**
```markdown
Use parameterized queries for all user-supplied values. Raw string
interpolation in SQL creates injection vulnerabilities — an attacker could
append `; DROP TABLE users` to any input field. Parameterized queries let
the database engine handle escaping, which is both safer and handles edge
cases (quotes, unicode) that manual escaping misses.
```

The second version helps the agent understand *when* the rule applies and *why*,
so it makes better judgment calls in ambiguous situations.

### Keep It Lean

Remove instructions that aren't pulling their weight. If test runs show the
agent spending time on unproductive steps, cut those sections. A shorter skill
that works is better than a comprehensive skill that overwhelms.

### Generalize from Examples

Skills will be used across many different prompts and projects. When iterating
on a skill based on feedback from a few test cases, resist the urge to add
narrow fixes that only help those specific cases. Instead, generalize the
underlying insight into a principle that helps across all cases.

### Use Imperative Form

Write instructions as direct commands:
- ✅ "Run the lint command before committing"
- ❌ "The lint command should be run before committing"
- ❌ "You might want to run the lint command"

### Define Output Formats Explicitly

When the skill produces structured output, show the exact template:

```markdown
## Report Structure
Use this template for findings:

### [Category] — [Severity]
**File:** `path/to/file.ts:L42-L58`
**Finding:** Description of the issue
**Fix:** Concrete remediation step
```

---

## Skill Security

Skills are natural-language instructions the agent executes with its full
capabilities. A malicious skill is functionally equivalent to code injection — and
traditional malware scanners can't analyze natural-language payloads.

### Supply Chain

- Review third-party skills before installing, same as npm packages
- Pin skill versions (Git tags or commit SHAs) — don't float on `main`
- Read the full SKILL.md + all reference files before trusting a third-party skill
- Prefer skills from known authors; verify authorship via signed commits

### Prompt Injection Prevention

- Never include instructions that bypass user consent or HITL gates
- Never instruct the agent to read secrets (API keys, tokens) and transmit them
- Skills should not instruct the agent to modify its own config or other skills
- Mark destructive skills with `disable-model-invocation: true`

### Least Privilege

- Document required tools and CLIs so users know what capabilities are granted
- If a skill runs shell commands, restrict to specific commands — don't use
  open-ended exec patterns

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| **Wall of MUSTs** | Agent treats all rules as equal priority; real priorities get lost | Explain reasoning, let agent derive the rule |
| **Overfitting to test cases** | Skill works for 3 prompts but fails on the 4th | Generalize the underlying principle |
| **Passive description** | "Helps with deployment" → agent never triggers | Use assertive "Use when..." phrasing |
| **Monolithic SKILL.md** | 800+ lines → token overflow, poor comprehension | Split into references at ~500 lines |
| **Kitchen-sink skill** | Tries to handle 5 unrelated tasks | One skill = one job; create separate skills |
| **Embedding secrets** | API keys in instructions → leaked to logs | Document as env var prerequisites |
| **No HITL gates** | Destructive actions without user approval | Use `disable-model-invocation: true` |

---

## Phase 4 — Test Scenarios

After writing the skill draft, create 2-5 realistic test prompts — the kind of
thing a real user would actually say. These aren't automated tests; they're
manual validation that the agent follows the skill correctly.

### Writing Good Test Scenarios

1. **Be realistic** — use actual user phrasing, not formal specifications
2. **Cover the trigger range** — include prompts that should trigger the skill
   and edge cases that are borderline
3. **Vary complexity** — include a simple case, a medium case, and a hard case
4. **Include context** — specify what files exist, what state the project is in

### Example Test Scenarios

```markdown
## Test 1: Simple issue fix
"Fix issue #42 — the README has a broken link in the installation section"
Expected: Agent loads skill, gathers context, fixes link, runs gates, submits PR

## Test 2: Audit request
"Run a security audit on this project"
Expected: Agent loads skill, detects available tools, runs scans, journals findings

## Test 3: Edge case — no GitHub configured
"Fix the bug where users can't login"
Expected: Agent attempts to load skill, handles missing GITHUB_TOKEN gracefully
```

### Evaluation Rubric

Score each test run on these dimensions:

| Dimension | 1 (Poor) | 3 (Good) | 5 (Excellent) |
|---|---|---|---|
| **Trigger accuracy** | Loads <50% of the time | ~80% correct | All intended prompts trigger correctly |
| **Instruction following** | Skips >2 steps | Minor deviations | All steps followed, branches handled |
| **Edge case handling** | Crashes or hallucinates | Returns generic error | Structured, actionable error |
| **Output quality** | Wrong format | Correct format, minor gaps | Exact template match |
| **Token efficiency** | Loads everything always | Reads some references | Progressive disclosure used correctly |

### Validation

For each test scenario, verify:
- Did the agent load the skill? (Check if it followed the workflow)
- Did it follow the steps in order?
- Did it handle edge cases gracefully?
- Was the output format correct?
- Did it ask for human input at the right moments?

### Preventing Regressions

After improving a skill, re-run ALL previous test scenarios — not just the one
that prompted the change. Skills tend to "fix one, break two" when changes are
made without regression checking.

---

## Phase 5 — Iteration

After testing, improve the skill based on what you observed.

### How to Think About Improvements

1. **Generalize from feedback.** If a test case exposed a gap, don't add a
   narrow fix for that specific case. Ask: "What general principle would have
   prevented this?" Add that principle instead.

2. **Keep the skill lean.** Read the agent's execution trace, not just the final
   output. If the skill is making the agent waste time on unproductive steps,
   remove those instructions.

3. **Bundle repeated patterns.** If every test run resulted in the agent writing
   similar helper logic, that's a signal to bundle it. Write it once as a script
   or reference file, and tell the skill to use it.

4. **Avoid overfitting.** If you find yourself adding increasingly specific
   MUSTs and NEVERs, step back. Try explaining the underlying reasoning instead.

### The Iteration Loop

1. Apply improvements to the skill
2. Re-run test scenarios mentally or with an agent
3. Check: did the changes help across *all* scenarios, not just the one that
   prompted the change?
4. Repeat until satisfied or diminishing returns

### Skill Versioning

Treat skills like code — they affect agent behavior in production.

- Use Git tags or commit SHAs to pin shared skill versions
- Document behavior changes in commit messages or a `CHANGELOG.md`
- Breaking changes (renamed fields, removed steps) deserve explicit migration notes
- When shipping skills in an npm package, include in the `files` array

---

## Phase 6 — Description Optimization

The `description` field in YAML frontmatter is the primary mechanism that
determines whether an agent invokes a skill. After creating or improving a
skill, optimize the description for reliable triggering.

### Principles

1. **Be assertive.** Agents tend to under-trigger skills. Include phrases like
   "Use this skill whenever..." and "Also use when..." to push the agent toward
   loading the skill in relevant contexts.

2. **Cover trigger keywords.** List the specific words and phrases users might
   say that should activate this skill. Think beyond the obvious:
   - Primary: "build MCP server", "create tools"
   - Secondary: "MCP integration", "tool design"
   - Tertiary: "connect AI to API", "LLM service integration"

3. **Include both what AND when.** Don't just describe the skill's capabilities —
   describe the contexts where it should be used.

4. **Keep it under ~100 words.** The description is always in context, so it
   costs tokens on every interaction. Be assertive but concise.

### Example — Before vs. After

**Before (passive, narrow):**
```yaml
description: Guide for creating MCP servers using Node/TypeScript.
```

**After (assertive, broad):**
```yaml
description: |
  Guide for creating high-quality MCP servers that enable LLMs to interact
  with external services through well-designed tools. Use when building MCP
  servers, designing tool schemas, implementing error handling for agent
  consumption, or when the user asks about tool design, MCP protocol, or
  connecting AI to APIs using Node/TypeScript (MCP SDK).
```

---

## Reference: Quality Checklist

See [checklist.md](checklist.md) for a quick-reference quality review checklist.

---

## 🛠️ The Skills Ecosystem & CLI

The community standard for sharing and installing AI agent skills is the [`skills` CLI](https://skills.sh/). It parses your standard `SKILL.md` repositories and packages them for distribution.

```bash
# Add a skill from a public repository
npx skills add vercel-labs/agent-skills

# Browse available skills in a repo before installing
npx skills add my-org/internal-skills --list

# Include internal/WIP skills in the discovery payload
INSTALL_INTERNAL_SKILLS=1 npx skills add my-org/internal-skills
```

### Agent Integration & Discovery Paths

Almost all leading AI coding assistants (Claude Code, Cursor, OpenHands, Antigravity, Kiro CLI, Amp, Roo Code, GitHub Copilot) comply with the semantic [Agent Skills Specification](https://agentskills.io). 

Agents will automatically parse and load any `.md` file with conforming YAML frontmatter placed inside standard discovery paths:
* Root project directory: `./skills/` or `.agents/skills/`
* Assistant-specific local scope: `.cursor/skills/`, `.claude/skills/`, `.iflow/skills/`, etc.

When publishing a library for distribution using the `skills` CLI, the installer will recursively seek directories (e.g. `skills/`, `skills/.curated/`) and correctly provision them into the endpoint user's recognized location. Alternately, use the Claude `.claude-plugin/marketplace.json` manifest to broadcast capability scopes explicitly to tools.
