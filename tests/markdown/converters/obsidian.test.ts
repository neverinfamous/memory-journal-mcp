import { describe, it, expect } from 'vitest'
import { convertObsidian } from '../../../src/markdown/converters/obsidian'

describe('convertObsidian', () => {
    it('should convert wikilinks to markdown links', () => {
        const content = 'Link to [[Another Note]] and [[Folder/Target Note|Alias Text]].'
        const filename = 'Note.md'

        const result = convertObsidian(content, filename)
        
        expect(result.body).toContain('Link to Another Note and Alias Text.')
    })

    it('should convert block embeds to quotes', () => {
        const content = 'Here is an embed:\n\n![[Some Image.png]]\n\n![[Some Note]]'
        const filename = 'Embed.md'

        const result = convertObsidian(content, filename)
        
        expect(result.body).toContain('> _Embedded: Some Image.png_')
        expect(result.body).toContain('> _Embedded: Some Note_')
    })

    it('should handle existing tags from frontmatter', () => {
        const content = `---
tags: [existing, test]
---
Content`
        const filename = 'Tags.md'

        const result = convertObsidian(content, filename)
        expect(result.metadata.tags).toEqual(['existing', 'test'])
    })

    it('should handle tags as comma separated string', () => {
        const content = `---
tags: existing, test, multiple
---
Content`
        const filename = 'Tags2.md'

        const result = convertObsidian(content, filename)
        expect(result.metadata.tags).toEqual(['existing', 'test', 'multiple'])
    })

    it('should infer entry_type from filename if daily note', () => {
        const content = 'Content'
        const filename = '2024-01-01.md'

        const result = convertObsidian(content, filename)
        expect(result.metadata.entry_type).toBe('standup')
    })
})
