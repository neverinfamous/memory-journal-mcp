import { describe, it, expect } from 'vitest'
import { convertNotion } from '../../../src/markdown/converters/notion'

describe('convertNotion', () => {
    it('should convert Notion properties to frontmatter', () => {
        const content = `# Project Plan
Status: In Progress
Tags: project, planning
Date: October 12, 2023
Priority: High

## Details
This is a Notion export.
`
        const filename = 'Engineering 12345678901234567890123456789012/Architecture 12345678901234567890123456789012/Project Plan.md'

        const result = convertNotion(content, filename)
        
        expect(result.metadata.tags).toEqual(['engineering', 'architecture'])
        expect(result.body).toContain('## Details')
    })

    it('should handle exports without properties', () => {
        const content = `# Simple Note
Just a simple note without Notion properties.
`
        const filename = 'Simple Note.md'

        const result = convertNotion(content, filename)
        
        expect(result.body).toContain('Just a simple note')
    })

    it('should handle filenames with UUIDs', () => {
        const filename = 'My Document 1234567890abcdef1234567890abcdef.md'
        const content = 'Content without H1'

        const result = convertNotion(content, filename)
        expect(result.body).toContain('# My Document')
    })
})
