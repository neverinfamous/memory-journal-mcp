import { describe, it, expect } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../../src/markdown/frontmatter.js'

describe('parseFrontmatter', () => {
    it('should correctly parse well-formed frontmatter', () => {
        const markdown = `---
mj_id: 123
entry_type: decision
author: Alice
tags:
  - architecture
  - backend
timestamp: 2026-04-08T12:00:00Z
significance: high
relationships:
  - type: blocked_by
    target_id: 456
  - type: references
    target_id: 789
source: team
---
This is the content.`

        const { metadata, body } = parseFrontmatter(markdown)

        expect(metadata).toEqual({
            mj_id: 123,
            entry_type: 'decision',
            author: 'Alice',
            tags: ['architecture', 'backend'],
            timestamp: '2026-04-08T12:00:00Z',
            significance: 'high',
            relationships: [
                { type: 'blocked_by', target_id: 456 },
                { type: 'references', target_id: 789 },
            ],
            source: 'team',
        })
        expect(body).toBe('This is the content.')
    })

    it('should handle markdown without frontmatter', () => {
        const markdown = 'Just some text here.'
        const { metadata, body } = parseFrontmatter(markdown)
        expect(metadata).toEqual({})
        expect(body).toBe('Just some text here.')
    })

    it('should extract partial frontmatter', () => {
        const markdown = `---
mj_id: 42
tags:
  - simple
---
Content`
        const { metadata, body } = parseFrontmatter(markdown)
        expect(metadata).toEqual({
            mj_id: 42,
            tags: ['simple'],
        })
        expect(body).toBe('Content')
    })

    it('should ignore invalid YAML structures gracefully due to our custom parser limitations, but not crash', () => {
        const markdown = `---
invalid_key:
  foo: bar
mj_id: 99
---
Content`
        const { metadata, body } = parseFrontmatter(markdown)
        expect(metadata.mj_id).toBe(99)
        expect(body).toBe('Content')
    })

    it('should require the first delimiter to be on line 1 to be treated as frontmatter', () => {
        const markdown = `
---
mj_id: 1
---
Body`
        const { metadata, body } = parseFrontmatter(markdown)
        expect(metadata).toEqual({})
        // Expecting the original text minus spacing because of how split/join might happen
        expect(body).toContain('mj_id: 1')
    })

    it('should return empty metadata and full content if closing delimiter is missing', () => {
        const markdown = `---
mj_id: 123
Body without closing delimiter`
        const { metadata, body } = parseFrontmatter(markdown)
        expect(metadata).toEqual({})
        expect(body).toBe(markdown)
    })

    it('should throw an error if frontmatter fails schema validation', () => {
        const markdown = `---
mj_id: "not-a-number"
---
Body`
        expect(() => parseFrontmatter(markdown)).toThrow(/Invalid frontmatter: mj_id/i)
    })

    it('should strip single quotes from string values', () => {
        const markdown = `---
author: 'Alice'
---
Body`
        const { metadata } = parseFrontmatter(markdown)
        expect(metadata.author).toBe('Alice')
    })
})

describe('serializeFrontmatter', () => {
    it('should serialize metadata to YAML-like format', () => {
        const metadata = {
            mj_id: 123,
            entry_type: 'decision',
            author: 'Alice',
            tags: ['architecture', 'backend'],
            timestamp: '2026-04-08T12:00:00Z',
            significance: 'high',
            relationships: [
                { type: 'blocked_by', target_id: 456 },
                { type: 'references', target_id: 789 },
            ],
            source: 'team',
        }

        const serialized = serializeFrontmatter(metadata)
        expect(serialized).toContain('---')
        expect(serialized).toContain('mj_id: 123')
        expect(serialized).toContain('entry_type: decision')
        expect(serialized).toContain('author: Alice')
        expect(serialized).toContain('tags:')
        expect(serialized).toContain('  - architecture')
        expect(serialized).toContain('  - backend')
        expect(serialized).toContain('relationships:')
        expect(serialized).toContain('  - type: blocked_by')
        expect(serialized).toContain('    target_id: 456')
        expect(serialized).toContain('  - type: references')
        expect(serialized).toContain('    target_id: 789')
    })

    it('should return empty string if no metadata provided', () => {
        expect(serializeFrontmatter({})).toBe('')
        expect(serializeFrontmatter(null as any)).toBe('')
        expect(serializeFrontmatter(undefined as any)).toBe('')
    })

    it('should serialize only provided fields', () => {
        const metadata = { mj_id: 42 }
        const serialized = serializeFrontmatter(metadata)
        expect(serialized).toBe('---\nmj_id: 42\n---\n')
    })
})
