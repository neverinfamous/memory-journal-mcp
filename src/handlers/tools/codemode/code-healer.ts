/**
 * Script syntax healing and AST/regex normalization for Code Mode execution payloads.
 */

import { extractAndRecoverJsonCode } from './json-entry-recovery.js'
import { extractAndRecoverSqlCode, extractAndRecoverPreparedStatementCode } from './sql-recovery.js'
import {
    escapeDelimiterChar,
    isInsideStringLiteral,
    isInsideStringOrComment,
    isValidJsScript,
    rewriteContextJsonParseCalls,
    rewriteModuleImportsAndExports,
} from './code-healer-rewrites.js'

export { escapeDelimiterChar, isInsideStringLiteral, isInsideStringOrComment, isValidJsScript }

function escapeTemplateInterpolation(content: string): string {
    return escapeDelimiterChar(content, '`').replace(/(?<!\\)\$\{/g, '\\${')
}

function stripLeadingShimAssignments(src: string): string {
    let rest = src.trimStart()
    const lineShimRe =
        /^(?:const|let|var)\s+(?:\{[^}\n]*\}|[\w$]+)\s*=\s*(?:mj(?:\.[\w$]+)?|__safeFs|path|\(?typeof\s+mj[^\n;]*|await\s+import\([^)\n]+\)|require\([^)\n]+\)|import\([^)\n]+\)|await\s+mcp|mcp);?[ \t]*(?:\r?\n|$)/i

    while (rest.length > 0) {
        if (rest.startsWith('/*')) {
            const closeIdx = rest.indexOf('*/', 2)
            if (closeIdx === -1) break
            rest = rest.slice(closeIdx + 2).trimStart()
            continue
        }
        if (rest.startsWith('//')) {
            const nlIdx = rest.indexOf('\n')
            if (nlIdx === -1) {
                rest = ''
                break
            }
            rest = rest.slice(nlIdx + 1).trimStart()
            continue
        }
        const match = lineShimRe.exec(rest)
        if (match !== null && match[0].length > 0) {
            rest = rest.slice(match[0].length).trimStart()
            continue
        }
        break
    }
    return rest
}

function unwrapNestedExecuteCode(src: string): string {
    const current = src.trim()
    const stripped = stripLeadingShimAssignments(current)
    const nestedMatch =
        /^(?:(?:const|let|var)\s+[\w$]+\s*=\s*)?(?:return\s+)?(?:await\s+)?(?:(?:__mcp|mcp|mj|tools)\.)*(?:mj_)?(?:execute_code|executeCode|execute)\s*\(\s*(?:\{\s*(?:code|script)\s*:\s*)?([`'"])([\s\S]*?)\1\s*\}?\s*\)\s*;?(?:\s*return\s+[\w$]+;?)?$/i.exec(
            stripped
        )
    if (nestedMatch?.[2] !== undefined) {
        const inner = nestedMatch[2].trim()
        if (isValidJsScript(inner) && !/^[A-Za-z_$][\w$]*$/.test(inner)) {
            return inner
        }
        const isNatural =
            /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(inner) &&
            !/\b(const|let|var|function|return|await|import|export|mj\.)\b/.test(inner)
        if (isNatural || /^(?:create|add|new|record|log)?\s*entry\b/i.test(inner)) {
            const firstLine = (inner.split('\n')[0] ?? '')
                .replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '')
                .replace(/[:.]+$/, '')
                .trim()
            const title = firstLine.length > 0 && firstLine.length < 80 ? firstLine : 'Journal Entry'
            return `return await mj.core.createEntry({\n  title: ${JSON.stringify(title)},\n  content: ${JSON.stringify(inner)},\n  entry_type: "technical_note"\n});`
        }
        return inner
    }
    return current
}

const ACCIDENTAL_TAGGED_TEMPLATE_RE =
    /(?<!\\)`(?:\.[a-zA-Z0-9_$-]+(?:\.[a-zA-Z0-9_$-]+)*|\[[^\]]+\])`/

function hasAccidentalTaggedTemplateBackticks(src: string): boolean {
    return ACCIDENTAL_TAGGED_TEMPLATE_RE.test(src)
}

function shouldLeaveValidSnippetUntouched(snippet: string, isExpression: boolean): boolean {
    if (hasAccidentalTaggedTemplateBackticks(snippet)) return false
    const wrapped = isExpression ? `(${snippet})` : snippet
    return isValidJsScript(wrapped)
}

function applyTemplateAndQuoteDelimiterHealing(src: string): string {
    let executionCode = src
    const statementKeywordsOrBraces =
        /(?:;\s*\n|\b(?:const|let|var|return|if|for|while|function|switch|class|export|import)\b|\{|\})/

    executionCode = executionCode.replace(
        /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (
                isInsideStringOrComment(executionCode, offset) ||
                shouldLeaveValidSnippetUntouched(`{ ${match} }`, true)
            ) {
                return match
            }
            return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
        }
    )

    executionCode = executionCode.replace(
        /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (isInsideStringOrComment(executionCode, offset)) return match
            if (content.includes('\n')) return `${prefix}\`${escapeTemplateInterpolation(content)}\``
            return `${prefix}'${escapeDelimiterChar(content, "'")}'`
        }
    )

    executionCode = executionCode.replace(
        /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (isInsideStringOrComment(executionCode, offset)) return match
            if (content.includes('\n')) return `${prefix}\`${escapeTemplateInterpolation(content)}\``
            return `${prefix}"${escapeDelimiterChar(content, '"')}"`
        }
    )

    executionCode = executionCode.replace(
        /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch|mj_create_entry|mjCreateEntry|mj_update_entry|mjUpdateEntry|mj_search_entries|mjSearchEntries)\s*\(\s*)`([\s\S]*?)`(?=\s*(?:,\s*|\)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (isInsideStringOrComment(executionCode, offset) || statementKeywordsOrBraces.test(content))
                return match
            return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
        }
    )

    executionCode = executionCode.replace(
        /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch)\s*\(\s*)'([\s\S]*?)'(?=\s*(?:,\s*|\)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (isInsideStringOrComment(executionCode, offset) || statementKeywordsOrBraces.test(content))
                return match
            if (content.includes('\n')) return `${prefix}\`${escapeTemplateInterpolation(content)}\``
            return `${prefix}'${escapeDelimiterChar(content, "'")}'`
        }
    )
    executionCode = executionCode.replace(
        /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch)\s*\(\s*)"([\s\S]*?)"(?=\s*(?:,\s*|\)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (isInsideStringOrComment(executionCode, offset) || statementKeywordsOrBraces.test(content))
                return match
            if (content.includes('\n')) return `${prefix}\`${escapeTemplateInterpolation(content)}\``
            return `${prefix}"${escapeDelimiterChar(content, '"')}"`
        }
    )

    executionCode = executionCode.replace(
        /(\b(?:const|let|var)\s+[\w$]+\s*=\s*)`([\s\S]*?)`(?=\s*(?:;|\n\s*(?:const|let|var|return|await|mj\.|function|\/\*|\/\/)))/g,
        (match: string, prefix: string, content: string, offset: number): string => {
            if (
                isInsideStringOrComment(executionCode, offset) ||
                shouldLeaveValidSnippetUntouched(match, false)
            ) {
                return match
            }
            return `${prefix}\`${escapeDelimiterChar(content, '`')}\``
        }
    )

    return executionCode
}

