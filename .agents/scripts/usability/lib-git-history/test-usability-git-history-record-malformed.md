# Usability Test: Git History Analytics Parsing (Adversarial)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must explicitly verify the JSON payload structure before attempting data extraction.

## Objective
Verify that `lib-git-history`'s `parser-record.ts` can parse malformed commits robustly and update the parser logic safely.

## Instructions

### Phase 1: Parsing Validation
1. Create a "malformed" test commit by using `bun .\.agents\scripts\commit.ts` with a very messy, multi-line message containing unescaped quotes, weird characters, and malformed multiline blocks. (e.g. `bun .\.agents\scripts\commit.ts --msg "fix(test): messy 'quotes' and \n multi-line \n body \n BrokenTrailer: 123" --category Changed --impact 0.5 --confidence 0.5 --validation passed`).
2. Query git history using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and output to `<appDataDir>\brain\<conversation-id>\scratch\malformed-test.json`.
3. Manually verify that the `parser-record.ts` provides a completely valid, unbroken JSON object for this commit and gracefully handles the mess without throwing exceptions. Verify that if any data coercion failed, `validationErrors` array contains the appropriate Zod errors.

### Phase 2: Meta-Cognitive Debugging
1. If the script drops or incorrectly formats data:
   - **Formulate Hypothesis:** Write your reasoning in a scratch file before touching code.
   - **Fix:** Update `get-git-history-json.ts`, `parser-record.ts`, `parser-batch.ts`, `parser-metadata.ts`, or `schema.ts`. You MUST use `ts-pattern` for safely matching and parsing malformed JSON envelopes.
   > **CRITICAL**: Before proceeding with fixes or extractions, you MUST read the domain skills for `pattern-matching` (`C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`) and `zod` (`C:\Users\chris\Desktop\adamic\skills\zod\SKILL.md`).
2. **Regression Check:** If you change the Zod schema or interfaces, you must run `pnpm run typecheck` and `pnpm run lint` to ensure existing mocks don't break and validation rules are met.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Undo the test commit using `git reset --soft HEAD~1`. Delete `malformed-test.json`.
2. Once the workspace is clean and tests pass, commit the fix using `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --category Changed --impact 0.5 --confidence 0.5 --validation passed`.
