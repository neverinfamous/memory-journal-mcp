/**
 * Tests for Code Mode auto-return transform
 */

import { describe, it, expect } from 'vitest'
import { transformAutoReturn } from '../../src/codemode/auto-return.js'

describe('transformAutoReturn', () => {
    describe('single expressions', () => {
        it('should prepend return to a bare function call', () => {
            expect(transformAutoReturn('mj.help()')).toBe('return mj.help()')
        })

        it('should prepend return to an await expression', () => {
            expect(transformAutoReturn('await mj.core.recent()')).toBe(
                'return await mj.core.recent()'
            )
        })

        it('should prepend return to a variable reference', () => {
            expect(transformAutoReturn('result')).toBe('return result')
        })

        it('should prepend return to a numeric literal', () => {
            expect(transformAutoReturn('42')).toBe('return 42')
        })

        it('should prepend return to a string literal', () => {
            expect(transformAutoReturn('"hello"')).toBe('return "hello"')
        })

        it('should prepend return to a method chain', () => {
            expect(transformAutoReturn('mj.search.searchEntries({ query: "test" })')).toBe(
                'return mj.search.searchEntries({ query: "test" })'
            )
        })
    })

    describe('multi-statement code', () => {
        it('should only prepend return to the last statement (semicolon-separated)', () => {
            const code = 'const r = await mj.core.recent(); r'
            const result = transformAutoReturn(code)
            expect(result).toBe('const r = await mj.core.recent();\nreturn r')
        })

        it('should only prepend return to the last statement (newline-separated)', () => {
            const code = 'const r = await mj.core.recent()\nr'
            const result = transformAutoReturn(code)
            // Split preserves the newline separator, plus adds \n before return
            expect(result).toBe('const r = await mj.core.recent()\n\nreturn r')
        })

        it('should handle multi-line workflow ending with expression', () => {
            const code = [
                'const search = await mj.search.searchEntries({ query: "test" })',
                'const stats = await mj.analytics.getStatistics()',
                '{ search, stats }',
            ].join('\n')
            const result = transformAutoReturn(code)
            // `{ search, stats }` starts with `{` — ambiguous (block vs object literal)
            // so the heuristic correctly leaves it unreturned (safe default).
            // Users should use `return { search, stats }` explicitly for object literals.
            expect(result).toBe(code)
        })

        it('should return last expression when not ambiguous with a block', () => {
            const code = [
                'const search = await mj.search.searchEntries({ query: "test" })',
                'const stats = await mj.analytics.getStatistics()',
                'search.entries.length',
            ].join('\n')
            const result = transformAutoReturn(code)
            expect(result).toContain('return search.entries.length')
            expect(result).toContain('const search = await mj.search.searchEntries')
        })
    })

    describe('statements that must NOT be returned', () => {
        it('should not modify explicit return', () => {
            expect(transformAutoReturn('return 42')).toBe('return 42')
        })

        it('should not modify throw', () => {
            expect(transformAutoReturn('throw new Error("fail")')).toBe('throw new Error("fail")')
        })

        it('should not modify const declaration', () => {
            expect(transformAutoReturn('const x = 42')).toBe('const x = 42')
        })

        it('should not modify let declaration', () => {
            expect(transformAutoReturn('let x = 42')).toBe('let x = 42')
        })

        it('should not modify var declaration', () => {
            expect(transformAutoReturn('var x = 42')).toBe('var x = 42')
        })

        it('should not modify if statement', () => {
            expect(transformAutoReturn('if (true) { foo() }')).toBe('if (true) { foo() }')
        })

        it('should not modify for loop', () => {
            expect(transformAutoReturn('for (const x of xs) { foo(x) }')).toBe(
                'for (const x of xs) { foo(x) }'
            )
        })

        it('should not modify while loop', () => {
            expect(transformAutoReturn('while (true) { break }')).toBe('while (true) { break }')
        })

        it('should not modify try/catch', () => {
            expect(transformAutoReturn('try { foo() } catch (e) { bar() }')).toBe(
                'try { foo() } catch (e) { bar() }'
            )
        })

        it('should not modify function declaration', () => {
            expect(transformAutoReturn('function foo() { return 1 }')).toBe(
                'function foo() { return 1 }'
            )
        })

        it('should not modify class declaration', () => {
            expect(transformAutoReturn('class Foo {}')).toBe('class Foo {}')
        })

        it('should not modify single-line comments', () => {
            expect(transformAutoReturn('// comment')).toBe('// comment')
        })
    })

    describe('edge cases', () => {
        it('should return empty string unchanged', () => {
            expect(transformAutoReturn('')).toBe('')
        })

        it('should return whitespace-only unchanged', () => {
            expect(transformAutoReturn('   ')).toBe('   ')
        })

        it('should handle trailing whitespace', () => {
            expect(transformAutoReturn('mj.help()   ')).toBe('return mj.help()')
        })

        it('should handle trailing semicolon', () => {
            // Last statement after the final semicolon is empty, so no transform
            const code = 'mj.help();'
            const result = transformAutoReturn(code)
            // The semicolon makes the "last statement" empty, so it falls
            // back to returning code unchanged
            expect(result).toBe('mj.help();')
        })

        it('should not return closing brace of a block', () => {
            const code = 'if (true) {\n  foo()\n}'
            expect(transformAutoReturn(code)).toBe(code)
        })

        it('should handle multi-statement ending with function call after semicolon', () => {
            const code = 'const x = 1; mj.help()'
            const result = transformAutoReturn(code)
            expect(result).toBe('const x = 1;\nreturn mj.help()')
        })
    })
})
