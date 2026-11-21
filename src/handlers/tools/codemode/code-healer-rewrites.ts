/**
 * Low-level string literal inspection, syntax validation, delimiter escaping, and
 * string-guarded module/context rewrite helpers for `code-healer.ts` (Appendix A & H3).
 */

import * as vm from 'node:vm'
import {
    canStartRegexLiteral,
    createDelimiterState,
    markLineTerminator,
    scanIdentifierWord,
    skipRegexLiteralBody,
    trackIdentifierToken,
    trackPunctuationToken,
    trackTwoCharOperatorToken,
} from '../../../codemode/security-stripper.js'
import { skipLineOrBlockComment } from '../../../codemode/security-stripper-escapes.js'

export type NonCodeSpan = readonly [number, number]

function advanceStringLiteralStep(
    code: string,
    i: number,
    inString: string,
    isEscaped: boolean,
    state: ReturnType<typeof createDelimiterState>,
    stopLimit: number
): { inString: string | null; isEscaped: boolean; next: number; prevToken?: string } {
    const ch = code[i]
    if (ch === '\\') return { inString, isEscaped: !isEscaped, next: i + 1 }
    if (inString === '`' && !isEscaped && ch === '$' && code[i + 1] === '{' && i + 1 < stopLimit) {
        state.templateBraces.push(0)
        return { inString: null, isEscaped: false, next: i + 2, prevToken: '(' }
    }
    if (ch === inString && !isEscaped) {
        return { inString: null, isEscaped: false, next: i + 1, prevToken: inString }
    }
    return { inString, isEscaped: false, next: i + 1 }
}

interface LexicalScanState {
    inString: string | null
    spanStart: number
    isEscaped: boolean
    prevToken: string
    lineOnlyWsOrComments: boolean
    abortToCode: boolean
}

function isLineBreakChar(ch: string): boolean {
    return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029'
}

function maybeSkipComment(
    code: string,
    i: number,
    allowHtmlClose: boolean
): ReturnType<typeof skipLineOrBlockComment> {
    const ch = code[i]
    return ch === '/' || ch === '<' || ch === '-'
        ? skipLineOrBlockComment(code, i, allowHtmlClose)
        : null
}

function stepCodeLexicalChar(
    code: string,
    i: number,
    limit: number,
    scan: LexicalScanState,
    delim: ReturnType<typeof createDelimiterState>,
    spans?: NonCodeSpan[]
): number {
    const ch = code[i] ?? ''
    if (ch === "'" || ch === '"' || ch === '`') {
        scan.inString = ch
        scan.spanStart = i
        scan.lineOnlyWsOrComments = false
        return i
    }
    if (ch === '/' && code[i + 1] !== '/' && code[i + 1] !== '*' && canStartRegexLiteral(scan.prevToken, delim)) {
        const endRegex = skipRegexLiteralBody(code, i + 1)
        if (limit < code.length && endRegex > limit) {
            scan.abortToCode = true
            return i
        }
        spans?.push([i, endRegex])
        scan.prevToken = '/'
        delim.canAsiRegex = false
        scan.lineOnlyWsOrComments = false
        return endRegex - 1
    }
    if (ch === '.' && code[i + 1] === '.' && code[i + 2] === '.') {
        scan.prevToken = trackPunctuationToken('...', scan.prevToken, delim)
        scan.lineOnlyWsOrComments = false
        return i + 2
    }
    if (
        (ch === '+' && code[i + 1] === '+') ||
        (ch === '-' && code[i + 1] === '-') ||
        (ch === '=' && code[i + 1] === '>') ||
        (ch === '?' && code[i + 1] === '?') ||
        (ch === '?' && code[i + 1] === '.' && !/[0-9]/.test(code[i + 2] ?? ''))
    ) {
        scan.prevToken = trackTwoCharOperatorToken(ch + (code[i + 1] ?? ''), scan.prevToken, delim)
        scan.lineOnlyWsOrComments = false
        return i + 1
    }
    if (
        /[A-Za-z0-9_$]/.test(ch) ||
        (ch === '\\' && code[i + 1] === 'u') ||
        ((code.codePointAt(i) ?? 0) > 0x7f &&
            /[\p{ID_Start}\p{ID_Continue}$_]/u.test(String.fromCodePoint(code.codePointAt(i) ?? 0)))
    ) {
        const ident = scanIdentifierWord(code, i)
        scan.prevToken = trackIdentifierToken(ident.word, scan.prevToken, delim)
        scan.lineOnlyWsOrComments = false
        return ident.next - 1
    }
    if (ch === '}' && delim.templateBraces.length > 0 && delim.templateBraces.at(-1) === 0) {
        delim.templateBraces.pop()
        scan.inString = '`'
        scan.spanStart = i
        scan.isEscaped = false
        scan.lineOnlyWsOrComments = false
        return i
    }
    if (isLineBreakChar(ch)) {
        scan.lineOnlyWsOrComments = true
        markLineTerminator(delim)
    } else if (!/\s/.test(ch)) {
        scan.prevToken = trackPunctuationToken(ch, scan.prevToken, delim)
        scan.lineOnlyWsOrComments = false
    }
    return i
}

