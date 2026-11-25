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
import {
    parseGitRecord,
    processBatch,
    type RawCommitBatchItem,
} from '../../vendor/lib-git-history/parser.js'
import type { CliArgs } from '../../vendor/lib-git-history/cli.js'
import type { CommitEntry } from '../../vendor/lib-git-history/schema.js'
import { getUncommittedStateAsync } from '../../vendor/lib-git-history/uncommitted.js'
import { readLatestGitTag } from './git-staleness.js'
import { createNullProtoRecord } from '../../utils/type-guards.js'

export interface FetchCommitsInput {
    maxCount?: number | undefined
    path?: string | undefined
    since?: string | undefined
    query?: string | undefined
    ref?: string | undefined
    sortBy?: 'date' | 'impact' | undefined
    scope?: string | undefined
    techDebtAudit?: boolean | undefined
    summary?: boolean | undefined
}

function ensureInlineFenced(value: string): string {
    return isAlreadyInlineFencedUntrustedContent(value)
        ? value
        : markUntrustedContentInline(value)
}

function ensureBlockFenced(value: string): string {
    return isAlreadyFencedUntrustedContent(value) ? value : markUntrustedContent(value)
}

function parseNumericMeta(value: unknown, fallback: number): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
    if (typeof value === 'string') {
        const parsed = parseFloat(value)
        return Number.isFinite(parsed) ? parsed : fallback
    }
    return fallback
}

function isRealRawBatchItem(item: unknown): item is RawCommitBatchItem {
    return (
        typeof item === 'object' &&
        item !== null &&
        'sha' in item &&
        typeof item.sha === 'string' &&
        'metadataObj' in item &&
        typeof item.metadataObj === 'object' &&
        item.metadataObj !== null
    )
}

function filterSortRawBatch(
    batch: RawCommitBatchItem[],
    input: FetchCommitsInput
): RawCommitBatchItem[] {
    let processed = batch
    if (input.scope !== undefined) {
        processed = processed.filter((b) => b.scope === input.scope)
    }
    if (input.techDebtAudit === true) {
        processed = processed.filter((b) => {
            const meta = b.metadataObj
            const impact = parseNumericMeta(
                Object.hasOwn(meta, 'impact') ? meta['impact'] : undefined,
                0
            )
            const trust = parseNumericMeta(
                Object.hasOwn(meta, 'trust') ? meta['trust'] : undefined,
                1
            )
            const validation = Object.hasOwn(meta, 'validation') ? meta['validation'] : undefined
            return impact >= 0.5 && (trust < 0.8 || validation === 'none')
        })
    }
    if (input.sortBy === 'impact') {
        if (processed === batch) {
            processed = [...batch]
        }
        processed.sort((a, b) => {
            const impactA = parseNumericMeta(
                Object.hasOwn(a.metadataObj, 'impact') ? a.metadataObj['impact'] : undefined,
                0
            )
            const impactB = parseNumericMeta(
                Object.hasOwn(b.metadataObj, 'impact') ? b.metadataObj['impact'] : undefined,
                0
            )
            return impactB - impactA
        })
    }
    return processed
}

