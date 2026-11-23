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

    it('separates the Code Mode snippet with a blank line and advertises session_id in the top-level contract', () => {
        const tools = new Set(['create_entry', 'mj_execute_code'])
        const text = generateStandardInstructions(tools, [])
        expect(text).toMatch(/\n\n## Code Mode\n/)
        expect(text).toMatch(/Top-Level Contract: `mj_execute_code\(\{[^}]*\bsession_id\b[^}]*\}\)`/)
    })

    it('omits test-only methods and the duplicated Healing Aliases bullet from the full Code Mode reference', () => {
        const text = generateCodeModeInstructions(new Set(['mj_execute_code']), [])
        for (const testOnly of ['testSimple', 'testErrorHandling', 'triggerProgress']) {
            expect(text).not.toContain(testOnly)
        }
        expect(text).not.toContain('**Healing Aliases:**')
        expect(text.match(/^Aliases: /gm)?.length).toBe(1)
        expect(text).toContain('`session_id` (active conversation UUID)')
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

    it('counts only canonical TOOL_GROUPS tools in Active Tools header and ignores dummy aliases', () => {
        const tools = new Set(['create_entry', 'search_entries', 'view_file', 'grep_search'])
        const text = generateStandardInstructions(tools, [])
        expect(text).toContain('## Active Tools (2)')
        expect(text).not.toContain('view_file')
        expect(text).not.toContain('grep_search')
    })

    it('cleans Latest entry snapshot via extractPreview (strips CMS-04 headings and redacts home paths)', () => {
        const text = generateStandardInstructions(new Set(['create_entry']), [], {
            id: 42,
            timestamp: '2026-11-23T12:00:00Z',
            entryType: 'retrospective',
            content: '## Accomplished\n- Updated `/home/alice/repo/src/app.ts` cleanly.',
        })
        expect(text).toContain('**Latest**: #42')
        expect(text).not.toContain('## Accomplished')
        expect(text).not.toContain('/home/alice')
        expect(text).toContain('~/repo/src/app.ts')
    })
})