function scanLexicalSpans(
    code: string,
    stopAtOffset?: number
): { stateAtOffset: 'code' | 'string' | 'comment'; spans: NonCodeSpan[] } {
    const limit = stopAtOffset ?? code.length
    const spans: NonCodeSpan[] = []
    const delim = createDelimiterState()
    const scan: LexicalScanState = {
        inString: null,
        spanStart: -1,
        isEscaped: false,
        prevToken: '',
        lineOnlyWsOrComments: true,
        abortToCode: false,
    }

    for (let i = 0; i < limit; i++) {
        if (scan.inString !== null) {
            const step = advanceStringLiteralStep(code, i, scan.inString, scan.isEscaped, delim, limit)
            scan.inString = step.inString
            scan.isEscaped = step.isEscaped
            if (step.prevToken !== undefined) {
                scan.prevToken = step.prevToken
                delim.canAsiRegex = false
            }
            scan.lineOnlyWsOrComments = false
            if (scan.inString === null && stopAtOffset === undefined && scan.spanStart >= 0) {
                spans.push([scan.spanStart, step.next])
                scan.spanStart = -1
            }
            i = step.next - 1
            continue
        }
        const comment = maybeSkipComment(code, i, scan.lineOnlyWsOrComments)
        if (comment !== null) {
            if (
                stopAtOffset !== undefined &&
                (comment.next > limit || (comment.next === code.length && comment.unterminated === true))
            ) {
                return { stateAtOffset: 'comment', spans }
            }
            if (stopAtOffset === undefined) spans.push([i, comment.next])
            if (comment.hasNewline === true) {
                scan.lineOnlyWsOrComments = true
                markLineTerminator(delim)
            }
            i = comment.next - 1
            continue
        }
        i = stepCodeLexicalChar(
            code,
            i,
            limit,
            scan,
            delim,
            stopAtOffset === undefined ? spans : undefined
        )
        if (scan.abortToCode) return { stateAtOffset: 'code', spans }
    }
    if (stopAtOffset === undefined && scan.inString !== null && scan.spanStart >= 0) {
        spans.push([scan.spanStart, limit])
    }
    return { stateAtOffset: scan.inString !== null ? 'string' : 'code', spans }
}

/** Collects non-code (string/template/comment) ranges in one linear pass for O(log K) offset checks. */
export function buildNonCodeSpans(code: string): readonly NonCodeSpan[] {
    return scanLexicalSpans(code).spans
}

/** Binary-searches sorted non-code spans produced by `buildNonCodeSpans`. */
export function isOffsetInNonCodeSpan(spans: readonly NonCodeSpan[], offset: number): boolean {
    let lo = 0
    let hi = spans.length - 1
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1
        const span = spans[mid]
        if (span === undefined) break
        if (offset < span[0]) hi = mid - 1
        else if (offset >= span[1]) lo = mid + 1
        else return true
    }
    return false
}

export function isInsideStringLiteral(code: string, offset: number): boolean {
    return scanLexicalSpans(code, offset).stateAtOffset === 'string'
}

export function isInsideStringOrComment(code: string, offset: number): boolean {
    return scanLexicalSpans(code, offset).stateAtOffset !== 'code'
}

const VALID_JS_CACHE_MAX = 256
const VALID_JS_MAX_LEN = 16 * 1024
const VALID_JS_CACHE = new Map<string, boolean>()