function applyCommitFilterSort(commits: CommitEntry[], input: FetchCommitsInput): CommitEntry[] {
    let processed = commits
    if (input.scope !== undefined) {
        processed = processed.filter((c) => c.scope === input.scope)
    }
    if (input.techDebtAudit === true) {
        processed = processed.filter((c) => {
            const meta = c.metadata
            const impact = parseNumericMeta(meta?.impact, 0)
            const trust = parseNumericMeta(meta?.trust, 1)
            return impact >= 0.5 && (trust < 0.8 || meta?.validation === 'none')
        })
    }
    if (input.sortBy === 'impact') {
        if (processed === commits) {
            processed = [...commits]
        }
        processed.sort((a, b) => {
            const impactA = parseNumericMeta(a.metadata?.impact, 0)
            const impactB = parseNumericMeta(b.metadata?.impact, 0)
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
    const maxCount = input.maxCount ?? 50
    const fetchLimit = needsPostProcessing ? Math.max(500, maxCount) : maxCount
    const useInlineNumstat = input.summary !== true
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
        ...(useInlineNumstat ? ['--raw', '--numstat'] : ['--name-status']),
        '-z',
        `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%aN${FIELD_SEPARATOR}%aE${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cN${FIELD_SEPARATOR}%cE${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}%(trailers)${FIELD_SEPARATOR}%(trailers:separator=%x1C)${FIELD_SEPARATOR}%P`,
        ...buildGitBaseArgs(cliArgs, refName),
    ]

    const batch: RawCommitBatchItem[] = []
    try {
        for await (const record of streamGitRecords(gitArgs, cwd)) {
            const parsed = parseGitRecord(record, cliArgs, useInlineNumstat)
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
            /unknown revision|bad revision|ambiguous argument|does not have any commits yet|regular expression|invalid .*reg(?:ex|ular)|unmatched\s+\[|unmatched\s+\(|unmatched\s+\\?\{|trailing backslash|invalid range end|invalid preceding|premature end of|command line, .*:/i.test(
                msg
            )
        ) {
            throw new ValidationError(msg)
        }
        throw err
    }

    const canPreFilter =
        needsPostProcessing && batch.length > 0 && batch.every(isRealRawBatchItem)
    const batchToProcess = canPreFilter
        ? filterSortRawBatch(batch, input).slice(0, maxCount)
        : batch

    const commits = await processBatch(batchToProcess, cliArgs, [], cwd)
    if (canPreFilter || !needsPostProcessing) {
        return commits
    }
    return applyCommitFilterSort(commits, input).slice(0, maxCount)
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
        const commits = await fetchCommits({ maxCount: fallbackCap + 1, ...summaryOpt }, cwd)
        return {
            latestTag: null,
            commits: commits.slice(0, fallbackCap),
            truncated: commits.length > fallbackCap,
        }
    }
    const effectiveMax =
        options?.maxCount !== undefined
            ? Math.min(Math.max(1, options.maxCount), UNRELEASED_MAX_COMMITS)
            : DEFAULT_UNRELEASED_MAX_COMMITS
    const commits = await fetchCommits(
        { ref: `${latestTag}..HEAD`, maxCount: effectiveMax + 1, ...summaryOpt },
        cwd
    )
    return {
        latestTag,
        commits: commits.slice(0, effectiveMax),
        truncated: commits.length > effectiveMax,
    }
}

function fenceCommitMetadata(
    meta: NonNullable<CommitEntry['metadata']>
): NonNullable<CommitEntry['metadata']> {
    const fenced: NonNullable<CommitEntry['metadata']> = { ...meta }
    if (meta.category !== undefined) fenced.category = meta.category.map(ensureInlineFenced)
    if (meta.entry !== undefined) fenced.entry = meta.entry.map(ensureInlineFenced)
    if (meta.significance !== undefined) fenced.significance = ensureInlineFenced(meta.significance)
    if (meta.validation !== undefined) fenced.validation = ensureInlineFenced(meta.validation)
    if (typeof meta.impact === 'string') fenced.impact = ensureInlineFenced(meta.impact)
    if (typeof meta.trust === 'string') fenced.trust = ensureInlineFenced(meta.trust)
    if (typeof meta.confidence === 'string') fenced.confidence = ensureInlineFenced(meta.confidence)
    if (meta.customTrailers !== undefined) {
        const fencedCustom = createNullProtoRecord<string[]>()
        for (const [k, vals] of Object.entries(meta.customTrailers)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            fencedCustom[fenceNonCanonicalRefOrKey(k, true)] = vals.map(ensureInlineFenced)
        }
        fenced.customTrailers = fencedCustom
    }
    return fenced
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
    if (c.references !== undefined) next.references = c.references.map(ensureInlineFenced)
    if (c.associatedIssues !== undefined) {
        next.associatedIssues = c.associatedIssues.map((ai) => ({
            issue: ensureInlineFenced(ai.issue),
            action: ai.action !== null ? ensureInlineFenced(ai.action) : null,
        }))
    }
    if (c.slackId !== undefined) next.slackId = ensureInlineFenced(c.slackId)
    if (c.metadata !== undefined) next.metadata = fenceCommitMetadata(c.metadata)
    if (c.files !== undefined) {
        next.files = c.files.map((f) => ({
            ...f,
            file: fenceNonCanonicalRefOrKey(f.file),
            ...(f.oldFile !== undefined ? { oldFile: fenceNonCanonicalRefOrKey(f.oldFile) } : {}),
        }))
    }
    if (c.trailersObj !== undefined) {
        const fencedTrailers = createNullProtoRecord<string>()
        for (const [k, v] of Object.entries(c.trailersObj)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
            fencedTrailers[fenceNonCanonicalRefOrKey(k, true)] = ensureInlineFenced(v)
        }
        next.trailersObj = fencedTrailers
    }
    if (c.scope !== undefined) {
        next.scope = fenceNonCanonicalRefOrKey(c.scope)
    }
    if (c.type !== undefined) {
        next.type = fenceNonCanonicalRefOrKey(c.type)
    }
    return next
}

/** Fence a list of commit records at MCP tool egress. */
export function fenceCommitEntries(commits: CommitEntry[]): CommitEntry[] {
    return commits.map(fenceCommitEntry)
}

/** Capture and fence uncommitted working-tree status and diffstat for a repository path. */
export async function fetchUncommittedWorkingTree(
    cwd: string,
    pathFilter?: string
): Promise<CommitEntry> {
    return fenceCommitEntry(
        await getUncommittedStateAsync(pathFilter !== undefined ? { path: pathFilter } : {}, cwd)
    )
}

/** Fence a git tag string at MCP egress when it contains markup/control/whitespace characters. */
export function fenceUnreleasedTag(tag: string | null): string | null {
    if (tag === null) return null
    return fenceNonCanonicalRefOrKey(tag)
}
