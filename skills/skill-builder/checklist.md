# Skill Quality Checklist

Quick-reference checklist for reviewing skill quality. Use after creating or
iterating on a skill.

## Frontmatter

- [ ] `name` is kebab-case and descriptive
- [ ] `description` is present and assertive (not passive)
- [ ] `description` covers primary, secondary, and tertiary trigger keywords
- [ ] `description` includes "Use when..." or "Also use when..." phrasing
- [ ] `description` is under ~100 words

## Structure

- [ ] `SKILL.md` is under ~500 lines
- [ ] Large reference content is in `references/` with clear pointers from SKILL.md
- [ ] Directory uses kebab-case naming
- [ ] Files are organized by functional purpose (not arbitrary splits)

## Writing Quality

- [ ] Instructions explain *why*, not just *what*
- [ ] No excessive MUST/NEVER/ALWAYS in all-caps (use explanatory reasoning instead)
- [ ] Uses imperative form ("Run the tests" not "You should run the tests")
- [ ] Output formats are explicitly defined with templates
- [ ] Edge cases and error handling are addressed

## Triggering

- [ ] "When to Load" section covers obvious *and* non-obvious trigger scenarios
- [ ] Description is assertive enough to avoid under-triggering
- [ ] Borderline trigger scenarios are addressed

## Progressive Disclosure

- [ ] Metadata (frontmatter) is ~50-100 tokens
- [ ] SKILL.md body provides enough context to start working
- [ ] Detailed reference material is deferred to `references/` files
- [ ] SKILL.md has clear pointers to reference files with guidance on when to read them

## Testing

- [ ] 2-5 realistic test scenarios exist (or are documented)
- [ ] Test scenarios cover simple, medium, and edge cases
- [ ] Validation criteria are defined for each scenario
- [ ] Regression: all previous scenarios re-run after changes

## Security

- [ ] No instructions to read/transmit secrets
- [ ] Destructive skills use `disable-model-invocation: true`
- [ ] Required tools/CLIs are documented (not silently assumed)
- [ ] Third-party reference files reviewed before inclusion

## Version Control

- [ ] Behavior changes documented in commit messages or CHANGELOG.md
- [ ] Breaking changes have migration notes

## Advanced Features (if applicable)

- [ ] `context: fork` used only for concrete, self-contained tasks
- [ ] `dependencies` field lists required tools/runtimes
- [ ] `user-invocable: false` used for background knowledge skills
