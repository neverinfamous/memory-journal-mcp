/**
 * Low-level string literal inspection, syntax validation, delimiter escaping, and
 * string-guarded module/context rewrite helpers for `code-healer.ts` (Appendix A & H3).
 */

import * as vm from 'node:vm'

export function isInsideStringLiteral(code: string, offset: number): boolean {
    let inString: string | null = null
    let isEscaped = false
    for (let i = 0; i < offset; i++) {
        const ch = code[i]
        if (inString !== null) {
            if (ch === '\\') {
                isEscaped = !isEscaped
            } else {
                if (ch === inString && !isEscaped) {
                    inString = null
                }
                isEscaped = false
            }
        } else {
            // [M11] Comments are skipped so quotes inside them never open a fake string literal.
            if (ch === '/' && code[i + 1] === '/') {
                const nl = code.indexOf('\n', i)
                if (nl === -1 || nl >= offset) return false
                i = nl
                continue
            }
            if (ch === '/' && code[i + 1] === '*') {
                const end = code.indexOf('*/', i + 2)
                if (end === -1 || end + 1 >= offset) return false
                i = end + 1
                continue
            }
            if (ch === "'" || ch === '"' || ch === '`') {
                inString = ch
            }
        }
    }
    return inString !== null
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

/** Rewrite top-level ESM/CommonJS module statements outside string literals into `mj` bindings. */
export function rewriteModuleImportsAndExports(src: string): string {
    let executionCode = src
    executionCode = executionCode.replace(
        /export\s+default\s+async\s+function(?:\s+[\w$]+)?\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g,
        (match: string, param: string, body: string, offset: number, fullStr: string): string => {
            if (isInsideStringLiteral(fullStr, offset)) return match
            const p = param.trim()
            return `(async (${p ? `${p} = mj` : ''}) => { ${body} })()`
        }
    )
    executionCode = executionCode.replace(
        /export\s+default\s+function(?:\s+[\w$]+)?\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g,
        (match: string, param: string, body: string, offset: number, fullStr: string): string => {
            if (isInsideStringLiteral(fullStr, offset)) return match
            const p = param.trim()
            return `(async (${p ? `${p} = mj` : ''}) => { ${body} })()`
        }
    )
    executionCode = executionCode.replace(
        /export\s+default\s+/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset) ? match : ''
    )
    executionCode = executionCode.replace(
        /\btools\./g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset) ? match : 'mj.'
    )
    executionCode = executionCode.replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\);?/g,
        (match: string, varName: string, modName: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : mapModuleBindingReplacement(varName, modName, 'dynamic import')
    )
    executionCode = executionCode.replace(
        /(?:await\s+)?import\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset) ? match : '/* auto-healed dynamic import */'
    )
    executionCode = executionCode.replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\);?/g,
        (match: string, varName: string, modName: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : mapModuleBindingReplacement(varName, modName, 'require')
    )
    executionCode = executionCode.replace(
        /^\s*require\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/gm,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset) ? match : '/* auto-healed require */'
    )
    return executionCode.replace(
        /import\s+(\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
        (match: string, varName: string, modName: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : mapModuleBindingReplacement(varName, modName, 'import')
    )
}

/** Guard `JSON.parse(context...)` calls outside string/template literals. */
export function rewriteContextJsonParseCalls(src: string): string {
    let executionCode = src
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\)/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\|\|\s*['"][^'"]*['"]\s*\)/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\?\?\s*['"][^'"]*['"]\s*\)/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    return executionCode.replace(
        /\bJSON\.parse\s*\(\s*(context\.[a-zA-Z0-9_$]+)\s*\)/g,
        (match: string, prop: string, offset: number, fullStr: string): string =>
            isInsideStringLiteral(fullStr, offset)
                ? match
                : `(typeof ${prop} === "string" ? JSON.parse(${prop}) : ${prop})`
    )
}
