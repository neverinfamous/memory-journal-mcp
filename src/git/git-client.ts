import { simpleGit, type SimpleGit } from "simple-git";
import * as fs from "node:fs";
import { z } from "zod";
import {
    type GitCommit,
    type GitCommitHistoryOptions,
    type GitSearchOptions,
    type GitReleaseInfoOptions,
    GitRefSchema,
    GitPathSchema,
    type UnreleasedChangelog
} from "./types.js";
import { parseTrailers } from "./trailer-parser.js";
import { getNativeCommitHistory, getUnreleasedChangelog, NativeGitError } from "./native-git-engine.js";

export class GitHistoryClient {
    private git: SimpleGit;
    public useNativeEngine: boolean;
    public baseDir: string;

    constructor(baseDir?: string, options: { useNativeEngine?: boolean } = {}) {
        this.baseDir = baseDir || process.cwd();
        this.useNativeEngine = options.useNativeEngine ?? true;

        if (baseDir && !fs.existsSync(baseDir)) {
            // Fallback for tests or invalid paths
            this.git = simpleGit({ timeout: { block: 30_000 } });
        } else {
            this.git = simpleGit({ baseDir, timeout: { block: 30_000 } });
        }
    }

    private sanitizeError(error: unknown): Error {
        if (error instanceof z.ZodError) {
            return new Error("Invalid git parameters provided.");
        }
        const message = error instanceof Error ? error.message : String(error);
        // Remove paths to prevent info leaks
        const sanitized = message.replace(/(?:\/|[A-Z]:\\)[^\s"']+/gi, "[REDACTED PATH]");
        return new Error(`Git operation failed: ${sanitized}`);
    }

    public async getCommitHistory(options: GitCommitHistoryOptions = {}): Promise<GitCommit[]> {
        try {
            if (options.ref) {
                GitRefSchema.parse(options.ref);
            }
            if (options.path) {
                GitPathSchema.parse(options.path);
            }

            if (this.useNativeEngine) {
                try {
                    return await getNativeCommitHistory(this.baseDir, options);
                } catch (err) {
                    if (err instanceof NativeGitError) {
                        // Fall through to simple-git
                    } else {
                        throw err;
                    }
                }
            }

            const logArgs: string[] = [];
            if (options.maxCount !== undefined) {
                logArgs.push(`-n`, options.maxCount.toString());
            }
            if (options.since) {
                logArgs.push(`--since=${options.since}`);
            }
            if (options.ref) {
                logArgs.push(options.ref);
            }
            if (options.path) {
                logArgs.push("--", options.path);
            }

            const log = await this.git.log(logArgs);
            
            return log.all.map(c => ({
                hash: c.hash,
                date: c.date,
                message: c.message,
                author_name: c.author_name,
                author_email: c.author_email,
                body: c.body,
                trailers: parseTrailers(c.body)
            }));
        } catch (error) {
            throw this.sanitizeError(error);
        }
    }

    public async searchCommits(query: string, options: GitSearchOptions = { query: '' }): Promise<GitCommit[]> {
        try {
            if (query.length > 200) {
                throw new Error("Query exceeds maximum length of 200 characters");
            }
            
            // Basic ReDoS / command injection protection: block arbitrary regex control sequences
            if (/[.*+?^${}()|[\]\\]/.test(query)) {
                throw new Error("Invalid query format. Regex control characters are not allowed.");
            }

            if (this.useNativeEngine) {
                try {
                    return await getNativeCommitHistory(this.baseDir, { query, maxCount: options.maxCount });
                } catch (err) {
                    if (err instanceof NativeGitError) {
                        // Fall through to simple-git
                    } else {
                        throw err;
                    }
                }
            }

            const logArgs: string[] = [
                "--grep", query,
                "-i"
            ];
            if (options.maxCount !== undefined) {
                logArgs.push("-n", options.maxCount.toString());
            }

            const log = await this.git.log(logArgs);
            return log.all.map(c => ({
                hash: c.hash,
                date: c.date,
                message: c.message,
                author_name: c.author_name,
                author_email: c.author_email,
                body: c.body,
                trailers: parseTrailers(c.body)
            }));
        } catch (error) {
            throw this.sanitizeError(error);
        }
    }

    public async getReleaseInfo(options: GitReleaseInfoOptions = {}): Promise<GitCommit[]> {
        try {
            if (options.ref) {
                GitRefSchema.parse(options.ref);
            }

            if (this.useNativeEngine) {
                try {
                    return await getNativeCommitHistory(this.baseDir, { ref: options.ref, maxCount: 10 });
                } catch (err) {
                    if (err instanceof NativeGitError) {
                        // Fall through to simple-git
                    } else {
                        throw err;
                    }
                }
            }

            const logArgs: string[] = ["-n", "10"];
            if (options.ref) {
                logArgs.push(options.ref);
            }

            const log = await this.git.log(logArgs);
            return log.all.map(c => ({
                hash: c.hash,
                date: c.date,
                message: c.message,
                author_name: c.author_name,
                author_email: c.author_email,
                body: c.body,
                trailers: parseTrailers(c.body)
            }));
        } catch (error) {
            throw this.sanitizeError(error);
        }
    }

    public async getUnreleasedChangelog(): Promise<UnreleasedChangelog> {
        try {
            return await getUnreleasedChangelog(this.baseDir);
        } catch (error) {
            throw this.sanitizeError(error);
        }
    }
}
