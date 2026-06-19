import { type GitCommit } from "./types.js";

export class CommitAnalyzer {
    public analyze(commits: GitCommit[]): (GitCommit & { type: string })[] {
        return commits.map(commit => {
            const type = commit.trailers?.['Type'] || "unknown";
            return {
                ...commit,
                type
            };
        });
    }
}
