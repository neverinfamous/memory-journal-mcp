# Documentation Marketing Audit Categories

Detailed rubric for each of the 10 marketability categories. Use this reference
to calibrate scoring and identify specific improvements.

---

## 1. Feature Visibility

**What it evaluates**: Are all project capabilities discoverable in
documentation? Are powerful features prominently surfaced or buried?

### Checklist

- [ ] All tool groups mentioned with counts
- [ ] Unique differentiators (e.g., Code Mode, Hush Protocol) have dedicated sections
- [ ] Environment variables documented with use cases, not just names
- [ ] Resources and prompts listed with descriptions
- [ ] Security features (OAuth, rate limiting) surfaced as selling points
- [ ] Transport modes (stdio, HTTP, SSE) clearly documented
- [ ] Integration points (GitHub, Docker, MCP Registry) highlighted

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Every capability has a dedicated section or prominent mention. No hidden features. |
| 4 | Major features well-covered, 1–2 minor capabilities only findable by digging. |
| 3 | Core features documented, but 3+ capabilities buried in config tables or footnotes. |
| 2 | Several important features only mentioned in env var tables or code comments. |
| 1 | Documentation covers <50% of actual capabilities. |

### Common Anti-Patterns

- Listing features in a dense table without explanation of *why* they matter
- Documenting env vars without describing the feature they enable
- Mentioning a capability once in passing without a dedicated section

---

## 2. First Impression

**What it evaluates**: Does the repository sell itself within the first 30
seconds of a visitor scanning the page?

### Checklist

- [ ] Tagline communicates user benefit, not just technical description
- [ ] Badge row conveys trust (CI, coverage, version, registry)
- [ ] First paragraph answers "what is this?" and "why should I care?"
- [ ] Social preview image is compelling and current
- [ ] Quick navigation links at the top (Wiki, Changelog, Security)
- [ ] No wall of text before the value proposition

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Value prop clear in first 5 lines. Compelling tagline. Professional badges. |
| 4 | Good opening, but takes 10+ lines to understand the value. |
| 3 | Technical description leads, user benefit implied but not stated. |
| 2 | Opens with installation instructions or config before explaining what it does. |
| 1 | No clear value proposition in first screen. |

### Common Anti-Patterns

- Leading with "How to install" before "What this does"
- Generic tagline that could apply to any project ("A powerful tool for X")
- Stale badges (broken CI links, outdated version numbers)

---

## 3. Information Architecture

**What it evaluates**: Is the right content in the right place? Can readers
find what they need quickly?

### Checklist

- [ ] Heading hierarchy follows a logical progression
- [ ] Progressive disclosure: README → Wiki → inline docs
- [ ] Table of contents (explicit or via heading structure)
- [ ] Config tables grouped by theme, not alphabetically
- [ ] Collapsible sections (`<details>`) for long content
- [ ] "See also" links connecting related sections

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Clear hierarchy, scannable headings, progressive disclosure. |
| 4 | Good structure, 1–2 sections could be better organized. |
| 3 | Flat structure — everything at the same level of detail. |
| 2 | Important sections buried below less important content. |
| 1 | No discernible structure. Random ordering of sections. |

### Common Anti-Patterns

- README that tries to be both a quick-start guide and an exhaustive reference
- Mixing beginner and advanced content without clear separation
- No links between README and Wiki for deeper content

---

## 4. Visual Assets

**What it evaluates**: Does the documentation use visual elements effectively
to improve comprehension and engagement?

### Checklist

- [ ] Mermaid diagrams for architecture, workflows, or data flow
- [ ] Shields.io badges are current and functional
- [ ] Screenshots or GIFs for UI-facing features
- [ ] Social preview image (1280×640) is professional
- [ ] Callout blocks (`> [!NOTE]`, `> [!TIP]`) used appropriately
- [ ] Tables for structured data instead of long prose
- [ ] Code blocks with proper language markers

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Rich visual elements. Diagrams, badges, callouts, tables. Polished. |
| 4 | Good visual elements, 1–2 areas could benefit from a diagram or table. |
| 3 | Badges and code blocks present, but no diagrams or screenshots. |
| 2 | Minimal formatting. Mostly prose with few visual aids. |
| 1 | Wall of text. No badges, no diagrams, no tables. |

### Common Anti-Patterns

- Using only text to describe complex architectures or workflows
- Stale screenshots that don't match current UI
- Overusing callout blocks (>3 in a section dilutes their impact)

---

## 5. Competitive Differentiation

**What it evaluates**: Does the documentation clearly communicate what makes
this project unique compared to alternatives?

### Checklist

- [ ] "What Sets Us Apart" or equivalent section exists
- [ ] Differentiators are specific, not generic ("70 tools" vs "many tools")
- [ ] Comparisons use concrete metrics (token savings, tool counts, coverage)
- [ ] Unique features (Code Mode, Hush Protocol) positioned as innovations
- [ ] Claims are supported with evidence (benchmarks, test results)
- [ ] Target audience is clear

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Clear, evidence-backed differentiation. Reader knows exactly why to choose this. |
| 4 | Good positioning, but 1–2 differentiators could be stronger. |
| 3 | Features listed but not positioned against alternatives. |
| 2 | Generic descriptions that could apply to any similar project. |
| 1 | No differentiation. Reader can't tell why this exists. |

