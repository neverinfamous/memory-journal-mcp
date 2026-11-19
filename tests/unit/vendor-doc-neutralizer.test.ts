import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasHostScriptReferences, neutralizeVendoredDoc } from '../../scripts/vendor-doc-neutralizer.js'

describe('vendor-doc-neutralizer', () => {
    it('rewrites backslash bun commit wrappers to the repo-local commit script', () => {
        const input = 'Use `bun .\\.agents\\scripts\\commit.ts --msg "fix: x"` to commit.'
        expect(neutralizeVendoredDoc(input)).toBe('Use `pnpm exec tsx scripts/commit.ts --msg "fix: x"` to commit.')
    })

    it('rewrites other bun wrappers (any slash style) into host-wrapper wording', () => {
        const input = [
            'Run `bun .\\.agents\\scripts\\get-git-history-json.ts --uncommitted --stats`.',
            'Run `bun ./.agents/scripts/agent-exec.ts --help`.',
            'Run `bun .agents/scripts/usability/scripts/generate-tests.ts`.',
        ].join('\n')
        expect(neutralizeVendoredDoc(input)).toBe(
            [
                "Run the host's `get-git-history-json.ts --uncommitted --stats` wrapper.",
                "Run the host's `agent-exec.ts --help` wrapper.",
                "Run the host's `usability/scripts/generate-tests.ts` wrapper.",
            ].join('\n')
        )
    })

    it('rewrites bare concrete .agents/scripts file references but leaves placeholders and directories alone', () => {
        const input =
            'See `.agents/scripts/usability/coordinator-workflow.md`; fallback resolves `.agents/scripts/<name>`; never write to `.agents/scripts/scratch-repo`.'
        expect(neutralizeVendoredDoc(input)).toBe(
            "See the host's `usability/coordinator-workflow.md`; fallback resolves `.agents/scripts/<name>`; never write to `.agents/scripts/scratch-repo`."
        )
    })

    it('is idempotent and reports no remaining host references after rewriting', () => {
        const input = 'A `bun .\\.agents\\scripts\\commit.ts` B `bun .\\.agents\\scripts\\x.ts -n 1` C `.agents/scripts/y.md`'
        expect(hasHostScriptReferences(input)).toBe(true)
        const once = neutralizeVendoredDoc(input)
        expect(neutralizeVendoredDoc(once)).toBe(once)
        expect(hasHostScriptReferences(once)).toBe(false)
    })

    it.each(['lib-agent-exec', 'lib-git-history'])('ships a path-neutral src/vendor/%s/AGENT_README.md', (lib) => {
        const content = readFileSync(join(process.cwd(), 'src', 'vendor', lib, 'AGENT_README.md'), 'utf8')
        expect(hasHostScriptReferences(content)).toBe(false)
        expect(content).not.toMatch(/bun \.\\\.agents\\scripts\\/)
        expect(neutralizeVendoredDoc(content)).toBe(content)
    })
})
