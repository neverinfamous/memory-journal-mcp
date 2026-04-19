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
    relationships?: { type: string; target_id: number }[]
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
    relationships: z
        .array(
            z.object({
                type: z.string(),
                target_id: z.number().int().positive(),
            })
        )
        .max(100)
        .optional(),
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
    if (data.relationships && data.relationships.length > 0) cleanData.relationships = data.relationships
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
    const lines = content.split('\n')

    // Must start with ---
    if (lines[0]?.trim() !== '---') {
        return { metadata: {}, body: content }
    }

    // Find closing ---
    let closingIndex = -1
    for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
            closingIndex = i
            break
        }
    }

    if (closingIndex === -1) {
        throw new Error('Invalid frontmatter: Found opening --- fence but no closing --- fence')
    }

    // Try robust JSON parsing first
    const fmText = lines.slice(1, closingIndex).join('\n').trim()
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
        throw new Error('Invalid frontmatter: Frontmatter must be strict JSON enclosed in { } braces.')
    }

    // Validate against schema
    const parseResult = FrontmatterSchema.safeParse(raw)
    if (!parseResult.success) {
        const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        throw new Error(`Invalid frontmatter: ${issues.join('; ')}`)
    }

    // Body is everything after the closing ---
    const body = lines
        .slice(closingIndex + 1)
        .join('\n')
        .replace(/^\n/, '')

    return { metadata: parseResult.data, body }
}
