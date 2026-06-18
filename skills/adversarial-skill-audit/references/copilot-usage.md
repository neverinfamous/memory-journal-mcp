# GitHub Copilot External Validation

> **⚠️ CRITICAL — Non-Interactive Mode**: The `gh copilot` CLI must be run in
> non-interactive mode using the `-p` (or `--prompt`) flag. Interactive mode
> will hang indefinitely in an automated agent context. Do NOT include the `explain` or `suggest` subcommands before the `-p` flag. Use:
>
> ```
> gh copilot -p "Considering these standards from Phase 0 research: [insert findings]. <prompt>" --yolo
> ```
>
> The `--yolo` flag grants Copilot permission to read files across directories without hanging on permission prompts. Provide absolute paths to any files you want it to read in the prompt, rather than piping them.
>
> **⚠️ TIMEOUT GUIDANCE**: Expect 60–120 seconds per prompt. In environments with hard synchronous timeouts, use the `-s` flag or allow the command to naturally fall into the background.

> **⚠️ CRITICAL — No Fabrication**: You MUST actually execute `gh copilot` commands. Do NOT fabricate or predict what Copilot would say.
