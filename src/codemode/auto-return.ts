/**
 * memory-journal-mcp — Code Mode Auto-Return Transform
 *
 * Transforms user code so the last expression statement is implicitly
 * returned from the async IIFE wrapper.  Mimics Node REPL / Chrome
 * DevTools semantics where bare expressions surface their value.
 *
 * The transform is intentionally heuristic (string-based, not AST)
 * because the code runs in a sandboxed `vm.Script` that already
 * handles syntax errors.  Edge-case misfires are safe — they either
 * produce a benign `return` of the last expression or leave the code
 * unchanged (returning `undefined`, the previous behavior).
 */

// Statements that must NOT be prefixed with `return`
const NON_RETURNABLE = /^\s*(return|throw|const |let |var |if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class |function |\/\/|\/\*|\{|\})/

/**
 * Transform user code so the last expression statement gets an
 * implicit `return`, enabling the IIFE wrapper to propagate the value.
 *
 * Examples:
 *   `mj.help()`                       → `return mj.help()`
 *   `const r = await foo(); r`        → `const r = await foo(); return r`
 *   `return 42`                       → `return 42`          (no change)
 *   `for (const x of xs) { ... }`    → unchanged             (control flow)
 */
export function transformAutoReturn(code: string): string {
    const trimmed = code.trimEnd()
    if (!trimmed) return code

    // Find the boundary of the last statement.
    // Walk backwards from the end to find the last semicolon or newline
    // that is NOT inside braces/brackets/parens.
    let depth = 0
    let splitIndex = -1

    for (let i = trimmed.length - 1; i >= 0; i--) {
        const ch = trimmed.charAt(i)
        // Track nesting (walking backwards, so openers increase depth)
        if (ch === '}' || ch === ']' || ch === ')') depth++
        else if (ch === '{' || ch === '[' || ch === '(') depth--

        if (depth === 0 && (ch === ';' || ch === '\n')) {
            splitIndex = i
            break
        }
    }

    // Extract the last statement
    const lastStmt = (splitIndex >= 0 ? trimmed.slice(splitIndex + 1) : trimmed).trim()

    if (!lastStmt) return code
    if (NON_RETURNABLE.test(lastStmt)) return code

    // Insert `return` before the last statement
    if (splitIndex >= 0) {
        const before = trimmed.slice(0, splitIndex + 1)
        return `${before}\nreturn ${lastStmt}`
    }

    // Single statement — just prepend return
    return `return ${trimmed}`
}
