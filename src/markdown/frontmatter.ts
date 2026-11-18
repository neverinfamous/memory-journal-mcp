/**
 * memory-journal-mcp — Frontmatter Parser & Serializer
 *
 * Hand-rolled YAML frontmatter parser (~100 lines) for zero-dependency
 * markdown interoperability. Supports scalar values, string arrays,
 * and object arrays (for relationships).
 *
 * Design rationale: Avoids adding a YAML parsing dependency (js-yaml,
 * yaml, etc.) to keep supply-chain surface minimal. The subset of YAML
 * used by MJ frontmatter is simple enough to parse with line splitting.
 */

import { z } from 'zod'
import { parseCanonicalPositiveInt } from '../utils/safe-positive-int.js'
import {
    RELATIONSHIP_TARGET_KEYS,
    RELATIONSHIP_TYPE_KEYS,
    pickRecordField,
} from '../handlers/tools/schemas/constants-and-primitives.js'

function preprocessFrontmatterRelationship(item: unknown): unknown {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
    const rec = item as Record<string, unknown>
    const rawTarget = pickRecordField(rec, RELATIONSHIP_TARGET_KEYS)
    const parsedTarget = typeof rawTarget === 'string' ? parseCanonicalPositiveInt(rawTarget) : undefined
    const target_id = parsedTarget ?? rawTarget
    const rawType = pickRecordField(rec, RELATIONSHIP_TYPE_KEYS)
    return { type: rawType, target_id }
}

// ============================================================================
// Types
// ============================================================================

/** Parsed frontmatter data structure */
export interface FrontmatterData {
    mj_id?: number
    entry_type?: string
    author?: string
    tags?: string[]
    timestamp?: string
    significance?: string
    workspace_id?: string
    project_number?: number
    relationships?: { type: string; target_id: number }[]
    anchors?: string[]
    source?: string
}

/** Result of parsing a frontmattered markdown file */
export interface ParseResult {
    metadata: FrontmatterData
    body: string
}

// ============================================================================
// Validation Schema
// ============================================================================

const FrontmatterSchema = z.object({
    mj_id: z.number().int().positive().optional(),
    entry_type: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    timestamp: z.string().optional(),
    significance: z.string().optional(),
    workspace_id: z.string().optional(),
    project_number: z.number().int().positive().optional(),
    relationships: z
        .array(
            z.preprocess(
                preprocessFrontmatterRelationship,
                z.object({
                    type: z.string(),
                    target_id: z.number().int().positive(),
                })
            )
        )
        .max(100)
        .optional(),
    anchors: z.array(z.string().max(500)).max(100).optional(),
    source: z.string().optional(),
})

// ============================================================================
// Serializer
// ============================================================================

/**
 * Serialize frontmatter data into a JSON frontmatter block.
 * Output: `---\n{\n  "key": "value"\n}\n---\n`
 */
export function serializeFrontmatter(data: FrontmatterData | null | undefined): string {
    if (!data || Object.keys(data).length === 0) return ''

    // Create a plain object without circular reference risks
    const cleanData: Partial<FrontmatterData> = {}
    if (data.mj_id !== undefined) cleanData.mj_id = data.mj_id
    if (data.entry_type !== undefined) cleanData.entry_type = data.entry_type
    if (data.author !== undefined) cleanData.author = data.author
    if (data.tags && data.tags.length > 0) cleanData.tags = data.tags
    if (data.timestamp !== undefined) cleanData.timestamp = data.timestamp
    if (data.significance !== undefined) cleanData.significance = data.significance
    if (data.workspace_id !== undefined) cleanData.workspace_id = data.workspace_id
    if (data.project_number !== undefined) cleanData.project_number = data.project_number
    if (data.relationships && data.relationships.length > 0)
        cleanData.relationships = data.relationships
    if (data.anchors && data.anchors.length > 0) cleanData.anchors = data.anchors
    if (data.source !== undefined) cleanData.source = data.source

    if (Object.keys(cleanData).length === 0) return ''

    return `---\n${JSON.stringify(cleanData, null, 2)}\n---\n`
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a markdown file with YAML frontmatter.
 *
 * - First line must be `---`
 * - Frontmatter ends at the next `---` line
 * - Supports: scalar values, string arrays (`- item`), relationship objects
 * - Returns validated metadata + body content
 *
 * @throws Error if frontmatter is malformed or fails validation
 */
export function parseFrontmatter(content: string): ParseResult {
    const normalized = content.includes('\r')
        ? content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        : content
    const firstNl = normalized.indexOf('\n')
    const firstLine = (firstNl === -1 ? normalized : normalized.slice(0, firstNl)).trim()

    // Must start with ---
    if (firstLine !== '---') {
        return { metadata: {}, body: normalized }
    }
    if (firstNl === -1) {
        throw new Error('Invalid frontmatter: Found opening --- fence but no closing --- fence')
    }

    // Scan lines in header only via indexOf to avoid splitting/rejoining multi-MB bodies
    let pos = firstNl + 1
    let closingLineStart = -1
    let closingLineEnd = -1
    while (pos <= normalized.length) {
        const nextNl = normalized.indexOf('\n', pos)
        const lineEnd = nextNl === -1 ? normalized.length : nextNl
        if (normalized.slice(pos, lineEnd).trim() === '---') {
            closingLineStart = pos
            closingLineEnd = nextNl === -1 ? normalized.length : nextNl + 1
            break
        }
        if (nextNl === -1) break
        pos = nextNl + 1
    }

    if (closingLineStart === -1) {
        throw new Error('Invalid frontmatter: Found opening --- fence but no closing --- fence')
    }

    const fmText = normalized.slice(firstNl + 1, closingLineStart).trim()
    let raw: Record<string, unknown>

    if (fmText.startsWith('{') && fmText.endsWith('}')) {
        try {
            raw = JSON.parse(fmText) as Record<string, unknown>
        } catch (err: unknown) {
            if (err instanceof Error) {
                throw new Error(`Invalid JSON frontmatter: ${err.message}`, { cause: err })
            }
            throw err
        }
    } else {
        throw new Error(
            'Invalid frontmatter: Frontmatter must be strict JSON enclosed in { } braces.'
        )
    }

    // Validate against schema
    const parseResult = FrontmatterSchema.safeParse(raw)
    if (!parseResult.success) {
        const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        throw new Error(`Invalid frontmatter: ${issues.join('; ')}`)
    }

    // Body is everything after the closing ---
    const rawBody = normalized.slice(closingLineEnd)
    const body = rawBody.startsWith('\n') ? rawBody.slice(1) : rawBody

    return { metadata: parseResult.data, body }
}
