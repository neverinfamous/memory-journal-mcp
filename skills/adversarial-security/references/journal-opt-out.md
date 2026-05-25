### Journal Opt-Out

If the user explicitly requests **no journal entries** (e.g., "without entering
anything in memory-journal-mcp"), skip all `create_entry` calls and produce
only the final consolidated artifact. The audit is still valid without journal
entries — they are a documentation benefit, not a correctness requirement.
Note the opt-out in the report metadata.
