# Audit Categories

Detailed reference for the 8 per-skill and 4 directory-level quality
categories. Agent A (Evaluator) uses this during Phase 1 profiling.
Agent B (Adversarial User) uses it to construct stress scenarios in Phase 2.

All quality standards are derived from the
[skill-builder](../../skill-builder/SKILL.md) skill and its
[checklist](../../skill-builder/checklist.md).

---

## Per-Skill Categories

### Category 1 — Frontmatter & Triggering

The most important category. A perfectly written skill that never triggers
is worth nothing.

**What to Evaluate:**

- `name` is kebab-case and descriptive
- `description` is present, assertive, and includes trigger keywords
- `description` uses "Use when..." or "Also use when..." phrasing
- `description` is under ~100 words (token budget)
- `description` covers primary, secondary, and tertiary trigger phrasings
- Optional frontmatter fields are used appropriately (`dependencies`,
  `context`, `disable-model-invocation`, etc.)

**Anti-Patterns:**

| Pattern | Problem |
| --- | --- |
| `description: Guide for X` | Passive — agent won't trigger |
| 3-word description | Too vague — triggers on everything or nothing |
| 200-word description | Token waste — loaded on every conversation |
| Missing alternative phrasings | Agent only triggers on exact keywords |
| `name: my_skill` | Not kebab-case |

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | Assertive description with 3+ trigger contexts, ~50–100 words, covers edge phrasings |
| 4 | Good description, covers main triggers, minor phrasing gaps |
| 3 | Present but passive or missing secondary triggers |
| 2 | Too vague or too long, unreliable triggering |
| 1 | Missing or broken frontmatter |

---

### Category 2 — Instruction Clarity

**What to Evaluate:**

- Instructions explain _why_, not just _what_ (reasoning helps agents
  generalize to novel situations)
- Uses imperative form ("Run X" not "You should run X")
- No wall-of-MUSTs (excessive MUST/NEVER/ALWAYS in all-caps)
- Steps are ordered logically with clear dependencies
- Conditional logic is explicit ("If X, do Y. Otherwise, do Z.")
- Ambiguous pronouns are avoided ("it", "this" — what does "it" refer to?)

**Anti-Patterns:**

| Pattern | Problem |
| --- | --- |
| "MUST ALWAYS NEVER use X" | All-caps overload — agent treats everything as equally critical |
| "Consider using caching" | Too passive — agent may skip entirely |
| "Set up the project" | No specifics — agent will hallucinate a setup process |
| "Handle errors appropriately" | Vague — what does "appropriately" mean? |
| Steps without ordering | Agent may execute in wrong sequence |

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | Clear, imperative, explains reasoning, no ambiguity |
| 4 | Mostly clear, minor vague spots |
| 3 | Functional but has passive language or unclear sections |
| 2 | Multiple ambiguous instructions, agent likely to deviate |
| 1 | Confusing, contradictory, or unusable instructions |

---

### Category 3 — Structure & Progressive Disclosure

**What to Evaluate:**

- `SKILL.md` is under ~500 lines
- Large reference content is in `references/` with clear pointers
- SKILL.md has enough context to start working without reading references
- Pointers to reference files include guidance on _when_ to read them
- Reference depth is shallow (one hop from SKILL.md, not chains)
- Directory uses kebab-case naming
- Files are organized by functional purpose

**Anti-Patterns:**

| Pattern | Problem |
| --- | --- |
| 800-line SKILL.md | Token overflow, agent may lose context |
| No references for complex skill | Everything crammed into SKILL.md |
| "Read references/setup.md" (no context) | Agent doesn't know when to read it |
| SKILL → ref-A → ref-B → ref-C | Too many hops, agent gets lost |
| Flat directory with 10 files | No organizational structure |

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | Clean 3-tier structure, SKILL.md < 500 lines, clear reference pointers |
| 4 | Good structure, minor pointer gaps |
| 3 | Functional but SKILL.md is heavy or references are disorganized |
| 2 | Monolithic SKILL.md or confusing file layout |
| 1 | No structure — single massive file or scattered fragments |

---

### Category 4 — Output Formats & Templates

**What to Evaluate:**

- Output formats are explicitly defined with templates
- Templates include example content (not just empty headings)
- Structured outputs (tables, scorecards, reports) have clear schemas
- The agent knows what "done" looks like

**Anti-Patterns:**