/**
 * Re-attempt delimiter escaping after a runtime tagged-template `is not a function` failure.
 */
export function healTemplateBackticksOnRuntimeError(code: string): string | null {
    const candidate = applyTemplateAndQuoteDelimiterHealing(code)
    return candidate !== code && isValidJsScript(candidate) ? candidate : null
}

function rewriteSandboxNodeAndContextCalls(src: string): string {
    let executionCode = unwrapNestedExecuteCode(src)
    executionCode = executionCode.replace(
        /(?:fs|fs\.promises)\.readFileSync\s*\([^)]*\)/g,
        (match, offset: number, fullStr: string) =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : '(typeof context !== "undefined" && context.content ? context.content : "")'
    )
    executionCode = executionCode.replace(
        /(?:fs|fs\.promises)\.readFile\s*\([^)]*\)/g,
        (match, offset: number, fullStr: string) =>
            isInsideStringOrComment(fullStr, offset)
                ? match
                : 'Promise.resolve(typeof context !== "undefined" && context.content ? context.content : "")'
    )
    executionCode = executionCode.replace(
        /\bfs\.(existsSync|statSync|stat|lstatSync)\s*\(/g,
        (match, method: string, offset: number, fullStr: string) =>
            isInsideStringOrComment(fullStr, offset) ? match : `__safeFs.${method}(`
    )
    executionCode = executionCode.replace(
        /process\.env\.([a-zA-Z0-9_]+)/g,
        (match, _key: string, offset: number, fullStr: string) =>
            isInsideStringOrComment(fullStr, offset) ? match : 'undefined'
    )
    executionCode = executionCode.replace(
        /process\.env\b/g,
        (match, offset: number, fullStr: string) =>
            isInsideStringOrComment(fullStr, offset) ? match : '{}'
    )
    if (!isValidJsScript(executionCode) || hasAccidentalTaggedTemplateBackticks(executionCode)) {
        executionCode = applyTemplateAndQuoteDelimiterHealing(executionCode)
    }
    return rewriteContextJsonParseCalls(executionCode)
}

/**
 * Auto-heals common syntax, template literal, and LLM formatting errors in Code Mode execution payloads.
 */
export function healCodeModeScript(code: string): string {
    if (Buffer.byteLength(code, 'utf-8') > 50 * 1024) return code
    let executionCode = code

    const healedSql = extractAndRecoverSqlCode(executionCode)
    if (healedSql !== null) return healedSql
    const healedPrepared = extractAndRecoverPreparedStatementCode(executionCode)
    if (healedPrepared !== null) return healedPrepared
    const healedJson = extractAndRecoverJsonCode(executionCode)
    if (healedJson !== null) return healedJson

    executionCode = executionCode.replace(
        /<(?:CURRENT_PROJECT_NUMBER|CURRENT_PROJECT_ID|PROJECT_NUMBER|PROJECT_ID)>/g,
        (match: string, offset: number, fullStr: string): string =>
            isInsideStringOrComment(fullStr, offset) ? match : 'undefined'
    )
    executionCode = rewriteModuleImportsAndExports(executionCode)
    executionCode = rewriteSandboxNodeAndContextCalls(executionCode)

    return executionCode.endsWith('\n') ? executionCode : `${executionCode}\n`
}
