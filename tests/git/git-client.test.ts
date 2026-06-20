import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHistoryClient } from "../../src/git/git-client.js";
import { simpleGit } from "simple-git";

vi.mock("simple-git", () => {
    return {
        simpleGit: vi.fn()
    };
});

describe("GitHistoryClient", () => {
    let client: GitHistoryClient;
    let mockLog: any;

    beforeEach(() => {
        mockLog = vi.fn().mockResolvedValue({
            all: [
                {
                    hash: "abc1234",
                    date: "2023-01-01T00:00:00Z",
                    message: "Initial commit",
                    author_name: "Test User",
                    author_email: "test@example.com",
                    body: "Type: feature"
                }
            ]
        });

        (simpleGit as any).mockReturnValue({
            timeout: vi.fn().mockReturnThis(),
            log: mockLog
        });

        client = new GitHistoryClient(undefined, { useNativeEngine: false });
    });

    it("should fetch commit history", async () => {
        const commits = await client.getCommitHistory();
        expect(commits).toHaveLength(1);
        expect(commits[0].hash).toBe("abc1234");
        expect(commits[0].trailers.Type).toBe("feature");
    });

    it("should enforce ref validation", async () => {
        await expect(client.getCommitHistory({ ref: "invalid ref!!" })).rejects.toThrow("Invalid git parameters provided.");
    });

    it("should search commits with length limit", async () => {
        const longQuery = "a".repeat(201);
        await expect(client.searchCommits(longQuery)).rejects.toThrow("Git operation failed: Query exceeds maximum length of 200 characters");
    });

    it("should cap getReleaseInfo at 10 commits", async () => {
        await client.getReleaseInfo();
        expect(mockLog).toHaveBeenCalledWith(["-n", "10"]);
    });

    it("should sanitize paths in error messages", async () => {
        mockLog.mockRejectedValue(new Error("Failed at /usr/local/secret/path/to/repo"));
        await expect(client.getCommitHistory()).rejects.toThrow("Git operation failed: Failed at [REDACTED PATH]");
    });
});
