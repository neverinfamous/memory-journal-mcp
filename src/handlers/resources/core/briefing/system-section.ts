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
import { createRequire } from 'node:module'
import * as path from 'node:path'

import { VERSION } from '../../../../version.js'
import { getAllToolNames, TOOL_GROUPS } from '../../../../filtering/tool-filter.js'
import type { ToolFilterConfig } from '../../../../filtering/tool-filter.js'
import { getPrompts } from '../../../prompts/index.js'
import { logger } from '../../../../utils/logger.js'
import type { BriefingConfig } from '../../shared.js'

// ============================================================================
// Types
// ============================================================================

export interface UnreleasedSummary {
    added: number
    changed: number
    fixed: number
    security: number
    removed: number
    /** Top 3 bold-prefixed category names from Added/Changed/Fixed sections */
    keyItems: string[]
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
    unreleasedSummary: UnreleasedSummary | null
    testHealth: TestHealth | null
    /** Compact filter summary, e.g. "codemode (1/70)", or null when all tools exposed */
    filterSummary: string | null
    /** Whether the system is in a read-only state (admin tools disabled) */
    isReadonly: boolean
    /** Active instruction level (essential | standard | full) */
    instructionLevel: string
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
}

// ============================================================================
// Lazy Resource Count (replaces former hardcoded RESOURCE_COUNT constant)
// ============================================================================

/** Startup-cached resource count derived from live registry */
let cachedResourceCount: number | undefined

/**
 * Get the total resource count by lazy-loading the resource registry.
 * Uses dynamic import() to avoid a circular dependency:
 * system-section → resources/index → core/index → briefing/index → system-section
 */
async function getResourceCount(): Promise<number> {
    if (cachedResourceCount !== undefined) return cachedResourceCount

    try {
        const { getResources } = await import('../../index.js')
        cachedResourceCount = getResources().length
    } catch {
        logger.debug('Failed to dynamically load resource count (non-critical)', {
            module: 'BRIEFING',
            operation: 'resource-count',
        })
        cachedResourceCount = 0
    }
    return cachedResourceCount
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
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('../package.json')
    return path.dirname(pkgPath)
}

/**
 * Parse `UNRELEASED.md` into category counts.
 *
 * Expects Keep-a-Changelog format with `### Added`, `### Changed`, etc.
 * Each `-` prefixed line under a header counts as one change.
 */
export function parseUnreleasedSummary(content: string): UnreleasedSummary | null {
    const counts: UnreleasedSummary = {
        added: 0,
        changed: 0,
        fixed: 0,
        security: 0,
        removed: 0,
        keyItems: [],
    }

    /** Count-only fields of UnreleasedSummary (excludes keyItems) */
    type CountKey = 'added' | 'changed' | 'fixed' | 'security' | 'removed'

    const headerMap: Record<string, CountKey> = {
        added: 'added',
        changed: 'changed',
        fixed: 'fixed',
        security: 'security',
        removed: 'removed',
    }

    let currentCategory: CountKey | null = null

    for (const line of content.split('\n')) {
        const trimmed = line.trim()

        // Detect category headers: ### Added, ### Changed, etc.
        const headerMatch = /^###\s+(\w+)/.exec(trimmed)
        if (headerMatch?.[1]) {
            const key = headerMap[headerMatch[1].toLowerCase()]
            currentCategory = key ?? null
            continue
        }

        // Count only top-level bullet items (no leading whitespace)
        if (currentCategory !== null && line.startsWith('- ')) {
            counts[currentCategory]++
        }
    }

    const total = counts.added + counts.changed + counts.fixed + counts.security + counts.removed
    return total > 0 ? { ...counts, keyItems: parseUnreleasedKeyItems(content) } : null
}

/**
 * Extract the top 3 unique bold-prefixed category names from UNRELEASED.md.
 *
 * Looks for lines matching `- **category**: description` under Added/Changed/Fixed
 * headers and returns deduplicated category names.
 */
export function parseUnreleasedKeyItems(content: string): string[] {
    const categories = new Set<string>()
    let inRelevantSection = false

    for (const line of content.split('\n')) {
        const trimmed = line.trim()

        // Track if we're under Added, Changed, or Fixed headers
        const headerMatch = /^###\s+(\w+)/.exec(trimmed)
        if (headerMatch?.[1]) {
            const section = headerMatch[1].toLowerCase()
            inRelevantSection = section === 'added' || section === 'changed' || section === 'fixed'
            continue
        }

        // Extract bold prefix from top-level bullets: - **prefix**: ...
        if (inRelevantSection && line.startsWith('- ')) {
            const boldMatch = /^-\s+\*\*([^*]+)\*\*/.exec(line)
            if (boldMatch?.[1]) {
                categories.add(boldMatch[1].trim())
            }
        }
    }

    // Return top 3 unique items
    return [...categories].slice(0, 3)
}

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

// ============================================================================
// Cached Startup Data
// ============================================================================

