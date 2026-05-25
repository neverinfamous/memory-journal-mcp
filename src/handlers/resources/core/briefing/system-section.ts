/**
 * Briefing — System Section Builder
 *
 * Assembles system-level metadata for the briefing resource:
 * server version, tool/resource/prompt surface area counts,
 * local time, unreleased change summary, and test health indicators.
 *
 * Heavy operations (file reads) are cached at module load to avoid
 * repeated I/O on every briefing read.
 */

import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'

import { VERSION } from '../../../../version.js'
import { getAllToolNames } from '../../../../filtering/tool-filter.js'
import { getPrompts } from '../../../prompts/index.js'
import { logger } from '../../../../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface UnreleasedSummary {
    added: number
    changed: number
    fixed: number
    security: number
    removed: number
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
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Static resource count — kept in sync with README.md and code-map.md.
 * Resource registration is static and doesn't change at runtime,
 * so this avoids importing the entire resource registry.
 */
const RESOURCE_COUNT = 36

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
    }

    const headerMap: Record<string, keyof UnreleasedSummary> = {
        'added': 'added',
        'changed': 'changed',
        'fixed': 'fixed',
        'security': 'security',
        'removed': 'removed',
    }

    let currentCategory: keyof UnreleasedSummary | null = null

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
    return total > 0 ? counts : null
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
        const filePath = path.join(root, 'README.md')
        // Only read the first 2KB — badges are at the top of the file
        const fd = fs.openSync(filePath, 'r')
        const buf = Buffer.alloc(2048)
        const bytesRead = fs.readSync(fd, buf, 0, 2048, 0)
        fs.closeSync(fd)
        const content = buf.toString('utf-8', 0, bytesRead)
        cachedTestHealth = parseTestHealth(content)
    } catch {
        logger.debug('README.md not found or unreadable (non-critical)', {
            module: 'BRIEFING',
            operation: 'test-health-parse',
        })
        cachedTestHealth = null
    }

    return cachedTestHealth
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
 */
export function buildSystemContext(): SystemContext {
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
        const get = (type: string): string =>
            parts.find((p) => p.type === type)?.value ?? ''
        localTime = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`
    } catch {
        localTime = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    }

    return {
        version: VERSION,
        toolCount: getAllToolNames().length,
        resourceCount: RESOURCE_COUNT,
        promptCount: getPrompts().length,
        localTime,
        unreleasedSummary: loadCachedUnreleased(),
        testHealth: loadCachedTestHealth(),
    }
}
