/**
 * Low-level string literal inspection, syntax validation, delimiter escaping, and
 * string-guarded module/context rewrite helpers for `code-healer.ts` (Appendix A & H3).
 */

import * as vm from 'node:vm'
import {
    canStartRegexLiteral,
    createDelimiterState,
    skipLineOrBlockComment,
    skipRegexLiteralBody,
    trackIdentifierToken,
    trackPunctuationToken,
} from '../../../codemode/security-stripper.js'

function advanceStringLiteralStep(
    code: string,
    i: number,
    offset: number,
    inString: string,
    isEscaped: boolean,
    state: ReturnType<typeof createDelimiterState>
): { inString: string | null; isEscaped: boolean; next: number; prevToken?: string } {
    const ch = code[i]
    if (ch === '\\') return { inString, isEscaped: !isEscaped, next: i + 1 }
    if (inString === '`' && !isEscaped && ch === '$' && code[i + 1] === '{' && i + 1 < offset) {
        state.templateBraces.push(0)
        return { inString: null, isEscaped: false, next: i + 2, prevToken: '(' }
    }
    if (ch === inString && !isEscaped) {
        return { inString: null, isEscaped: false, next: i + 1, prevToken: inString }
    }
    return { inString, isEscaped: false, next: i + 1 }
}

function scanCodeOffsetState(code: string, offset: number): 'code' | 'string' | 'comment' {
    let inString: string | null = null
    let isEscaped = false
    let prevToken = ''
    const state = createDelimiterState()

    for (let i = 0; i < offset; i++) {
        const ch = code[i] ?? ''
        if (inString !== null) {
            const step = advanceStringLiteralStep(code, i, offset, inString, isEscaped, state)
            inString = step.inString
            isEscaped = step.isEscaped
            if (step.prevToken !== undefined) prevToken = step.prevToken
            i = step.next - 1
            continue
        }
        const comment = skipLineOrBlockComment(code, i)
        if (comment !== null) {
            if (comment.next > offset || (comment.next === code.length && comment.unterminated === true)) {
                return 'comment'
            }
            i = comment.next - 1
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inString = ch
        } else if (ch === '/' && code[i + 1] !== '/' && code[i + 1] !== '*' && canStartRegexLiteral(prevToken)) {
            i = skipRegexLiteralBody(code, i + 1) - 1
            prevToken = '/'
        } else if (/[A-Za-z0-9_$]/.test(ch)) {
            let j = i
            while (j < offset && /[A-Za-z0-9_$]/.test(code[j] ?? '')) j++
            prevToken = trackIdentifierToken(code.slice(i, j), prevToken, state)
            i = j - 1
        } else if (ch === '=' && code[i + 1] === '>') {
            prevToken = '=>'
            i++
        } else {
            const closingInterp = ch === '}' && state.templateBraces.length > 0 && state.templateBraces.at(-1) === 0
            if (closingInterp) {
                state.templateBraces.pop()
                inString = '`'
                isEscaped = false
            } else if (!/\s/.test(ch)) {
                prevToken = trackPunctuationToken(ch, prevToken, state)
            }
        }
    }
    return inString !== null ? 'string' : 'code'
}

export function isInsideStringLiteral(code: string, offset: number): boolean {
    return scanCodeOffsetState(code, offset) === 'string'
}

export function isInsideStringOrComment(code: string, offset: number): boolean {
    return scanCodeOffsetState(code, offset) !== 'code'
}

const VALID_JS_CACHE_MAX = 256
const VALID_JS_MAX_LEN = 16 * 1024
const VALID_JS_CACHE = new Map<string, boolean>()

export function isValidJsScript(src: string): boolean {
    if (src.length <= VALID_JS_MAX_LEN) {
        const cached = VALID_JS_CACHE.get(src)
        if (cached !== undefined) return cached
    }
    let valid: boolean
    try {
        new vm.Script(`(async () => {\n${src}\n})()`)
        valid = true
    } catch {
        valid = false
    }
    if (src.length <= VALID_JS_MAX_LEN) {
        if (VALID_JS_CACHE.size >= VALID_JS_CACHE_MAX) {
            const firstKey = VALID_JS_CACHE.keys().next().value
            if (firstKey !== undefined) VALID_JS_CACHE.delete(firstKey)
        }
        VALID_JS_CACHE.set(src, valid)
    }
    return valid
}

