/**
 * Script syntax healing and AST/regex normalization for Code Mode execution payloads.
 */

import * as vm from 'node:vm'
import { extractAndRecoverJsonCode } from './json-entry-recovery.js'
import { extractAndRecoverSqlCode, extractAndRecoverPreparedStatementCode } from './sql-recovery.js'

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
            if (ch === "'" || ch === '"' || ch === '`') {
                inString = ch
            }
        }
    }
    return inString !== null
}

export function isValidJsScript(src: string): boolean {
    try {
        new vm.Script(`(async () => {\n${src}\n})()`)
        return true
    } catch {
        return false
    }
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
    if (mod.includes('memory') || mod.includes('journal')) {
        return `const ${targetVar} = mj;`
    }
    if (
        mod === 'mcp' ||
        mod.includes('mcp') ||
        targetVar.toLowerCase() === 'mcp' ||
        targetVar === '__mcp' ||
        mod.includes('modelcontextprotocol')
    ) {
        return `const ${targetVar} = mj;`
    }
    return `const ${targetVar} = mj;`
}

function unwrapNestedExecuteCode(src: string): string {
    const current = src.trim()
    const stripped = current
        .replace(
            /^(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\s*(?:const|let|var)\s+(?:\{[^}]*\}|[\w$]+)\s*=\s*(?:mj(?:\.[\w$]+)?|__safeFs|path|\(?typeof\s+mj[^\n;]*|await\s+import\([^)]+\)|require\([^)]+\)|import\([^)]+\)|await\s+mcp|mcp);?\s*)+/i,
            ''
        )
        .trim()
    const nestedMatch =
        /^(?:(?:const|let|var)\s+[\w$]+\s*=\s*)?(?:return\s+)?(?:await\s+)?(?:(?:__mcp|mcp|mj|tools)\.)*(?:mj_)?(?:execute_code|executeCode|execute)\s*\(\s*(?:\{\s*(?:code|script)\s*:\s*)?([`'"])([\s\S]*?)\1\s*\}?\s*\)\s*;?(?:\s*return\s+[\w$]+;?)?$/i.exec(
            stripped
        )
    if (nestedMatch?.[2] !== undefined) {
        const inner = nestedMatch[2].trim()
        const isNatural =
            /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(inner) &&
            !/\b(const|let|var|function|return|await|import|export|mj\.)\b/.test(inner)
        if (isNatural || /^(?:create|add|new|record|log)?\s*entry\b/i.test(inner)) {
            const firstLine = (inner.split('\n')[0] ?? '')
                .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
                .replace(/[:.]+$/, '')
                .trim()
            const title = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
            return `return await mj.core.createEntry({\n  title: ${JSON.stringify(title)},\n  content: ${JSON.stringify(inner)},\n  entry_type: "technical_decision"\n});`
        }
        return inner
    }
    return current
}

/**
 * Auto-heals common syntax, template literal, and LLM formatting errors in Code Mode execution payloads.
 */
export function healCodeModeScript(code: string): string {
    if (Buffer.byteLength(code, 'utf-8') > 50 * 1024) {
        return code
    }
    let executionCode = code

    const healedSql = extractAndRecoverSqlCode(executionCode)
    if (healedSql !== null) return healedSql

    const healedPrepared = extractAndRecoverPreparedStatementCode(executionCode)
    if (healedPrepared !== null) return healedPrepared

    const healedJson = extractAndRecoverJsonCode(executionCode)
    if (healedJson !== null) return healedJson

    executionCode = executionCode.replace(/<CURRENT_PROJECT_NUMBER>/g, 'undefined')
    executionCode = executionCode.replace(/<CURRENT_PROJECT_ID>/g, 'undefined')
    executionCode = executionCode.replace(/<PROJECT_NUMBER>/g, 'undefined')
    executionCode = executionCode.replace(/<PROJECT_ID>/g, 'undefined')

    executionCode = executionCode.replace(
        /export\s+default\s+async\s+function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g,
        (_m: string, param: string, body: string): string => {
            const p = param.trim()
            const pClause = p ? `${p} = mj` : ''
            return `(async (${pClause}) => { ${body} })()`
        }
    )
    executionCode = executionCode.replace(
        /export\s+default\s+function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g,
        (_m: string, param: string, body: string): string => {
            const p = param.trim()
            const pClause = p ? `${p} = mj` : ''
            return `(async (${pClause}) => { ${body} })()`
        }
    )
    executionCode = executionCode.replace(/export\s+default\s+/g, '')
    executionCode = executionCode.replace(/\btools\./g, 'mj.')

    // Auto-heal dynamic import(), require(), and static import statements
    executionCode = executionCode.replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\);?/g,
        (_m: string, varName: string, modName: string): string =>
            mapModuleBindingReplacement(varName, modName, 'dynamic import')
    )
    executionCode = executionCode.replace(
        /(?:await\s+)?import\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/g,
        '/* auto-healed dynamic import */'
    )

    executionCode = executionCode.replace(
        /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\);?/g,
        (_m: string, varName: string, modName: string): string =>
            mapModuleBindingReplacement(varName, modName, 'require')
    )
    executionCode = executionCode.replace(
        /^\s*require\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/gm,
        '/* auto-healed require */'
    )

    executionCode = executionCode.replace(
        /import\s+(\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+['"]([^'"]+)['"]\s*;?/g,
        (_m: string, varName: string, modName: string): string =>
            mapModuleBindingReplacement(varName, modName, 'import')
    )

    executionCode = unwrapNestedExecuteCode(executionCode)

    executionCode = executionCode.replace(
        /(?:fs|fs\.promises)\.readFileSync\s*\([^)]*\)/g,
        '(typeof context !== "undefined" && context.content ? context.content : "")'
    )
    executionCode = executionCode.replace(
        /(?:fs|fs\.promises)\.readFile\s*\([^)]*\)/g,
        'Promise.resolve(typeof context !== "undefined" && context.content ? context.content : "")'
    )
    executionCode = executionCode.replace(/\bfs\.(existsSync|statSync|stat|lstatSync)\s*\(/g, '__safeFs.$1(')
    executionCode = executionCode.replace(/process\.env\.([a-zA-Z0-9_]+)/g, () => 'undefined')
    executionCode = executionCode.replace(/process\.env/g, '{}')

    if (!isValidJsScript(executionCode)) {
        const statementKeywordsOrBraces =
            /(?:;\s*\n|\b(?:const|let|var|return|if|for|while|function|switch|class|export|import)\b|\{|\})/

        executionCode = executionCode.replace(
            /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset)) return match
                return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
            }
        )

        executionCode = executionCode.replace(
            /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset)) return match
                if (content.includes('\n')) return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
                return `${prefix}'${escapeDelimiterChar(content, "'")}'`
            }
        )

        executionCode = executionCode.replace(
            /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset)) return match
                if (content.includes('\n')) return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
                return `${prefix}"${escapeDelimiterChar(content, '"')}"`
            }
        )

        executionCode = executionCode.replace(
            /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch|mj_create_entry|mjCreateEntry|mj_update_entry|mjUpdateEntry|mj_search_entries|mjSearchEntries)\s*\(\s*)`([\s\S]*?)`(?=\s*(?:,\s*|\)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset) || statementKeywordsOrBraces.test(content))
                    return match
                return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
            }
        )

        executionCode = executionCode.replace(
            /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch)\s*\(\s*)'([\s\S]*?)'(?=\s*(?:,\s*|\)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset) || statementKeywordsOrBraces.test(content))
                    return match
                if (content.includes('\n')) return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
                return `${prefix}'${escapeDelimiterChar(content, "'")}'`
            }
        )
        executionCode = executionCode.replace(
            /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch)\s*\(\s*)"([\s\S]*?)"(?=\s*(?:,\s*|\)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset) || statementKeywordsOrBraces.test(content))
                    return match
                if (content.includes('\n')) return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
                return `${prefix}"${escapeDelimiterChar(content, '"')}"`
            }
        )

        executionCode = executionCode.replace(
            /(\b(?:const|let|var)\s+[\w$]+\s*=\s*)`([\s\S]*?)`(?=\s*(?:;|\n\s*(?:const|let|var|return|await|mj\.|function|\/\*|\/\/)))/g,
            (match: string, prefix: string, content: string, offset: number): string => {
                if (isInsideStringLiteral(executionCode, offset)) return match
                return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
            }
        )
    }

    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\)/g,
        '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\|\|\s*['"][^'"]*['"]\s*\)/g,
        '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*context\s*\?\?\s*['"][^'"]*['"]\s*\)/g,
        '(typeof context === "string" ? JSON.parse(context) : context)'
    )
    executionCode = executionCode.replace(
        /\bJSON\.parse\s*\(\s*(context\.[a-zA-Z0-9_$]+)\s*\)/g,
        '(typeof $1 === "string" ? JSON.parse($1) : $1)'
    )

    if (!executionCode.endsWith('\n')) {
        executionCode += '\n'
    }

    return executionCode
}
