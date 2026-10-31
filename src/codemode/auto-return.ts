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
const NON_RETURNABLE =
    /^\s*(return|throw|const |let |var |if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class |function |\/\/|\/\*|\{|\})/

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
    let trimmed = code.trimEnd()
    if (!trimmed) return code

    // Strip trailing semicolons so the final statement isn't empty
    while (trimmed.endsWith(';')) {
        trimmed = trimmed.slice(0, -1).trimEnd()
    }

    let inString: string | null = null
    let isEscaped = false
    let lastBoundary = -1
    let depth = 0

    // Forward pass to safely find statement boundaries
    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i]
        
        if (inString) {
            if (ch === '\\') {
                isEscaped = !isEscaped
            } else {
                if (ch === inString && !isEscaped) {
                    inString = null
                }
                isEscaped = false
            }
        } else {
            if (ch === "'" || ch === '"' || ch === '`') {
                inString = ch
            } else if (ch === '{' || ch === '[' || ch === '(') {
                depth++
            } else if (ch === '}' || ch === ']' || ch === ')') {
                depth--
            } else if (depth === 0 && (ch === ';' || ch === '\n')) {
                lastBoundary = i
            }
        }
    }

    // Extract the last statement
    const lastStmt = (lastBoundary >= 0 ? trimmed.slice(lastBoundary + 1) : trimmed).trim()

    if (!lastStmt) return code
    if (NON_RETURNABLE.test(lastStmt)) return code

    // Insert `return` before the last statement
    if (lastBoundary >= 0) {
        const before = trimmed.slice(0, lastBoundary + 1)
        return `${before}\nreturn ${lastStmt}`
    }

    // Single statement — just prepend return
    return `return ${trimmed}`
}
