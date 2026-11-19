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

import {
    isJsLineTerminator,
    findNextJsLineTerminator,
    skipRegexLiteralBody,
    canStartRegexLiteral,
    scanIdentifierWord,
    trackIdentifierToken,
    trackPunctuationToken,
    createDelimiterState,
    skipLineOrBlockComment,
} from './security-stripper.js'

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
function scanStringStep(
    trimmed: string,
    i: number,
    inString: string,
    isEscaped: boolean,
    state: ReturnType<typeof createDelimiterState>
): { inString: string | null; isEscaped: boolean; next: number; prevToken?: string } {
    const ch = trimmed[i] ?? ''
    if (ch === '\\') return { inString, isEscaped: !isEscaped, next: i + 1 }
    if (inString === '`' && !isEscaped && ch === '$' && trimmed[i + 1] === '{') {
        state.templateBraces.push(0)
        return { inString: null, isEscaped: false, next: i + 2, prevToken: '(' }
    }
    if (ch === inString && !isEscaped) {
        return { inString: null, isEscaped: false, next: i + 1, prevToken: inString }
    }
    return { inString, isEscaped: false, next: i + 1 }
}

function findLastStatementBoundary(trimmed: string): number {
    let inString: string | null = null
    let isEscaped = false
    let lastBoundary = -1
    let depth = 0
    let prevToken = ''
    const state = createDelimiterState()

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i] ?? ''
        if (inString !== null) {
            const step = scanStringStep(trimmed, i, inString, isEscaped, state)
            inString = step.inString
            isEscaped = step.isEscaped
            if (step.prevToken !== undefined) prevToken = step.prevToken
            i = step.next - 1
            continue
        }
        const comment = skipLineOrBlockComment(trimmed, i)
        if (comment !== null) {
            if (comment.next === trimmed.length && findNextJsLineTerminator(trimmed, i) === -1) break
            i = comment.next - 1
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inString = ch
        } else if (ch === '/' && trimmed[i + 1] !== '/' && trimmed[i + 1] !== '*' && canStartRegexLiteral(prevToken, state.parenCtrl.at(-1) === true)) {
            i = skipRegexLiteralBody(trimmed, i + 1) - 1
            prevToken = '/'
        } else if (
            (ch === '+' && trimmed[i + 1] === '+') ||
            (ch === '-' && trimmed[i + 1] === '-') ||
            (ch === '=' && trimmed[i + 1] === '>') ||
            (ch === '?' && trimmed[i + 1] === '.' && !/[0-9]/.test(trimmed[i + 2] ?? ''))
        ) {
            prevToken = ch + (trimmed[i + 1] ?? '')
            i++
        } else if (
            /[A-Za-z0-9_$]/.test(ch) ||
            (ch === '\\' && trimmed[i + 1] === 'u') ||
            ((trimmed.codePointAt(i) ?? 0) > 0x7f && /[\p{ID_Start}\p{ID_Continue}$_]/u.test(String.fromCodePoint(trimmed.codePointAt(i) ?? 0)))
        ) {
            const ident = scanIdentifierWord(trimmed, i)
            prevToken = trackIdentifierToken(ident.word, prevToken, state)
            i = ident.next - 1
        } else {
            const closingInterp = ch === '}' && state.templateBraces.length > 0 && state.templateBraces.at(-1) === 0
            if (closingInterp) {
                state.templateBraces.pop()
                inString = '`'
                isEscaped = false
                continue
            }
            if (ch === '{' || ch === '[' || ch === '(') depth++
            else if (ch === '}' || ch === ']' || ch === ')') depth--
            if (depth === 0 && state.templateBraces.length === 0 && (ch === ';' || isJsLineTerminator(ch))) {
                lastBoundary = i
            }
            if (!/\s/.test(ch)) prevToken = trackPunctuationToken(ch, prevToken, state)
        }
    }
    return lastBoundary
}

export function transformAutoReturn(code: string): string {
    let trimmed = code.trimEnd()
    if (!trimmed) return code

    // Strip trailing semicolons so the final statement isn't empty
    while (trimmed.endsWith(';')) {
        trimmed = trimmed.slice(0, -1).trimEnd()
    }

    const lastBoundary = findLastStatementBoundary(trimmed)
    const lastStmt = (lastBoundary >= 0 ? trimmed.slice(lastBoundary + 1) : trimmed).trim()
    if (!lastStmt || NON_RETURNABLE.test(lastStmt)) return code

    return lastBoundary >= 0
        ? `${trimmed.slice(0, lastBoundary + 1)}\nreturn ${lastStmt}`
        : `return ${trimmed}`
}
