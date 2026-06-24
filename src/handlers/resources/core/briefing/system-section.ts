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
import { getAllToolNames } from '../../../../filtering/tool-filter.js'
import { TOOL_GROUPS } from '../../../../filtering/tool-constants.js'
import type { ToolFilterConfig } from '../../../../filtering/tool-filter.js'
import { getPrompts } from '../../../prompts/index.js'
import { logger } from '../../../../utils/logger.js'
import type { BriefingConfig } from '../../shared.js'


// ============================================================================
// Types
// ============================================================================

export interface GitHistorySummary {
    commits: { hash: string; category?: string; entry?: string; message: string; isPushed?: boolean }[]
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
    /** Registered repo names from PROJECT_REGISTRY, null when unconfigured */
    registryRepos: string[] | null
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

export interface BuildSystemContextOptions {
    config?: BriefingConfig
    filterConfig?: ToolFilterConfig | null
    targetRepoPath?: string
}



// ============================================================================
// Startup-Cached Parsers
// ============================================================================

/**
 * Resolve project root via package.json location.
 *
 * Uses createRequire (same pattern as version.ts) to find the closest
 * package.json. This works in both source (ts-node/vitest) and bundled
 * (tsup → dist/) contexts, unlike import.meta.url traversal which
 * breaks when tsup flattens the directory structure.
 */
function resolveProjectRoot(): string {
    let current = new URL(import.meta.url).pathname
    if (process.platform === 'win32' && current.startsWith('/')) {
        current = current.slice(1)
    }
    current = path.dirname(current)
    while (current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current
        }
        current = path.dirname(current)
    }
    return process.cwd()
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

const cachedGitHistory = new Map<string, GitHistorySummary | null>()
const cachedTestHealth = new Map<string, TestHealth | null>()

import { execFileSync } from 'node:child_process'

function loadCachedGitHistory(commitCount: number, targetPath?: string): GitHistorySummary | null {
    const root = targetPath || resolveProjectRoot()
    const existing = cachedGitHistory.get(root)
    if (existing !== undefined) return existing

    try {
        const out = execFileSync('git', ['log', '-n', String(Math.max(1, Math.min(50, commitCount))), '--pretty=format:%H%x09%s'], { cwd: root, encoding: 'utf-8', windowsHide: true })
        
        const unpushedHashes = new Set<string>()
        try {
            const unpushedOut = execFileSync('git', ['log', '@{u}..HEAD', '--format=%H'], { cwd: root, encoding: 'utf-8', windowsHide: true })
            unpushedOut.split('\n').filter(Boolean).forEach(h => unpushedHashes.add(h.trim()))
        } catch {
            // Ignore if no upstream tracking branch
        }

        const lines = out.split('\n').filter(Boolean)
        const commits: GitHistorySummary['commits'] = lines.map(l => {
            const [hash, msg] = l.split('\t')
            const fullHash = hash || ''
            return { 
                hash: fullHash.substring(0, 7), 
                message: msg || '',
                isPushed: !unpushedHashes.has(fullHash)
            }
        })
        const result = { commits }
        cachedGitHistory.set(root, result)
    } catch {
        logger.debug('Failed to get git history via child_process (non-critical)', {
            module: 'BRIEFING',
            operation: 'git-history',
        })
        cachedGitHistory.set(root, null)
    }

    return cachedGitHistory.get(root) ?? null
}

function loadCachedTestHealth(targetPath?: string): TestHealth | null {
    const root = targetPath || resolveProjectRoot()
    const existing = cachedTestHealth.get(root)
    if (existing !== undefined) return existing

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
            const readmePath = path.join(root, 'README.md')
            try {
                const fd = fs.openSync(readmePath, 'r')
                const buf = Buffer.alloc(2048)
                const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
                fs.closeSync(fd)
                const badgeContent = buf.toString('utf-8', 0, bytesRead)
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
            cachedTestHealth.set(root, { unitTests, e2eTests, coverage })
        } else {
            // Fallback: parse everything from README badges (legacy path)
            const readmePath = path.join(root, 'README.md')
            const fd = fs.openSync(readmePath, 'r')
            const buf = Buffer.alloc(2048)
            const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
            fs.closeSync(fd)
            const content = buf.toString('utf-8', 0, bytesRead)
            cachedTestHealth.set(root, parseTestHealth(content))
        }
    } catch {
        logger.debug('Test health data not found or unreadable (non-critical)', {
            module: 'BRIEFING',
            operation: 'test-health-parse',
        })
        cachedTestHealth.set(root, null)
    }

