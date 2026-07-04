# Usability Test: Git History Analytics (Metadata Core Extraction)

> [!IMPORTANT]
> **STRICT PROTOCOL ENFORCED:** You must parse git history non-destructively and never mutate the commit log.

## Objective
Verify that `lib-git-history`'s `parser-metadata.ts` successfully parses and extracts core metadata trailers (Category, Entry, Significance, Impact, Trust, Confidence, Validation) from commits, matching the SSoT mapping.

## Instructions

### Phase 1: Validating Extraction
1. **Extraction:** Create a test commit with a message that explicitly includes metadata trailers in the body (e.g., `Category: Changed`, `Entry: my-entry`, `Confidence: 0.8`, `Significance: High`, `Impact: 0.5`, `Trust: 0.9`, `Validation: passed`). 
   > [!WARNING]
   > **GIT TRAILER FORMATTING & BYPASSING:** When using native git, you MUST ensure that all trailers are contiguous at the very end of the commit message (no blank lines between them). Do NOT use multiple `-m` arguments.
   > **IMPORTANT:** Because `commit.ts` deprecates `--trust` (mapping it to `--confidence`) and `git commit` is intercepted by `lib-agent-exec`, you MUST bypass the interceptor to test the legacy `Trust` parsing. Write your commit message to a scratch file (e.g., `commit_msg.txt`) and commit using `git.exe --agent-bypass commit -F commit_msg.txt`.
2. **Parsing:** Extract the latest commit using `bun .\.agents\scripts\get-git-history-json.ts --limit 1` and redirect to `<appDataDir>\brain\<conversation-id>\scratch\metadata-core-test.json`.

### Phase 2: Meta-Cognitive Debugging
1. Verify that the output JSON correctly parses the trailers into the semantic JSON format specified by `schema.ts`.
2. Ensure that ALL core metadata trailers (`Category`, `Entry`, `Significance`, `Impact`, `Trust`, `Confidence`, `Validation`) are accurately extracted into the `metadata` object and validated properly by `schema.ts`, as mandated by the SSoT.
3. If `parser-metadata.ts` drops the trailers, create a hypothesis in a scratch file.
4. Fix the parsing logic using `ts-pattern` if it is failing. Run `pnpm run check` to ensure no regression.

### Phase 3: Cleanup & Commit
1. **Crucial Cleanup:** Delete your test commit using `git reset --soft HEAD~1`. Delete `metadata-core-test.json`.
2. Commit any fixes to `lib-git-history` using `bun .\.agents\scripts\commit.ts` with valid arguments.