let cachedUnreleased: UnreleasedSummary | null | undefined
let cachedTestHealth: TestHealth | null | undefined

function loadCachedUnreleased(): UnreleasedSummary | null {
    if (cachedUnreleased !== undefined) return cachedUnreleased

    try {
        const root = resolveProjectRoot()
        const filePath = path.join(root, 'UNRELEASED.md')
        const content = fs.readFileSync(filePath, 'utf-8')
        cachedUnreleased = parseUnreleasedSummary(content)
    } catch {
        logger.debug('UNRELEASED.md not found or unreadable (non-critical)', {
            module: 'BRIEFING',
            operation: 'unreleased-parse',
        })
        cachedUnreleased = null
    }

    return cachedUnreleased
}

function loadCachedTestHealth(): TestHealth | null {
    if (cachedTestHealth !== undefined) return cachedTestHealth

    try {
        const root = resolveProjectRoot()

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
            cachedTestHealth = { unitTests, e2eTests, coverage }
        } else {
            // Fallback: parse everything from README badges (legacy path)
            const readmePath = path.join(root, 'README.md')
            const fd = fs.openSync(readmePath, 'r')
            const buf = Buffer.alloc(2048)
            const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
            fs.closeSync(fd)
            const content = buf.toString('utf-8', 0, bytesRead)
            cachedTestHealth = parseTestHealth(content)
        }
    } catch {
        logger.debug('Test health data not found or unreadable (non-critical)', {
            module: 'BRIEFING',
            operation: 'test-health-parse',
        })
        cachedTestHealth = null
    }

    return cachedTestHealth
}

// ============================================================================
// Last Release Age (from CHANGELOG.md)
// ============================================================================

let cachedLastReleaseDaysAgo: number | null | undefined

/**
 * Parse the first versioned release header from CHANGELOG.md to compute
 * days elapsed since the last tagged release.
 *
 * Expects Keep-a-Changelog headers: `## [x.y.z](url) - YYYY-MM-DD`
 */
export function parseLastReleaseAge(content: string): number | null {
    // Match: ## [7.7.1](url) - 2026-05-15  OR  ## [7.7.1] - 2026-05-15
    const match = /^## \[[\d.]+\].*?-\s*(\d{4}-\d{2}-\d{2})/m.exec(content)
    if (!match?.[1]) return null
    const releaseDate = new Date(match[1] + 'T00:00:00Z')
    const elapsed = Date.now() - releaseDate.getTime()
    return Math.max(0, Math.floor(elapsed / 86_400_000))
}

function loadCachedLastReleaseDaysAgo(): number | null {
    if (cachedLastReleaseDaysAgo !== undefined) return cachedLastReleaseDaysAgo

    try {
        const root = resolveProjectRoot()
        const filePath = path.join(root, 'CHANGELOG.md')
        // Only read the first 1KB — the latest release header is near the top
        const fd = fs.openSync(filePath, 'r')
        const buf = Buffer.alloc(1024)
        const bytesRead = fs.readSync(fd, buf, 0, 1024, 0)
        fs.closeSync(fd)
        const content = buf.toString('utf-8', 0, bytesRead)
        cachedLastReleaseDaysAgo = parseLastReleaseAge(content)
    } catch {
        logger.debug('CHANGELOG.md not found or unreadable (non-critical)', {
            module: 'BRIEFING',
            operation: 'release-age-parse',
        })
        cachedLastReleaseDaysAgo = null
    }

    return cachedLastReleaseDaysAgo
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
export async function buildSystemContext(
    config?: BriefingConfig,
    filterConfig?: ToolFilterConfig | null
): Promise<SystemContext> {
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

    // Check if readonly (admin tools disabled)
    let isReadonly = false
    if (filterConfig) {
        isReadonly = !TOOL_GROUPS.admin.some((t) => filterConfig.enabledTools.has(t))
    }

    // Registry repos
    const registryRepos = config?.projectRegistry ? Object.keys(config.projectRegistry) : null

    // IO roots count
    const ioRootCount = config?.allowedIoRoots?.length ?? 0

    // Check for code-map.md in project root
    let hasCodeMap = false
    try {
        const root = resolveProjectRoot()
        hasCodeMap = fs.existsSync(path.join(root, 'test-server', 'code-map.md'))
    } catch {
        // Non-critical — code-map indicator is best-effort
    }

    // Check for local health status
    let localCheck: boolean | null = null
    try {
        const root = resolveProjectRoot()
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
        resourceCount: await getResourceCount(),
        promptCount: getPrompts().length,
        localTime,
        unreleasedSummary: loadCachedUnreleased(),
        testHealth: loadCachedTestHealth(),
        filterSummary,
        isReadonly,
        instructionLevel: 'standard',
        registryRepos: registryRepos && registryRepos.length > 0 ? registryRepos : null,
        ioRootCount,
        hasCodeMap,
        lastReleaseDaysAgo: loadCachedLastReleaseDaysAgo(),
        localCheck,
    }
}
