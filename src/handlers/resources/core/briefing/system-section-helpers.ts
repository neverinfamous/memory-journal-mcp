/**
 * Briefing — System Section Helpers
 *
 * Extracted from `system-section.ts` to keep that module under 450 lines and every
 * function under 80 lines.
 */

import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { markUntrustedContentInline } from '../../../../utils/security-utils.js'
import type { GitHistorySummary } from './system-section.js'

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

function parseGitCommitLines(
    out: string,
    unpushedHashes: Set<string>,
    commitCount: number
): GitHistorySummary {
    const lines = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

    let highImpact = 0
    let lowImpact = 0

    const commits: GitHistorySummary['commits'] = lines.map((line) => {
        const parts = line.split('|')
        const hash = (parts[0] ?? '').trim()
        const subject = (parts[1] ?? '').trim()
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
            message: markUntrustedContentInline(subject),
            isPushed: !unpushedHashes.has(hash),
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

export function fetchGitHistoryFromRepo(root: string, commitCount: number): GitHistorySummary {
    const fetchLimit = Math.max(1, commitCount)
    const out = execFileSync(
        'git',
        ['log', '-n', String(fetchLimit), '--format=%h|%s|%cr'],
        { cwd: root, encoding: 'utf-8', timeout: 3000, windowsHide: true }
    )

    const unpushedHashes = new Set<string>()
    try {
        const unpushedOut = execFileSync(
            'git',
            ['log', '@{u}..HEAD', '--format=%h'],
            { cwd: root, encoding: 'utf-8', timeout: 3000, windowsHide: true }
        )
        unpushedOut
            .split('\n')
            .filter(Boolean)
            .forEach((h) => unpushedHashes.add(h.trim()))
    } catch {
        // Ignore if no upstream tracking branch
    }

    return parseGitCommitLines(out, unpushedHashes, commitCount)
}

export function formatBriefingLocalTime(now = new Date()): string {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZoneName: 'short',
        })
        const parts = formatter.formatToParts(now)
        const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
        return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`
    } catch {
        return now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    }
}

export function readRepoIndicators(root: string | null): {
    hasCodeMap: boolean
    localCheck: boolean | null
} {
    if (root === null) {
        return { hasCodeMap: false, localCheck: null }
    }

    let hasCodeMap = false
    try {
        hasCodeMap = fs.existsSync(path.join(root, 'test-server', 'code-map.md'))
    } catch {
        // Non-critical — code-map indicator is best-effort
    }

    let localCheck: boolean | null = null
    try {
        const healthPath = path.join(root, '.test-output', 'health-status.json')
        if (fs.existsSync(healthPath)) {
            const content = fs.readFileSync(healthPath, 'utf-8')
            const parsed = JSON.parse(content) as { ok?: boolean }
            if (typeof parsed.ok === 'boolean') {
                localCheck = parsed.ok
            }
        }
    } catch {
        // Non-critical
    }

    return { hasCodeMap, localCheck }
}
