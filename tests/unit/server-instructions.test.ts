import { describe, it, expect } from 'vitest'
import {
    generateStandardInstructions,
    generateCodeModeInstructions,
} from '../../src/constants/server-instructions.js'

describe('server-instructions generation', () => {
    it('generates standard instructions without code mode reference', () => {
        const tools = new Set(['create_entry', 'search_entries'])
        const text = generateStandardInstructions(tools, [])
        expect(text).toContain('## Quick Access')
        expect(text).toContain('Essential Behaviors')
        // Should NOT contain Code Mode section or API reference
        expect(text).not.toContain('## Code Mode')
        expect(text).not.toContain('# Code Mode API Reference')
    })

    it('injects Code Mode instructions snippet when codemode group is enabled in standard mode', () => {
        const tools = new Set(['create_entry', 'mj_execute_code'])
        const text = generateStandardInstructions(tools, [])
        expect(text).toContain('## Quick Access')
        // Code Mode snippet is included
        expect(text).toContain('## Code Mode')
        // But the FULL reference is not (it remains in memory://help/codemode)
        expect(text).not.toContain('# Code Mode API Reference')
    })

    it('generates full Code Mode API reference via generateCodeModeInstructions', () => {
        const tools = new Set(['mj_execute_code'])
        const text = generateCodeModeInstructions(tools, [])
        expect(text).toContain('## Quick Access')
        expect(text).toContain('## Code Mode')
        // Inject the full reference
        expect(text).toContain('# Code Mode API Reference')
        expect(text).toContain('### `mj.core`')
    })


    it('includes dynamic help pointers for enabled groups', () => {
        const tools = new Set(['create_entry', 'get_github_issues'])
        const text = generateStandardInstructions(tools, [])
        
        expect(text).toMatch(/Read `memory:\/\/help\/\{group\}` for:.*github/i)
        expect(text).not.toContain('codemode')
    })
})
