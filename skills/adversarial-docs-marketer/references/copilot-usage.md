# GitHub Copilot External Validation

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in
> non-interactive mode using the `-p` (or `--prompt`) flag. Interactive mode
> will hang indefinitely in an automated agent context. Use:
>
> ```
> gh copilot -p "Considering these standards from Phase 0 research: [insert findings]. <prompt>" --allow-tool "shell(find,cat,head,grep)"
> ```
>
> The `--allow-tool` flag grants Copilot read access to the repository files.
> Always `Set-Location` (or `cd`) to the target repository before invoking.
>
> **⚠️ TIMEOUT GUIDANCE**: Expect 60–120 seconds per prompt. In environments with hard synchronous timeouts, use the `-s` flag or allow the command to naturally fall into the background.

> **⚠️ CRITICAL — No Fabrication**: You MUST actually execute `gh copilot` commands. Do NOT fabricate or predict what Copilot would say.