| Pattern | Problem |
| --- | --- |
| "Produce a report" | No format specified — agent invents one |
| Template with only headings, no example rows | Agent may misunderstand column semantics |
| No success criteria | Agent doesn't know when to stop |

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | Explicit templates with example content, clear completion criteria |
| 4 | Templates present, minor gaps in examples |
| 3 | Some format guidance but incomplete |
| 2 | Vague output expectations |
| 1 | No output format defined — agent guesses |

---

### Category 5 — Edge Cases & Error Handling

**What to Evaluate:**

- Prerequisite failures are handled gracefully (missing tools, wrong
  project type, missing files)
- Edge cases are documented ("If X is not found, do Y")
- The skill degrades gracefully rather than crashing
- Error recovery guidance is provided

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | All prerequisites documented, graceful degradation, recovery paths |
| 4 | Main failure cases handled, minor gaps |
| 3 | Some error handling but missing common failure modes |
| 2 | Only happy path documented |
| 1 | No error handling — agent crashes on first edge case |

---

### Category 6 — Security & Safety

**What to Evaluate:**

- No instructions to read or transmit secrets
- Destructive skills use `disable-model-invocation: true`
- Required tools/CLIs are documented
- Third-party references are reviewed before inclusion
- No instructions that bypass user consent or HITL gates
- No instructions that modify agent config or other skills

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | All security checks pass, destructive actions gated, no secret access |
| 4 | Mostly secure, minor documentation gaps |
| 3 | Functional but missing safety gates on risky operations |
| 2 | Potential for unsafe behavior without HITL |
| 1 | Actively unsafe — reads secrets, destructive without gates |

---

### Category 7 — Token Efficiency

**What to Evaluate:**

- Description is ≤ ~100 words (always loaded, costs tokens every turn)
- SKILL.md body is ≤ ~500 lines
- Reference files have summaries at the top for skip-or-read decisions
- No redundant content between SKILL.md and references
- No copy-pasted documentation that could be linked instead
- Instructions justify their token cost

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | Lean description, compact SKILL.md, references loaded only when needed |
| 4 | Mostly efficient, minor redundancy |
| 3 | Noticeable token waste but functional |
| 2 | Bloated description or SKILL.md, unnecessary content |
| 1 | Massive token footprint with low value |

---

### Category 8 — Maintenance & Versioning

**What to Evaluate:**

- Content is current (no references to deprecated APIs or tools)
- Links and file references are valid
- Version-sensitive instructions specify version requirements
- Behavior changes are documented in commits
- Breaking changes have migration notes

**Scoring Guide:**

| Score | Criteria |
| --- | --- |
| 5 | Current content, all links valid, version requirements explicit |
| 4 | Mostly current, minor staleness |
| 3 | Some outdated content but core instructions still work |
| 2 | Significantly outdated, references to deprecated tools |
| 1 | Stale — instructions reference non-existent APIs or tools |

---

## Directory-Level Categories

These categories assess the skills collection as a whole, not individual
skills.

### Category 9 — Cross-Skill Coherence

**What to Evaluate:**

- Consistent naming conventions across all skills
- Similar structural patterns (SKILL.md layout, reference organization)
- Consistent writing style (imperative, reasoning-first)
- `README.md` inventory is complete and current
- Skill names follow a consistent scheme

---

### Category 10 — Trigger Collision Detection

**What to Evaluate:**

- No two skills claim the same trigger phrase without disambiguation
- Related skills have clear boundary descriptions ("Use X for Y, use Z
  for W")
- Meta-groups of related skills (e.g., all Cloudflare skills) have clear
  separation

**How to Test:**

Construct 10 ambiguous prompts and determine which skills would compete:

```
"Deploy my app"
"Set up the database"
"Write tests"
"Build a server"
"Set up CI/CD"
"Optimize performance"
"Fix security issues"
"Create a new project"
"Add authentication"
"Migrate the database"
```

For each, list which skills would potentially trigger and whether the
descriptions disambiguate.

---

### Category 11 — Coverage Gap Analysis

**What to Evaluate:**

- Are there common development tasks without skill coverage?
- Are there skills referenced in synergy tables that don't exist?
- Does the directory cover the user's technology stack adequately?
- Are there tool/framework skills missing for frameworks in active use?

---

### Category 12 — Ecosystem Consistency

**What to Evaluate:**

- `package.json` (if present) is valid and version-matched
- README inventory matches actual directory contents
- No orphan directories (skill folders without `SKILL.md`)
- No orphan references (reference files not pointed to from SKILL.md)
- Consistent file naming across all skills
