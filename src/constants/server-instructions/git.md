# Git History Mining

- **Commit Discovery**: Use `get_commit_history` to fetch sequential logs and `search_commits` to find specific changes by message or author.
- **Release Tracking**: Use `get_release_info` to retrieve tag details and `get_unreleased_commits` to track work pending release.
- **Analytics**: Use `analyze_commit_patterns` to identify file hotspots and active contributors within a timeframe.
- **Performance**: Deep searches can take time. Cap your search ranges when possible.
- **Code Mode**: These tools are exposed under the `mj.git.*` namespace (e.g., `mj.git.getCommitHistory()`).