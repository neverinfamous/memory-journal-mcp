import { z } from "zod";

export const GitRefSchema = z.string().regex(new RegExp("^[a-zA-Z0-9._/@-]+$")).max(100);
export const GitPathSchema = z.string().regex(new RegExp("^[a-zA-Z0-9._/@-]+$")).max(200);

export interface GitCommit {
    hash: string;
    date: string;
    message: string;
    author_name: string;
    author_email: string;
    body: string;
    trailers: Record<string, string>;
}

export interface GitCommitHistoryOptions {
    ref?: string;
    path?: string;
    maxCount?: number;
    since?: string;
}

export interface GitSearchOptions {
    query: string;
    maxCount?: number;
}

export interface GitReleaseInfoOptions {
    ref?: string;
}

export interface UnreleasedChangelog {
    range: { from: string; to: string; isFallback: boolean };
    categories: Record<string, ChangelogEntry[]>;
    totalCount: number;
}

export interface ChangelogEntry {
    hash: string;
    shortHash: string;
    message: string;
    category: string;
    entry: string;
    date: string;
    author: string;
    isBreaking: boolean;
    scope?: string;
}
