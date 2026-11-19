import { ValidationError } from '../../types/errors.js'
import {
    fenceNonCanonicalRefOrKey,
    isAlreadyFencedUntrustedContent,
    isAlreadyInlineFencedUntrustedContent,
    markUntrustedContent,
    markUntrustedContentInline,
} from '../../utils/security-utils.js'
import {
    RECORD_SEPARATOR,
    FIELD_SEPARATOR,
    buildGitBaseArgs,
    streamGitRecords,
} from '../../vendor/lib-git-history/git-runner.js'
import { parseGitRecord, processBatch } from '../../vendor/lib-git-history/parser.js'
import type { CliArgs } from '../../vendor/lib-git-history/cli.js'
import type { CommitEntry } from '../../vendor/lib-git-history/schema.js'
import { readLatestGitTag } from './git-staleness.js'

export interface FetchCommitsInput {
    maxCount?: number
    path?: string
    since?: string
    query?: string
    ref?: string
    sortBy?: 'date' | 'impact'
    scope?: string
    techDebtAudit?: boolean
    summary?: boolean
}

function ensureInlineFenced(value: string): string {
    return isAlreadyInlineFencedUntrustedContent(value)
        ? value
        : markUntrustedContentInline(value)
}

function ensureBlockFenced(value: string): string {
    return isAlreadyFencedUntrustedContent(value) ? value : markUntrustedContent(value)
}

function applyCommitFilterSort(commits: CommitEntry[], input: FetchCommitsInput): CommitEntry[] {
    let processed = commits
    if (input.scope !== undefined) {
        processed = processed.filter((c) => c.scope === input.scope)
    }
    if (input.techDebtAudit === true) {
        processed = processed.filter((c) => {
            const meta = c.metadata
            const impact =
                typeof meta?.impact === 'number'
                    ? meta.impact
                    : parseFloat(meta?.impact ?? '0')
            const trust =
                typeof meta?.trust === 'number' ? meta.trust : parseFloat(meta?.trust ?? '1')
            return impact >= 0.5 && (trust < 0.8 || meta?.validation === 'none')
        })
    }
    if (input.sortBy === 'impact') {
        processed.sort((a, b) => {
            const impactA =
                typeof a.metadata?.impact === 'number'
                    ? a.metadata.impact
                    : parseFloat(a.metadata?.impact ?? '0')
            const impactB =
                typeof b.metadata?.impact === 'number'
                    ? b.metadata.impact
                    : parseFloat(b.metadata?.impact ?? '0')
            return impactB - impactA
        })
    }
    return processed
}

/** Stream and parse git log records with semantic filters (returns raw structs for analytics). */
export async function fetchCommits(
    input: FetchCommitsInput,
    cwd: string
): Promise<CommitEntry[]> {
    const needsPostProcessing =
        input.sortBy === 'impact' ||
        input.techDebtAudit === true ||
        input.scope !== undefined
    const fetchLimit = needsPostProcessing ? 500 : (input.maxCount ?? 50)
    const cliArgs: CliArgs = {
        limit: fetchLimit,
        path: input.path,
        since: input.since,
        grep: input.query,
        ...(input.summary === true ? { summary: true } : {}),
    }
    const refName = input.ref || 'HEAD'
    if (refName.trim().startsWith('-')) {
        throw new ValidationError('Invalid git ref: leading hyphen options are not allowed')
    }
    const gitArgs = [
        'log',
        '--name-status',
        '-z',
        `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%aN${FIELD_SEPARATOR}%aE${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cN${FIELD_SEPARATOR}%cE${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}%(trailers:unfold,only)${FIELD_SEPARATOR}%(trailers:unfold)${FIELD_SEPARATOR}%P`,
        ...buildGitBaseArgs(cliArgs, refName),
    ]

    const batch = []
    try {
        for await (const record of streamGitRecords(gitArgs, cwd)) {
            const parsed = parseGitRecord(record, cliArgs)
            if (parsed) batch.push(parsed)
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/not a git repository/i.test(msg)) {
            throw new ValidationError(
                `Git command failed because '${cwd}' is not a valid git repository. Pass a registered repo, project_number, or valid git cwd.`
            )
        }
        if (
            /unknown revision|bad revision|ambiguous argument|does not have any commits yet/i.test(
                msg
            )
        ) {
            throw new ValidationError(msg)
        }
        throw err
    }

    const commits = await processBatch(batch, cliArgs, [], cwd)
    const processed = applyCommitFilterSort(commits, input)
    return needsPostProcessing ? processed.slice(0, input.maxCount ?? 50) : processed
}

