import { describe, it, expect } from 'vitest'
import { applyArgInterceptions } from '../../src/codemode/param-normalizer.js'

describe('worker-api-proxy session summary auto-healing', () => {
    it('should normalize mangled headers for mj.core.createEntry', () => {
        const payload = {
            project_number: 5,
            tags: ['session-summary'],
            content: `
## Accomplishments
- Fixed some bugs

## Blockers
- None

## Next steps
- More tests
`
        }

        const result = applyArgInterceptions('createEntry', [payload]) as { args: unknown[] }
        const modifiedPayload = result.args[0] as Record<string, unknown>
        const content = modifiedPayload['content'] as string

        expect(content).toContain('## Accomplished\n- Fixed some bugs')
        expect(content).toContain('## Unfinished / Blocked\n- None')
        expect(content).toContain('## Context for Next Session\n- More tests')
        expect(content).toContain('## Commits\n- None') // appended
    })

    it('should inject missing headers when missing entirely for mj.team.createEntry', () => {
        const payload = {
            project_number: 5,
            entry_type: 'retrospective', // retrospective triggers the session summary check
            content: `This is a generic text blob.`
        }

        const result = applyArgInterceptions('teamCreateEntry', [payload]) as { args: unknown[] }
        const modifiedPayload = result.args[0] as Record<string, unknown>
        const content = modifiedPayload['content'] as string

        expect(content).toContain('This is a generic text blob.')
        expect(content).toContain('## Accomplished')
        expect(content).toContain('## Unfinished / Blocked')
        expect(content).toContain('## Context for Next Session')
        expect(content).toContain('## Commits')
    })

    it('should correctly heal teamUpdateEntry payloads', () => {
        const payload = {
            entry_id: 123,
            tags: ['session-summary'],
            content: `
## Done
- Update item

## Unfinished/Blocked
- None
`
        }

        const result = applyArgInterceptions('teamUpdateEntry', [payload]) as { args: unknown[] }
        const modifiedPayload = result.args[0] as Record<string, unknown>
        const content = modifiedPayload['content'] as string

        expect(content).toContain('## Accomplished\n- Update item')
        expect(content).toContain('## Unfinished / Blocked\n- None')
        expect(content).toContain('## Context for Next Session\n- \n')
        expect(content).toContain('## Commits\n- None')
    })
})
