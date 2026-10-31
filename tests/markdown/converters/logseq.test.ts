import { describe, it, expect } from 'vitest'
import { convertLogseq } from '../../../src/markdown/converters/logseq'

describe('convertLogseq', () => {
    it('should convert page properties to tags and extract timestamp', () => {
        const content = `title:: My Page Title
tags:: logseq, test, page
alias:: Other Name
type:: article
date:: 2024-01-01

- First block
  - Child block
`
        const filename = 'Page.md'

        const result = convertLogseq(content, filename)
        
        expect(result.metadata.tags).toEqual(['logseq', 'test', 'page'])
        expect(result.metadata.timestamp).toBe('2024-01-01T00:00:00.000Z')
        
        expect(result.body).toContain('- First block')
        expect(result.body).not.toContain('title::')
    })

    it('should preserve block hierarchy', () => {
        const content = `- Root block
  - Child 1
    - Grandchild
  - Child 2
- Second root
`
        const filename = 'Blocks.md'

        const result = convertLogseq(content, filename)
        expect(result.body).toContain('- Root block')
        expect(result.body).toContain('  - Child 1')
        expect(result.body).toContain('    - Grandchild')
    })

    it('should strip block properties', () => {
        const content = `- A block with properties
  id:: 12345
  collapsed:: true
  - Child block
`
        const filename = 'Properties.md'

        const result = convertLogseq(content, filename)
        expect(result.body).toContain('- A block with properties')
        expect(result.body).toContain('  - Child block')
        expect(result.body).not.toContain('id:: 12345')
    })

    it('should normalize task markers', () => {
        const content = `- DONE A completed task
- TODO A pending task
- LATER A later task
`
        const filename = 'Syntax.md'

        const result = convertLogseq(content, filename)
        expect(result.body).toContain('- [x] A completed task')
        expect(result.body).toContain('- [ ] A pending task')
        expect(result.body).toContain('- [ ] A later task')
    })
})
