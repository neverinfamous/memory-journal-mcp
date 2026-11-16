/**
 * Briefing — System Section Builder
 *
 * Assembles system-level metadata for the briefing resource:
 * server version, tool/resource/prompt surface area counts,
 * local time, unreleased change summary, test health indicators,
 * active filter state, and operational configuration context.
 *
 * Heavy operations (file reads) are cached at module load to avoid
 * repeated I/O on every briefing read.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { VERSION } from '../../../../version.js'
import {
    getAllToolNames,
    isFilterEffectivelyReadOnly,
} from '../../../../filtering/tool-filter.js'
import type { ToolFilterConfig } from '../../../../filtering/tool-filter.js'
import { getPrompts } from '../../../prompts/index.js'
import { logger } from '../../../../utils/logger.js'
import type { BriefingConfig } from '../../shared.js'
import {
    fetchGitHistoryFromRepo,
    formatBriefingLocalTime,
    readRepoIndicators,
    resolveProjectRoot,
} from './system-section-helpers.js'


// ============================================================================
// Types
// ============================================================================

export interface GitHistorySummary {
    stats?: {
        total: number;
        highImpact: number;
        lowImpact: number;
        avgConfidence: number;
    }
    commits: { 
        hash: string; 
        type?: string;
        size?: string;
        significance?: number | string;
        confidence?: number | string;
        isBreaking?: boolean;
        message: string; 
        isPushed?: boolean;
        associatedIssues?: string[];
    }[]
}

export interface TestHealth {
    unitTests: number
    e2eTests: number
    coverage: number
}

export interface SystemContext {
    version: string
    toolCount: number
    resourceCount: number
    promptCount: number
    localTime: string
    gitHistory: GitHistorySummary | null
    testHealth: TestHealth | null
    /** Compact filter summary, e.g. "codemode (1/70)", or null when all tools exposed */
    filterSummary: string | null
    /** Whether the system is in a read-only state (admin tools disabled) */
    isReadonly: boolean
    /** Count of ALLOWED_IO_ROOTS entries */
    ioRootCount: number
    /** Whether code-map.md exists in the project root */
    hasCodeMap: boolean
    /** Days elapsed since the last tagged release in CHANGELOG.md */
    lastReleaseDaysAgo: number | null
    /** Status of the local lint/tsc check, if available */
    localCheck: boolean | null
    /** The active workspace ID if configured */
    workspaceId?: string
}

// ============================================================================
// Cached Startup Data
// ============================================================================

/**
 * Parse README.md badge lines for test counts and coverage.
 *
 * Looks for shields.io badge patterns:
 * - `Tests-(\d+)_passed` or `Tests-(\d+)%20passed`
 * - `E2E_Tests-(\d+)_passed` or `E2E%20Tests-(\d+)_passed`
 * - `Coverage-([0-9.]+)%25`
 */
export function parseTestHealth(content: string): TestHealth | null {
    const unitMatch = /(?<!E2E[_ ]|E2E)Tests-(\d+)[_ %]*(passed|%20passed)/i.exec(content)
    const e2eMatch = /E2E(?:[_ ]|%20)*Tests-(\d+)[_ %]*(passed|%20passed)/i.exec(content)
    const coverageMatch = /Coverage-([0-9.]+)%25/i.exec(content)

    if (!unitMatch?.[1] && !e2eMatch?.[1] && !coverageMatch?.[1]) return null

    return {
        unitTests: unitMatch?.[1] ? parseInt(unitMatch[1], 10) : 0,
        e2eTests: e2eMatch?.[1] ? parseInt(e2eMatch[1], 10) : 0,
        coverage: coverageMatch?.[1] ? parseFloat(coverageMatch[1]) : 0,
    }
}

interface TtlCacheEntry<T> {
    value: T
    expiresAt: number
}

const CACHE_TTL_MS = 60_000
const cachedGitHistory = new Map<string, TtlCacheEntry<GitHistorySummary | null>>()
const cachedTestHealth = new Map<string, TtlCacheEntry<TestHealth | null>>()

function getCached<T>(map: Map<string, TtlCacheEntry<T>>, key: string): { hit: true; value: T } | { hit: false } {
    const entry = map.get(key)
    if (!entry) return { hit: false }
    if (Date.now() > entry.expiresAt) {
        map.delete(key)
        return { hit: false }
    }
    return { hit: true, value: entry.value }
}

function setCached<T>(map: Map<string, TtlCacheEntry<T>>, key: string, value: T): T {
    map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
}

function loadCachedGitHistory(
    commitCount: number,
    targetPath?: string | null
): GitHistorySummary | null {
    if (targetPath === null) return null
    const root = targetPath || resolveProjectRoot()
    const cacheKey = `${root}::${String(commitCount)}`
    const cached = getCached(cachedGitHistory, cacheKey)
    if (cached.hit) return cached.value

    try {
        if (process.env['VITEST']) {
            return setCached(cachedGitHistory, cacheKey, null)
        }
        return setCached(cachedGitHistory, cacheKey, fetchGitHistoryFromRepo(root, commitCount))
    } catch (err: unknown) {
        logger.debug('Failed to get git history via child_process (non-critical)', {
            module: 'BRIEFING',
            operation: 'git-history',
            error: err instanceof Error ? err.message : String(err),
        })
        return setCached(cachedGitHistory, cacheKey, null)
    }
}

