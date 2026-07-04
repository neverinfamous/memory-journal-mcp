# Usability Test: Git History Analytics (CLI Formatting - Custom Format)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s CLI correctly implements custom template formatting `--format "<path>"`.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a basic custom template file (e.g. Handlebars/mustache) in the scratch directory (`<appDataDir>\brain\<conversation-id>\scratch\custom-format.hbs`).
2. Extract history using the following (redirecting to a scratch file):
   - `bun .\.agents\scripts\get-git-history-json.ts --limit 5 --format "<appDataDir>\brain\<conversation-id>\scratch\custom-format.hbs"`

### Phase 2: Meta-Cognitive Debugging
1. Verify that `--format "<path>"` applies the custom template correctly.
2. If the CLI flag fails or outputs unexpected structures, formulate a hypothesis in a scratch file.
3. Fix the formatting logic in `get-git-history-json.ts` and `git-runner.ts`. Run `pnpm run check`.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete scratch output and template files.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
