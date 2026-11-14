import { describe, it, expect } from 'vitest'
import {
    generateStandardInstructions,
    generateCodeModeInstructions,
} from '../../src/constants/server-instructions.js'
import type { ToolGroup } from '../../src/types/index.js'

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
        expect(text).toContain('## Active Tools (1)')
        expect(text).toContain('**codemode**: `mj_execute_code`')
        expect(text).not.toContain('**core**:')
        // Inject the full reference
        expect(text).toContain('# Code Mode API Reference')
        expect(text).toContain('### `mj.core`')
    })

    it('scopes Active Tools to registered MCP tools when enabledGroups expands for sandbox access', () => {
        const tools = new Set(['mj_execute_code', 'update_configuration'])
        const groups = new Set<ToolGroup>(['core', 'search', 'admin', 'codemode'])
        const text = generateCodeModeInstructions(tools, [], undefined, groups)
        expect(text).toContain('## Active Tools (2)')
        expect(text).toContain('**codemode**: `mj_execute_code`')
        expect(text).toContain('**admin**: `update_configuration`')
        expect(text).not.toContain('**core**:')
        expect(text).toContain('Read `memory://help/{group}` for: core, search, admin, codemode.')
    })


    it('includes dynamic help pointers for enabled groups', () => {
        const tools = new Set(['create_entry', 'get_github_issues'])
        const text = generateStandardInstructions(tools, [])
        
        expect(text).toContain('Read `memory://help/gotchas` for gotchas and critical usage patterns.')
        expect(text).toContain('Read `memory://help/templates`')
        expect(text).toMatch(/Read `memory:\/\/help\/\{group\}` for:.*github/i)
        expect(text).not.toContain('codemode')
    })
})