function readReadmeBadgeChunk(root: string): string {
    const readmePath = path.join(root, 'README.md')
    const fd = fs.openSync(readmePath, 'r')
    try {
        const buf = Buffer.alloc(2048)
        const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
        return buf.toString('utf-8', 0, bytesRead)
    } finally {
        fs.closeSync(fd)
    }
}

function loadCachedTestHealth(targetPath?: string | null): TestHealth | null {
    if (targetPath === null) return null
    const root = targetPath || resolveProjectRoot()
    const cached = getCached(cachedTestHealth, root)
    if (cached.hit) return cached.value

    try {
        // Primary: read structured coverage data from vitest json-summary output
        const coveragePath = path.join(root, '.test-output', 'coverage', 'coverage-summary.json')
        if (fs.existsSync(coveragePath)) {
            const raw = fs.readFileSync(coveragePath, 'utf-8')
            const summary = JSON.parse(raw) as {
                total?: { lines?: { pct?: number } }
            }
            const coverage = summary.total?.lines?.pct ?? 0

            let unitTests = 0
            let e2eTests = 0
            try {
                const badgeContent = readReadmeBadgeChunk(root)
                const unitMatch = /(?<!E2E[_ ]|E2E)Tests-(\d+)[_ %]*(passed|%20passed)/i.exec(
                    badgeContent
                )
                const e2eMatch = /E2E(?:[_ ]|%20)*Tests-(\d+)[_ %]*(passed|%20passed)/i.exec(
                    badgeContent
                )
                unitTests = unitMatch?.[1] ? parseInt(unitMatch[1], 10) : 0
                e2eTests = e2eMatch?.[1] ? parseInt(e2eMatch[1], 10) : 0
            } catch {
                // Ignore error if README.md doesn't exist or is unreadable
            }
            return setCached(cachedTestHealth, root, { unitTests, e2eTests, coverage })
        } else {
            // Fallback: parse everything from README badges (legacy path)
            return setCached(cachedTestHealth, root, parseTestHealth(readReadmeBadgeChunk(root)))
        }
    } catch {
        logger.debug('Test health data not found or unreadable (non-critical)', {
            module: 'BRIEFING',
            operation: 'test-health-parse',
        })
        return setCached(cachedTestHealth, root, null)
    }
}

// ============================================================================
// Last Release Age (from CHANGELOG.md)
// ============================================================================

const cachedLastReleaseDaysAgo = new Map<string, TtlCacheEntry<number | null>>()

export function parseLastReleaseAge(content: string): number | null {
    const match = /^## \[[\d.]+\].*?-\s*(\d{4}-\d{2}-\d{2})/m.exec(content)
    if (!match?.[1]) return null
    const releaseDate = new Date(match[1] + 'T00:00:00Z')
    const elapsed = Date.now() - releaseDate.getTime()
    return Math.max(0, Math.floor(elapsed / 86_400_000))
}

function loadCachedLastReleaseDaysAgo(targetPath?: string | null): number | null {
    if (targetPath === null) return null
    const root = targetPath || resolveProjectRoot()
    const cached = getCached(cachedLastReleaseDaysAgo, root)
    if (cached.hit) return cached.value

    try {
        const changelogPath = path.join(root, 'CHANGELOG.md')
        if (fs.existsSync(changelogPath)) {
            const content = fs.readFileSync(changelogPath, 'utf-8')
            const age = parseLastReleaseAge(content)
            return setCached(cachedLastReleaseDaysAgo, root, age)
        }
        return setCached(cachedLastReleaseDaysAgo, root, null)
    } catch {
        logger.debug('Failed to get release info (non-critical)', {
            module: 'BRIEFING',
            operation: 'release-age',
        })
        return setCached(cachedLastReleaseDaysAgo, root, null)
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build system-level context for the briefing.
 *
 * Version, tool count, and prompt count are derived from live registries.
 * Unreleased summary and test health are startup-cached from project files.
 * localTime provides chronological grounding for date-relative agent queries.
 * Filter, instruction level, and registry state are derived from runtime config.
 */
export function buildSystemContext(
    config?: BriefingConfig,
    filterConfig?: ToolFilterConfig | null,
    targetRepoPath?: string | null,
    resourceCount?: number,
    activeWorkspaceId?: string
): SystemContext {
    const localTime = formatBriefingLocalTime()

    // Filter summary — only show when a filter is actually narrowing the tool set
    const totalTools = getAllToolNames().length
    let filterSummary: string | null = null
    if (filterConfig) {
        const enabled = filterConfig.enabledTools.size
        if (enabled < totalTools) {
            filterSummary = `${filterConfig.raw} (${String(enabled)}/${String(totalTools)})`
        }
    }

    const isReadonly = filterConfig ? isFilterEffectivelyReadOnly(filterConfig) : false
    const ioRootCount = config?.allowedIoRoots?.length ?? 0
    const root = targetRepoPath === null ? null : (targetRepoPath || resolveProjectRoot())
    const { hasCodeMap, localCheck } = readRepoIndicators(root)

    return {
        version: VERSION,
        toolCount: totalTools,
        resourceCount: resourceCount ?? 0,
        promptCount: getPrompts().length,
        localTime,
        gitHistory: loadCachedGitHistory(config?.commitCount ?? 3, targetRepoPath),
        testHealth: loadCachedTestHealth(targetRepoPath),
        filterSummary,
        isReadonly,
        ioRootCount,
        hasCodeMap,
        lastReleaseDaysAgo: loadCachedLastReleaseDaysAgo(targetRepoPath),
        localCheck,
        workspaceId: activeWorkspaceId ?? config?.defaultWorkspaceId,
    }
}