    const final = cachedTestHealth.get(root)
    return final !== undefined ? final : null
}

// ============================================================================
// Last Release Age (from CHANGELOG.md)
// ============================================================================

const cachedLastReleaseDaysAgo = new Map<string, number | null>()

export function parseLastReleaseAge(content: string): number | null {
    const match = /^## \[[\d.]+\].*?-\s*(\d{4}-\d{2}-\d{2})/m.exec(content)
    if (!match?.[1]) return null
    const releaseDate = new Date(match[1] + 'T00:00:00Z')
    const elapsed = Date.now() - releaseDate.getTime()
    return Math.max(0, Math.floor(elapsed / 86_400_000))
}

function loadCachedLastReleaseDaysAgo(targetPath?: string): number | null {
    const root = targetPath || resolveProjectRoot()
    const existing = cachedLastReleaseDaysAgo.get(root)
    if (existing !== undefined) return existing

    try {
        const changelogPath = path.join(root, 'CHANGELOG.md')
        if (fs.existsSync(changelogPath)) {
            const content = fs.readFileSync(changelogPath, 'utf-8')
            const age = parseLastReleaseAge(content)
            cachedLastReleaseDaysAgo.set(root, age)
        } else {
            cachedLastReleaseDaysAgo.set(root, null)
        }
    } catch {
        logger.debug('Failed to get release info (non-critical)', {
            module: 'BRIEFING',
            operation: 'release-age',
        })
        cachedLastReleaseDaysAgo.set(root, null)
    }

    return cachedLastReleaseDaysAgo.get(root) ?? null
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
    targetRepoPath?: string,
    resourceCount?: number
): SystemContext {
    const now = new Date()

    // Format localTime compactly: "2026-05-25 06:12 EDT"
    let localTime: string
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
        localTime = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`
    } catch {
        localTime = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    }

    // Filter summary — only show when a filter is actually narrowing the tool set
    const totalTools = getAllToolNames().length
    let filterSummary: string | null = null
    if (filterConfig) {
        const enabled = filterConfig.enabledTools.size
        if (enabled < totalTools) {
            filterSummary = `${filterConfig.raw} (${String(enabled)}/${String(totalTools)})`
        }
    }

    // Check if readonly (admin tools disabled, and codemode disabled since codemode is root)
    let isReadonly = false
    if (filterConfig) {
        const hasAdmin = TOOL_GROUPS.admin.some((t) => filterConfig.enabledTools.has(t))
        const hasCodemode = filterConfig.enabledTools.has('mj_execute_code')
        isReadonly = !hasAdmin && !hasCodemode
    }

    // Registry repos
    const registryRepos = config?.projectRegistry ? Object.keys(config.projectRegistry) : null

    // IO roots count
    const ioRootCount = config?.allowedIoRoots?.length ?? 0

    // Check for code-map.md in project root
    let hasCodeMap = false
    try {
        const root = targetRepoPath || resolveProjectRoot()
        hasCodeMap = fs.existsSync(path.join(root, 'test-server', 'code-map.md'))
    } catch {
        // Non-critical — code-map indicator is best-effort
    }

    // Check for local health status
    let localCheck: boolean | null = null
    try {
        const root = targetRepoPath || resolveProjectRoot()
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
        registryRepos: registryRepos && registryRepos.length > 0 ? registryRepos : null,
        ioRootCount,
        hasCodeMap,
        lastReleaseDaysAgo: loadCachedLastReleaseDaysAgo(targetRepoPath),
        localCheck,
        workspaceId: config?.defaultWorkspaceId,
    }
}
