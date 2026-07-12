export const GIT_HELP = `# Git History Mining

- **Commit Discovery**: Use \`get_commit_history\` to fetch sequential logs and \`search_commits\` to find specific changes by message or author.
- **Release Tracking**: Use \`get_release_info\` to retrieve tag details and \`get_unreleased_commits\` to track work pending release.
- **Analytics**: Use \`analyze_commit_patterns\` to identify file hotspots and active contributors within a timeframe.
- **Performance**: Deep searches can take time. Cap your search ranges when possible.
- **Code Mode**: These tools are exposed under the \`mj.git.*\` namespace (e.g., \`mj.git.getCommitHistory()\`).

## Available Tools

- \`get_commit_history\`: Fetch the commit history of the repository (with optional range or limit).
- \`search_commits\`: Search commit messages or authors within the repository.
- \`get_release_info\`: Retrieve information about a specific release tag (commit count, timestamp).
- \`get_unreleased_commits\`: Track commits merged since the last release tag.
- \`analyze_commit_patterns\`: Identify frequent contributors and frequently modified files.
- \`check_entry_staleness\`: Evaluate journal entry staleness by cross-referencing with recent git activity.

`;
