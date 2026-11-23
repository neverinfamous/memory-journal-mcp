/**
 * Briefing — System Section Helpers
 *
 * Extracted from `system-section.ts` to keep that module under 450 lines and every
 * function under 80 lines.
 */

import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

import { fenceNonCanonicalRefOrKey } from '../../../../utils/security-utils.js'
import { sliceUntrustedInline } from '../../fencing-helpers.js'
import type { GitHistorySummary } from './system-section.js'

const MAX_COMMIT_SUBJECT_LEN = 120

/** Walk upward from `startDir` looking for a directory containing `package.json`. */
function findPackageJsonRoot(startDir: string): string | undefined {
    let current = path.resolve(startDir)
    while (current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current
        }
        current = path.dirname(current)
    }
    return undefined
}

/**
 * Resolve project root via package.json location.
 *
 * [INVARIANT] H29: Inspect `startPath` / `process.cwd()` before falling back to
 * `import.meta.url` so cross-repo runs inspect the active workspace rather than
 * `memory-journal-mcp`'s own install directory.
 */
export function resolveProjectRoot(startPath?: string): string {
    const cwdTarget =
        startPath !== undefined && startPath !== '' ? startPath : process.cwd()
    return (
        findPackageJsonRoot(cwdTarget) ??
        findPackageJsonRoot(path.dirname(fileURLToPath(import.meta.url))) ??
        process.cwd()
    )
}

export function parseGitCommitLines(out: string, commitCount: number): GitHistorySummary {
    const lines = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

    let highImpact = 0
    let lowImpact = 0

    const commits: GitHistorySummary['commits'] = lines.map((line) => {
        const parts = line.split('|')
        const hash = fenceNonCanonicalRefOrKey((parts[0] ?? '').trim())
        const subject =
            parts.length >= 3
                ? parts.slice(1, -1).join('|').trim()
                : (parts[1] ?? '').trim()
        const typeMatch = /^([a-zA-Z]+)(?:\([^)]+\))?(!)?:/i.exec(subject)
        const commitType = typeMatch?.[1]?.toLowerCase()
        const isBreaking = Boolean(typeMatch?.[2])
        if (commitType === 'feat' || commitType === 'fix' || isBreaking) {
            highImpact++
        } else {
            lowImpact++
        }
        return {
            hash,
            ...(commitType !== undefined ? { type: commitType } : {}),
            isBreaking,
            message: sliceUntrustedInline(subject, MAX_COMMIT_SUBJECT_LEN, '…'),
        }
    })

    return {
        stats: {
            total: commits.length,
            highImpact,
            lowImpact,
            avgConfidence: 1.0,
        },
        commits: commits.slice(0, Math.max(1, commitCount)),
    }
}

let briefingTimeFormatter: Intl.DateTimeFormat | undefined

export function formatBriefingLocalTime(now = new Date()): string {
    try {
        briefingTimeFormatter ??= new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZoneName: 'short',
        })
        const parts = briefingTimeFormatter.formatToParts(now)
        const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
        return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`
    } catch {
        return now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    }
}

/**
 * Async git log for the briefing system summary.
 * [INTENT] Single subprocess: the briefing no longer renders commit hyperlinks, so the
 * `@{u}..HEAD` push-state probe (and its 404-link failure mode) is gone.
 */
export async function fetchGitHistoryFromRepoAsync(
    root: string,
    commitCount: number
): Promise<GitHistorySummary> {
    const fetchLimit = Math.max(1, commitCount)
    const { stdout } = await execFileAsync(
        'git',
        ['log', '-n', String(fetchLimit), '--abbrev=8', '--format=%h|%s|%cr'],
        {
            cwd: root,
            encoding: 'utf-8',
            timeout: 3000,
            windowsHide: true,
        }
    )
    return parseGitCommitLines(stdout, commitCount)
}

/** Async non-blocking repository indicator probe for briefing system summary. */
export async function readRepoIndicatorsAsync(root: string | null): Promise<{
    hasCodeMap: boolean
    localCheck: boolean | null
}> {
    if (root === null) return { hasCodeMap: false, localCheck: null }
    const codeMapPromise = fsPromises
        .access(path.join(root, 'test-server', 'code-map.md'))
        .then(() => true, () => false)
    const healthPromise = fsPromises
        .readFile(path.join(root, '.test-output', 'health-status.json'), 'utf-8')
        .then((content) => {
            const parsed = JSON.parse(content) as { ok?: boolean }
            return typeof parsed.ok === 'boolean' ? parsed.ok : null
        })
        .catch(() => null)
    const [hasCodeMap, localCheck] = await Promise.all([codeMapPromise, healthPromise])
    return { hasCodeMap, localCheck }
}