### Common Anti-Patterns

- "What Sets Us Apart" that lists features without explaining *why* they matter
- Using superlatives ("best", "fastest") without supporting evidence
- Comparing against imaginary competitors instead of real alternatives

---

## 6. Onboarding Friction

**What it evaluates**: How quickly can a new user go from discovery to
first successful use?

### Checklist

- [ ] Quick Start section exists and is near the top
- [ ] Config examples are copy-paste ready (valid JSON, realistic values)
- [ ] Multiple installation paths (npm, Docker, source) clearly separated
- [ ] Minimal viable config explained before advanced config
- [ ] Common gotchas documented proactively
- [ ] First successful interaction described ("you should see...")

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Copy-paste Quick Start, multiple paths, <5 minutes to first success. |
| 4 | Clear Quick Start, but 1 path could be smoother. |
| 3 | Quick Start exists but requires additional context or troubleshooting. |
| 2 | No Quick Start. User must assemble config from scattered sections. |
| 1 | Broken or misleading setup instructions. |

### Common Anti-Patterns

- Config examples with placeholder values that aren't valid JSON
- Assuming prerequisites without documenting them
- Quick Start that jumps to advanced config before showing minimal setup

---

## 7. Platform Presence

**What it evaluates**: Quality and consistency of documentation across all
distribution platforms.

### Checklist

- [ ] Docker Hub short description ≤100 characters
- [ ] Docker Hub README ≤25,000 characters
- [ ] npm README renders correctly (may differ from repo README)
- [ ] MCP Registry listing (`server.json`) is current and accurate
- [ ] GitHub repository description is compelling (≤350 chars)
- [ ] GitHub topics include relevant keywords
- [ ] Social preview image is set

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | All platforms have optimized, current, platform-appropriate content. |
| 4 | Most platforms covered, 1 platform has stale or minimal content. |
| 3 | Primary README good, but Docker/npm/registry descriptions are basic. |
| 2 | Only README maintained. Other platforms have minimal or default content. |
| 1 | No platform-specific optimization. Registry listing missing or broken. |

### Common Anti-Patterns

- Docker Hub README that's a direct copy of GitHub README (breaks char limit)
- npm package with no README or a stale one
- GitHub description that's too technical or too vague

---

## 8. Cross-Document Consistency

**What it evaluates**: Do all documentation surfaces tell the same story
with the same numbers?

### Checklist

- [ ] Tool counts match across README, Wiki, Docker README
- [ ] Version numbers are consistent
- [ ] Feature names are spelled and capitalized consistently
- [ ] Config examples use the same env var names
- [ ] Links between surfaces are bidirectional and functional
- [ ] Changelog reflects all documented features

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Perfect alignment. All surfaces tell the same story. |
| 4 | Minor inconsistencies (e.g., tool count off by 1 in one surface). |
| 3 | Noticeable inconsistencies in 2–3 areas. |
| 2 | Significant conflicts (different feature lists, contradictory claims). |
| 1 | Surfaces actively contradict each other. |

### Common Anti-Patterns

- Updating README but forgetting Docker README and Wiki
- Different feature counts across surfaces after adding tools
- Broken cross-links between README and Wiki

---

## 9. Tone & Voice

**What it evaluates**: Is the documentation written in a consistent,
confident, audience-appropriate voice?

### Checklist

- [ ] Active voice used consistently ("Run the command" vs "The command can be run")
- [ ] Confident tone without arrogance
- [ ] Technical depth appropriate for target audience
- [ ] Consistent use of terminology (no switching between synonyms)
- [ ] Emoji usage is deliberate, not excessive
- [ ] No apologetic or hedging language ("hopefully", "should work")

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Consistent, confident, professional. Reads like polished product docs. |
| 4 | Good tone overall, minor inconsistencies between sections. |
| 3 | Mix of formal and informal. Some sections feel like different authors. |
| 2 | Overly technical or academic. Not inviting to new users. |
| 1 | Inconsistent, uncertain, or defensive tone throughout. |

### Common Anti-Patterns

- Mixing marketing copy ("revolutionary!") with dry technical prose
- Excessive emoji that undermines professionalism
- Passive voice that weakens calls to action

---

## 10. SEO & Discoverability

**What it evaluates**: Can users find this project through search engines,
GitHub search, and registry discovery?

### Checklist

- [ ] GitHub topics include 5+ relevant keywords
- [ ] Repository description includes primary use case keywords
- [ ] README headings include searchable terms (not just clever titles)
- [ ] Key features mentioned in the first 200 words (search snippet)
- [ ] `server.json` includes accurate keywords and categories
- [ ] Links from external sources (blog posts, registry listings)

### Scoring Guide

| Score | Criteria |
| --- | --- |
| 5 | Optimized for discovery. Strong keywords, topics, and external links. |
| 4 | Good keyword coverage, 1–2 discovery channels underutilized. |
| 3 | Basic SEO. GitHub topics set but not optimized. |
| 2 | Minimal SEO effort. Few topics, generic description. |
| 1 | No SEO consideration. Project is effectively invisible to search. |

### Common Anti-Patterns

- Clever heading names that aren't searchable ("🧠 The Brain" instead of
  "Session Memory and Context Persistence")
- GitHub description that's too short or too long
- Missing GitHub topics entirely