export function isValidJsScript(src: string): boolean {
    if (src.length <= VALID_JS_MAX_LEN) {
        const cached = VALID_JS_CACHE.get(src)
        if (cached !== undefined) {
            VALID_JS_CACHE.delete(src)
            VALID_JS_CACHE.set(src, cached)
            return cached
        }
    }
    let valid: boolean
    try {
        new vm.Script(`"use strict";\n(async () => {\n${src}\n})()`)
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

function formatEscapedDelimiter(bsCount: number, delimiter: string): string {
    if (bsCount === 2 && (delimiter === "'" || delimiter === '"')) return `\\${delimiter}`
    return '\\'.repeat(bsCount % 2 === 0 ? bsCount + 1 : bsCount) + delimiter
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
                result += formatEscapedDelimiter(bsCount, delimiter)
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

/** Replace regex matches whose start offset falls outside string/template literals and comments. */
export function replaceOutsideNonCode(
    src: string,
    regex: RegExp,
    replacer: (match: string, ...captures: string[]) => string
): string {
    let spans: readonly NonCodeSpan[] | undefined
    return src.replace(regex, (...args: unknown[]) => {
        const match = typeof args[0] === 'string' ? args[0] : ''
        const fullStr = typeof args.at(-1) === 'string' ? (args.at(-1) as string) : src
        const offset = typeof args.at(-2) === 'number' ? (args.at(-2) as number) : 0
        spans ??= buildNonCodeSpans(fullStr)
        if (isOffsetInNonCodeSpan(spans, offset)) return match
        const captures = args.slice(1, -2).map((v) => (typeof v === 'string' ? v : ''))
        return replacer(match, ...captures)
    })
}

/** Rewrite top-level ESM/CommonJS module statements outside string literals and comments into `mj` bindings. */
export function rewriteModuleImportsAndExports(src: string): string {
    let executionCode = src
    const exportDefaultCount = executionCode.match(/\bexport\s+default\b/g)?.length ?? 0
    if (
        exportDefaultCount === 1 &&
        executionCode.includes('{') &&
        executionCode.includes('}')
    ) {
        executionCode = replaceOutsideNonCode(
            executionCode,
            /export\s+default\s+async\s+function(?:\s+[\w$]+)?\s*\(([^()\n]{0,500})\)\s*\{([\s\S]*)\}/g,
            (_match: string, param: string, body: string): string => {
                const p = param.trim()
                return `(async (${p ? `${p} = mj` : ''}) => { ${body} })()`
            }
        )
        executionCode = replaceOutsideNonCode(
            executionCode,
            /export\s+default\s+function(?:\s+[\w$]+)?\s*\(([^()\n]{0,500})\)\s*\{([\s\S]*)\}/g,
            (_match: string, param: string, body: string): string => {
                const p = param.trim()
                return `(async (${p ? `${p} = mj` : ''}) => { ${body} })()`
            }
        )
    }
    executionCode = replaceOutsideNonCode(executionCode, /export\s+default\s+/g, () => '')
    executionCode = replaceOutsideNonCode(executionCode, /(?<![.\w$])tools\./g, () => 'mj.')
    executionCode = replaceOutsideNonCode(
        executionCode,
        /(?:const|let|var)\s+(\{[^}\n]{0,300}\}|[\w$]+)\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"\n]{1,300})['"]\s*\);?/g,
        (_match: string, varName: string, modName: string): string =>
            mapModuleBindingReplacement(varName, modName, 'dynamic import')
    )
    executionCode = replaceOutsideNonCode(
        executionCode,
        /(?:await\s+)?import\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"\n]{1,200})['"]\s*\);?/g,
        () => '/* auto-healed dynamic import */'
    )
    executionCode = replaceOutsideNonCode(
        executionCode,
        /(?:const|let|var)\s+(\{[^}\n]{0,300}\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"\n]{1,300})['"]\s*\);?/g,
        (_match: string, varName: string, modName: string): string =>
            mapModuleBindingReplacement(varName, modName, 'require')
    )
    executionCode = replaceOutsideNonCode(
        executionCode,
        /^[ \t]*require\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"\n]{1,200})['"]\s*\);?/gm,
        () => '/* auto-healed require */'
    )
    return replaceOutsideNonCode(
        executionCode,
        /import\s+(\{[^}\n]{0,300}\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+['"]([^'"\n]{1,300})['"]\s*;?/g,
        (_match: string, varName: string, modName: string): string =>
            mapModuleBindingReplacement(varName, modName, 'import')
    )
}

/** Guard `JSON.parse(context...)` calls outside string/template literals and comments. */
export function rewriteContextJsonParseCalls(src: string): string {
    let executionCode = src
    executionCode = replaceOutsideNonCode(
        executionCode,
        /\bJSON\.parse\s*\(\s*context\s*\)/g,
        () => '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = replaceOutsideNonCode(
        executionCode,
        /\bJSON\.parse\s*\(\s*context\s*\|\|\s*['"][^'"\n]{0,500}['"]\s*\)/g,
        () => '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = replaceOutsideNonCode(
        executionCode,
        /\bJSON\.parse\s*\(\s*context\s*\?\?\s*['"][^'"\n]{0,500}['"]\s*\)/g,
        () => '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    return replaceOutsideNonCode(
        executionCode,
        /\bJSON\.parse\s*\(\s*(context\.[a-zA-Z0-9_$]+)\s*\)/g,
        (_match: string, prop: string): string =>
            `(typeof ${prop} === "string" ? JSON.parse(${prop}) : ${prop})`
    )
}