export function escapeDelimiterChar(content: string, delimiter: string): string {
    let result = ''
    let i = 0
    while (i < content.length) {
        if (content[i] === '\\') {
            let bsCount = 0
            while (i < content.length && content[i] === '\\') {
                bsCount++
                i++
            }
            if (i < content.length && content[i] === delimiter) {
                result += `\\${delimiter}`
                i++
            } else {
                result += '\\'.repeat(bsCount)
            }
        } else if (content[i] === delimiter) {
            result += `\\${delimiter}`
            i++
        } else {
            result += content[i]
            i++
        }
    }
    return result
}

function mapModuleBindingReplacement(varName: string, modName: string, commentTag: string): string {
    const v = varName.trim()
    const mod = modName.toLowerCase().replace(/^node:/, '')
    if (v === 'mj') return `/* auto-healed ${commentTag} */`
    let targetVar = v
    if (v.startsWith('* as ')) {
        targetVar = v.replace(/^\*\s+as\s+/, '')
    }
    if (mod === 'fs' || targetVar === 'fs' || targetVar === '__safeFs') {
        const fsVal = `(typeof mj !== 'undefined' ? (mj.fs || mj) : undefined)`
        return targetVar === '__safeFs'
            ? `var __safeFs = ${fsVal};`
            : `const ${targetVar} = ${fsVal}; var __safeFs = ${fsVal};`
    }
    if (mod === 'path' || targetVar === 'path') {
        const pathVal = `(typeof mj !== 'undefined' ? (mj.path || mj) : undefined)`
        return `const ${targetVar} = ${pathVal};`
    }
    if (
        mod.includes('sqlite') ||
        mod.includes('database') ||
        targetVar.toLowerCase().includes('sqlite') ||
        targetVar.toLowerCase() === 'database'
    ) {
        return `const ${targetVar} = mj.sqlite3;`
    }
    if (targetVar === 'child_process' || mod.includes('child_process')) {
        return `const ${targetVar === 'child_process' ? 'cp' : targetVar} = mj;`
    }
    return `const ${targetVar} = mj;`
}

/** Rewrite top-level ESM/CommonJS module statements outside string literals and comments into `mj` bindings. */
export function rewriteModuleImportsAndExports(src: string): string {
    let executionCode = src
    executionCode = executionCode.replace(
        /export\s+default\s+async\s+function(?:\s+[\w$]+)?\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g,
        (match: string, param: string, body: string, offset: number, fullStr: string): string => {
            if (isInsideStringOrComment(fullStr, offset)) return match
            const p = param.trim()
            return `(async (${p ? `${p} = mj` : ''}) => { ${body} })()`
        }
    )
    executionCode = executionCode.replace(
        /export\s+default\s+function(?:\s+[\w$]+)?\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g,
        (match: string, param: string, body: string, offset: number, fullStr: string): string => {
            if (isInsideStringOrComment(fullStr, offset)) return match
            const p = param.trim()
            return `(async (${p ? `${p} = mj` : ''}) => { ${body} })()`
        }
    )
    executionCode = executionCode.replace(
        /export\s+default\s+/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset) ? match : ''
    )
    executionCode = executionCode.replace(
        /\btools\./g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset) ? match : 'mj.'
    )
    executionCode = executionCode.replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\);?/g,
        (match: string, varName: string, modName: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : mapModuleBindingReplacement(varName, modName, 'dynamic import')
    )
    executionCode = executionCode.replace(
        /(?:await\s+)?import\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset) ? match : '/* auto-healed dynamic import */'
    )
    executionCode = executionCode.replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\);?/g,
        (match: string, varName: string, modName: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : mapModuleBindingReplacement(varName, modName, 'require')
    )
    executionCode = executionCode.replace(
        /^\s*require\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/gm,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset) ? match : '/* auto-healed require */'
    )
    return executionCode.replace(
        /import\s+(\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
        (match: string, varName: string, modName: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : mapModuleBindingReplacement(varName, modName, 'import')
    )
}

/** Guard `JSON.parse(context...)` calls outside string/template literals and comments. */
export function rewriteContextJsonParseCalls(src: string): string {
    let executionCode = src
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\)/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\|\|\s*['"][^'"]*['"]\s*\)/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\?\?\s*['"][^'"]*['"]\s*\)/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    return executionCode.replace(
        /\bJSON\.parse\s*\(\s*(context\.[a-zA-Z0-9_$]+)\s*\)/g,
        (match: string, prop: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : `(typeof ${prop} === "string" ? JSON.parse(${prop}) : ${prop})`
    )
}