/** Upper bound on commits returned by get_unreleased_commits when requested explicitly. */
const UNRELEASED_MAX_COMMITS = 5000
/** Default commit ceiling on get_unreleased_commits so multi-thousand-commit repos stay within Code Mode 30s/100KB budgets. */
const DEFAULT_UNRELEASED_MAX_COMMITS = 100
/** Cap for the no-tag fallback, where "unreleased" is the whole history. */
const NO_TAG_FALLBACK_MAX_COMMITS = 100

/** Collect commits since the latest reachable git tag. */
export async function getUnreleasedChangelog(
    cwd: string,
    options?: { maxCount?: number; summary?: boolean }
): Promise<{ latestTag: string | null; commits: CommitEntry[]; truncated: boolean }> {
    const latestTag = await readLatestGitTag(cwd)
    const summaryOpt = options?.summary === true ? { summary: true } : {}
    if (latestTag === null) {
        const fallbackCap =
            options?.maxCount !== undefined
                ? Math.min(Math.max(1, options.maxCount), UNRELEASED_MAX_COMMITS)
                : NO_TAG_FALLBACK_MAX_COMMITS
        const commits = await fetchCommits({ maxCount: fallbackCap, ...summaryOpt }, cwd)
        return {
            latestTag: null,
            commits: commits.slice(0, fallbackCap),
            truncated: commits.length >= fallbackCap,
        }
    }
    const effectiveMax =
        options?.maxCount !== undefined
            ? Math.min(Math.max(1, options.maxCount), UNRELEASED_MAX_COMMITS)
            : DEFAULT_UNRELEASED_MAX_COMMITS
    const commits = await fetchCommits(
        { ref: `${latestTag}..HEAD`, maxCount: effectiveMax, ...summaryOpt },
        cwd
    )
    return {
        latestTag,
        commits: commits.slice(0, effectiveMax),
        truncated: commits.length >= effectiveMax,
    }
}

/** Fence untrusted free-text fields on a commit record at MCP tool egress. */
export function fenceCommitEntry(c: CommitEntry): CommitEntry {
    const next: CommitEntry = {
        ...c,
        author: ensureInlineFenced(c.author),
        subject: ensureInlineFenced(c.subject),
    }
    if (c.cleanSubject !== undefined) next.cleanSubject = ensureInlineFenced(c.cleanSubject)
    if (c.email !== undefined) next.email = ensureInlineFenced(c.email)
    if (c.committer !== undefined) next.committer = ensureInlineFenced(c.committer)
    if (c.committerEmail !== undefined) {
        next.committerEmail = ensureInlineFenced(c.committerEmail)
    }
    if (c.breakingChangeDescription !== undefined) {
        next.breakingChangeDescription = ensureInlineFenced(c.breakingChangeDescription)
    }
    if (c.body !== undefined) next.body = ensureBlockFenced(c.body)
    if (c.patch !== undefined) next.patch = ensureBlockFenced(c.patch)
    if (c.coAuthors !== undefined) next.coAuthors = c.coAuthors.map(ensureInlineFenced)
    if (c.reviewers !== undefined) next.reviewers = c.reviewers.map(ensureInlineFenced)
    if (c.refs !== undefined) next.refs = c.refs.map((r) => fenceNonCanonicalRefOrKey(r))
    if (c.tags !== undefined) next.tags = c.tags.map((t) => fenceNonCanonicalRefOrKey(t))
    if (c.files !== undefined) {
        next.files = c.files.map((f) => ({
            ...f,
            file: fenceNonCanonicalRefOrKey(f.file),
            ...(f.oldFile !== undefined ? { oldFile: fenceNonCanonicalRefOrKey(f.oldFile) } : {}),
        }))
    }
    if (c.trailersObj !== undefined) {
        const fencedTrailers = Object.create(null) as Record<string, string>
        for (const [k, v] of Object.entries(c.trailersObj)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            fencedTrailers[fenceNonCanonicalRefOrKey(k, true)] = ensureInlineFenced(v)
        }
        next.trailersObj = fencedTrailers
    }
    if (c.scope !== undefined) {
        next.scope = fenceNonCanonicalRefOrKey(c.scope)
    }
    return next
}

/** Fence a list of commit records at MCP tool egress. */
export function fenceCommitEntries(commits: CommitEntry[]): CommitEntry[] {
    return commits.map(fenceCommitEntry)
}

/** Fence a git tag string at MCP egress when it contains markup/control/whitespace characters. */
export function fenceUnreleasedTag(tag: string | null): string | null {
    if (tag === null) return null
    return fenceNonCanonicalRefOrKey(tag)
}
