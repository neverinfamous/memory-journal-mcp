export const GIT_HELP = `# Git History Mining

- **Commit Discovery**: Use \`get_commit_history\` to fetch sequential commit logs and \`search_commits({ query })\` to search commit **messages** by regular expression (does not filter by author). Pass \`summary: true\` to skip per-file diffstat computation on large batches.
- **Release Tracking**: Use \`get_release_info({ ref })\` to summarize the 10 commits at \`ref\` and \`get_unreleased_commits({ maxCount?, summary? })\` (\`default: 100\`, \`max: 5000\`) to list commits since the latest SemVer tag.
- **Commit Analytics**: Use \`analyze_commit_patterns({ maxCount })\` (or \`max_count\`, default \`50\`) for author and entry-type breakdowns across recent commits.
- **Anchor Staleness Checks**: \`check_entry_staleness({ entry_id?, workspace_id?, project_number? })\` verifies \`entry_anchors\` against current git history (mutates staleness status; requires a registered \`projectRegistry\` entry \`path\` matching the target workspace — does not accept \`repo\` or \`cwd\`).
- **Code Mode**: These tools are exposed under the \`mj.git.*\` namespace (e.g., \`mj.git.getCommitHistory()\`).

## Available Tools

- **History**: \`get_commit_history\`, \`search_commits\`
- **Releases**: \`get_release_info\`, \`get_unreleased_commits\`
- **Analytics**: \`analyze_commit_patterns\`, \`check_entry_staleness\`

`;
