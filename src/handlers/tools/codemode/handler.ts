import * as path from 'node:path'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext, getAuthContext } from '../../../auth/auth-context.js'
import { injectProjectNames } from '../index.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'

import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import { ConfigurationError } from '../../../types/errors.js'

import { ExecuteCodeSchema, ExecuteCodeSchemaMcp, VERSION_AWARE_TOOL_NAMES } from './schemas.js'
import { collectNonCodeModeTools, getSandboxPool, getSecurityManager } from './singleton-state.js'
import type { SandboxResult } from '../../../codemode/types.js'

/**
 * Auto-heals common syntax, template literal, and LLM formatting errors in Code Mode execution payloads.
 */
export function healCodeModeScript(code: string): string {
    let executionCode = code

    // [Layer 2 Dispatcher Healing] Auto-heal raw SQL queries passed as code
    const healedSql = extractAndRecoverSqlCode(executionCode)
    if (healedSql) {
        return healedSql
    }

    // [Layer 2 Dispatcher Healing] Prevent literal placeholder SyntaxErrors
    executionCode = executionCode.replace(/<CURRENT_PROJECT_NUMBER>/g, 'undefined')
    executionCode = executionCode.replace(/<CURRENT_PROJECT_ID>/g, 'undefined')
    executionCode = executionCode.replace(/<PROJECT_NUMBER>/g, 'undefined')
    executionCode = executionCode.replace(/<PROJECT_ID>/g, 'undefined')

    // Auto-heal export default function / export default async function / export default
    executionCode = executionCode.replace(/export\s+default\s+async\s+function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g, (_m: string, param: string, body: string): string => {
        const p = param.trim()
        const pClause = p ? `${p} = mj` : ''
        return `(async (${pClause}) => { ${body} })()`
    })
    executionCode = executionCode.replace(/export\s+default\s+function\s*[\w$]*\s*\(([^)]*)\)\s*\{([\s\S]*)\}/g, (_m: string, param: string, body: string): string => {
        const p = param.trim()
        const pClause = p ? `${p} = mj` : ''
        return `(async (${pClause}) => { ${body} })()`
    })
    executionCode = executionCode.replace(/export\s+default\s+/g, '')

    // Auto-heal tools.* -> mj.*
    executionCode = executionCode.replace(/\btools\./g, 'mj.')

    // Auto-heal dynamic import() expressions: const x = await import('...') or import('...')
    executionCode = executionCode.replace(/(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\);?/g, (_m: string, varName: string, modName: string): string => {
        const v = varName.trim()
        const mod = modName.toLowerCase().replace(/^node:/, '')
        if (v === 'mj') return `/* auto-healed dynamic import */`
        if (mod === 'fs' || v === 'fs') {
            return `const __safeFs = (typeof __safeFs !== 'undefined' ? __safeFs : mj);`
        }
        if (mod === 'path' || v === 'path') {
            return `const path = (typeof path !== 'undefined' ? path : mj);`
        }
        if (mod.includes('sqlite') || mod.includes('database') || v.toLowerCase().includes('sqlite') || v.toLowerCase() === 'database') {
            return `const ${varName} = mj.sqlite3;`
        }
        if (v === 'child_process' || mod.includes('child_process')) {
            return `const ${v === 'child_process' ? 'cp' : varName} = mj;`
        }
        if (mod.includes('memory') || mod.includes('journal')) {
            return `const ${varName} = mj;`
        }
        if (mod === 'mcp' || mod.includes('mcp') || v.toLowerCase() === 'mcp' || v === '__mcp' || mod.includes('modelcontextprotocol')) {
            return `const ${varName} = mj;`
        }
        return `const ${varName} = mj;`
    })
    executionCode = executionCode.replace(/(?:await\s+)?import\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/g, '/* auto-healed dynamic import */')

    // Auto-heal ES module import and CommonJS require statements
    executionCode = executionCode.replace(/(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\);?/g, (_m: string, varName: string, modName: string): string => {
        const v = varName.trim()
        const mod = modName.toLowerCase().replace(/^node:/, '')
        if (v === 'mj') return `/* auto-healed require */`
        if (mod === 'fs' || v === 'fs') {
            return `const __safeFs = (typeof __safeFs !== 'undefined' ? __safeFs : mj);`
        }
        if (mod === 'path' || v === 'path') {
            return `const path = (typeof path !== 'undefined' ? path : mj);`
        }
        if (mod.includes('sqlite') || mod.includes('database') || v.toLowerCase().includes('sqlite') || v.toLowerCase() === 'database') {
            return `const ${varName} = mj.sqlite3;`
        }
        if (v === 'child_process' || mod.includes('child_process')) {
            return `const ${v === 'child_process' ? 'cp' : varName} = mj;`
        }
        if (mod.includes('memory') || mod.includes('journal')) {
            return `const ${varName} = mj;`
        }
        if (mod === 'mcp' || mod.includes('mcp') || v.toLowerCase() === 'mcp' || v === '__mcp' || mod.includes('modelcontextprotocol')) {
            return `const ${varName} = mj;`
        }
        return `const ${varName} = mj;`
    })
    executionCode = executionCode.replace(/^\s*require\s*\(\s*['"](?:fs|node:fs|path|node:path|memory-journal(?:-mcp)?|sqlite-journal|mcp|@modelcontextprotocol\/[^'"]+)['"]\s*\);?/gm, '/* auto-healed require */')

    executionCode = executionCode.replace(/import\s+(\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+['"]([^'"]+)['"]\s*;?/g, (_m: string, varName: string, modName: string): string => {
        const v = varName.trim()
        const mod = modName.toLowerCase().replace(/^node:/, '')
        if (v === 'mj') return `/* auto-healed import */`
        let targetVar = v
        if (v.startsWith('* as ')) {
            targetVar = v.replace(/^\*\s+as\s+/, '')
        }
        if (mod === 'fs' || targetVar === 'fs') {
            return `const __safeFs = (typeof __safeFs !== 'undefined' ? __safeFs : mj);`
        }
        if (mod === 'path' || targetVar === 'path') {
            return `const path = (typeof path !== 'undefined' ? path : mj);`
        }
        if (mod.includes('sqlite') || mod.includes('database') || targetVar.toLowerCase().includes('sqlite') || targetVar.toLowerCase() === 'database') {
            return `const ${targetVar} = mj.sqlite3;`
        }
        if (targetVar === 'child_process' || mod.includes('child_process')) {
            return `const ${targetVar === 'child_process' ? 'cp' : targetVar} = mj;`
        }
        if (mod.includes('memory') || mod.includes('journal')) {
            return `const ${targetVar} = mj;`
        }
        if (mod === 'mcp' || mod.includes('mcp') || targetVar.toLowerCase() === 'mcp' || targetVar === '__mcp' || mod.includes('modelcontextprotocol')) {
            return `const ${targetVar} = mj;`
        }
        return `const ${targetVar} = mj;`
    })
    // Auto-unwrap nested mj_execute_code / execute_code / mcp.execute calls
    const unwrapNested = (src: string): string => {
        const current = src.trim()
        const stripped = current.replace(/^(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\s*(?:const|let|var)\s+[\w$]+\s*=\s*(?:mj|__safeFs|path|await\s+import\([^)]+\)|require\([^)]+\)|import\([^)]+\)|await\s+mcp|mcp);?\s*)+/i, '').trim()
        const nestedMatch = /^(?:(?:const|let|var)\s+[\w$]+\s*=\s*)?(?:return\s+)?(?:await\s+)?(?:(?:__mcp|mcp|mj|tools)\.)*(?:mj_)?(?:execute_code|executeCode|execute)\s*\(\s*(?:\{\s*(?:code|script)\s*:\s*)?([`'"])([\s\S]*?)\1\s*\}?\s*\)\s*;?(?:\s*return\s+[\w$]+;?)?$/i.exec(stripped)
        if (nestedMatch?.[2]) {
            const inner = nestedMatch[2].trim()
            const isNatural = /^(?:write|document|create|include|record|summary|log|add|added|note|task|fix|implement)\b/i.test(inner) &&
                !/\b(const|let|var|function|return|await|import|export|mj\.)\b/.test(inner)
            if (isNatural || /^(?:create|add|new|record|log)?\s*entry\b/i.test(inner)) {
                const firstLine = (inner.split('\n')[0] ?? '').replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '').replace(/[:.]+$/, '').trim()
                const title = (firstLine.length > 0 && firstLine.length < 80) ? firstLine : 'Journal Entry'
                return `return await mj.core.createEntry({\n  title: ${JSON.stringify(title)},\n  content: ${JSON.stringify(inner)},\n  entry_type: "technical_decision"\n});`
            }
            return inner
        }
        return current
    }
    executionCode = unwrapNested(executionCode)

    // Auto-heal fs.readFileSync / fs.readFile calls before security checks
    executionCode = executionCode.replace(/(?:fs|fs\.promises)\.readFileSync\s*\([^)]*\)/g, '(typeof context !== "undefined" && context.content ? context.content : "")')
    executionCode = executionCode.replace(/(?:fs|fs\.promises)\.readFile\s*\([^)]*\)/g, 'Promise.resolve(typeof context !== "undefined" && context.content ? context.content : "")')

    // Auto-heal safe read-only fs inspections (existsSync, statSync, stat, lstatSync)
    executionCode = executionCode.replace(/\bfs\.(existsSync|statSync|stat|lstatSync)\s*\(/g, '__safeFs.$1(')

    // Auto-heal process.env access in Code Mode scripts before security checks
    executionCode = executionCode.replace(/process\.env\.([a-zA-Z0-9_]+)/g, () => 'undefined')
    executionCode = executionCode.replace(/process\.env/g, '{}')

    // Auto-heal unescaped backticks inside template literals on object properties
    executionCode = executionCode.replace(
        /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
        (_match: string, prefix: string, content: string): string => {
            const normalized = content.replace(/\\`/g, '`')
            const escaped = normalized.replace(/`/g, '\\`')
            return `${prefix}\`${escaped}\``
        }
    )

    // Auto-heal double-escaped quotes and unescaped quotes in single-quoted object properties
    executionCode = executionCode.replace(
        /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
        (_match: string, prefix: string, content: string): string => {
            if (content.includes('\n')) {
                const normalized = content.replace(/\\`/g, '`').replace(/`/g, '\\`')
                return `${prefix}\`${normalized}\``
            }
            const normalized = content.replace(/\\+'/g, "'").replace(/'/g, "\\'")
            return `${prefix}'${normalized}'`
        }
    )

    // Auto-heal double-escaped quotes and unescaped quotes in double-quoted object properties
    executionCode = executionCode.replace(
        /(\b(?:content|title|text|description|message|instructions|body|notes|details|resolution_notes|query|script|comment|summary|heading)\s*:\s*)"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/g,
        (_match: string, prefix: string, content: string): string => {
            if (content.includes('\n')) {
                const normalized = content.replace(/\\`/g, '`').replace(/`/g, '\\`')
                return `${prefix}\`${normalized}\``
            }
            const normalized = content.replace(/\\+"/g, '"').replace(/"/g, '\\"')
            return `${prefix}"${normalized}"`
        }
    )

    // Auto-heal unescaped backticks inside positional template arguments to mj.* / createEntry calls
    executionCode = executionCode.replace(
        /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch|mj_create_entry|mjCreateEntry|mj_update_entry|mjUpdateEntry|mj_search_entries|mjSearchEntries)\s*\(\s*)`([\s\S]*?)`(?=\s*(?:,\s*|\)))/g,
        (_match: string, prefix: string, content: string): string => {
            const normalized = content.replace(/\\`/g, '`')
            const escaped = normalized.replace(/`/g, '\\`')
            return `${prefix}\`${escaped}\``
        }
    )

    // Auto-heal double-escaped quotes inside positional string arguments
    executionCode = executionCode.replace(
        /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch)\s*\(\s*)'([\s\S]*?)'(?=\s*(?:,\s*|\)))/g,
        (_match: string, prefix: string, content: string): string => {
            if (content.includes('\n')) {
                const normalized = content.replace(/\\`/g, '`').replace(/`/g, '\\`')
                return `${prefix}\`${normalized}\``
            }
            const normalized = content.replace(/\\+'/g, "'").replace(/'/g, "\\'")
            return `${prefix}'${normalized}'`
        }
    )
    executionCode = executionCode.replace(
        /(\b(?:mj\.)?(?:core\.|team\.|admin\.|search\.|io\.|github\.|git\.|backup\.)?(?:createEntry|teamCreateEntry|appendEntry|updateEntry|teamUpdateEntry|searchEntries|teamSearch)\s*\(\s*)"([\s\S]*?)"(?=\s*(?:,\s*|\)))/g,
        (_match: string, prefix: string, content: string): string => {
            if (content.includes('\n')) {
                const normalized = content.replace(/\\`/g, '`').replace(/`/g, '\\`')
                return `${prefix}\`${normalized}\``
            }
            const normalized = content.replace(/\\+"/g, '"').replace(/"/g, '\\"')
            return `${prefix}"${normalized}"`
        }
    )

    // Auto-heal unescaped backticks in variable declarations with template literals
    executionCode = executionCode.replace(
        /(\b(?:const|let|var)\s+[\w$]+\s*=\s*)`([\s\S]*?)`(?=\s*(?:;|\n\s*(?:const|let|var|return|await|mj\.|function|\/\*|\/\/)))/g,
        (_match: string, prefix: string, content: string): string => {
            const normalized = content.replace(/\\`/g, '`')
            const escaped = normalized.replace(/`/g, '\\`')
            return `${prefix}\`${escaped}\``
        }
    )

    // Auto-heal JSON.parse(context) / JSON.parse(context.<prop>) when context is already an object
    executionCode = executionCode.replace(/\bJSON\.parse\s*\(\s*context\s*\)/g, '(typeof context === "string" ? JSON.parse(context) : context)')
    executionCode = executionCode.replace(/\bJSON\.parse\s*\(\s*context\s*\|\|\s*['"][^'"]*['"]\s*\)/g, '(typeof context === "string" ? JSON.parse(context) : context)')
    executionCode = executionCode.replace(/\bJSON\.parse\s*\(\s*context\s*\?\?\s*['"][^'"]*['"]\s*\)/g, '(typeof context === "string" ? JSON.parse(context) : context)')
    executionCode = executionCode.replace(/\bJSON\.parse\s*\(\s*(context\.[a-zA-Z0-9_$]+)\s*\)/g, '(typeof $1 === "string" ? JSON.parse($1) : $1)')

    // Auto-heal trailing single-line comments or missing terminal newlines
    // If the script ends with a single-line comment (e.g., `// chronological order`),
    // wrapping it in `(async () => { ${code} })()` without a newline causes the closing
    // `})()` to be commented out, leading to "SyntaxError: Unexpected end of input".
    if (!executionCode.endsWith('\n')) {
        executionCode += '\n'
    }

    return executionCode
}

/**
 * Attempt fuzzy recovery of an entry creation or update call from broken/mangled code
 */
export function extractAndRecoverEntryCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null

    // Check if the code was attempting to create or update an entry
    const isCreate = /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory|saveMemory)\b/i.test(code)
    const isUpdate = /\b(?:updateEntry|teamUpdateEntry|update_entry|team_update_entry|updateMemory)\b/i.test(code)
    
    if (!isCreate && !isUpdate) return null

    // Extract content
    const backtickMatch = /\bcontent\s*:\s*`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const singleMatch = /\bcontent\s*:\s*'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const doubleMatch = /\bcontent\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const fallbackMatch = /\bcontent\s*:\s*[`'"]([\s\S]*?)(?:[`'"]\s*)?(?=,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\))/i.exec(code)

    let content: string | undefined = backtickMatch?.[1] ?? singleMatch?.[1] ?? doubleMatch?.[1] ?? fallbackMatch?.[1]

    if (!content) {
        // Fallback: extract everything between `content:` and `, \n <prop>:`
        const altMatch = /\bcontent\s*:\s*`([\s\S]*?)`(?=,\s*[\w$]+\s*:|\s*\})/i.exec(code)
        if (altMatch) {
            content = altMatch[1]
        }
    }

    if (!content) {
        const descMatch = /\b(?:description|summary)\s*:\s*[`'"]([\s\S]*?)[`'"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
        if (descMatch) {
            content = descMatch[1]
        }
    }

    if (!content) return null

    // Clean up content
    content = content.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')

    // Extract other standard fields
    const typeMatch = /\b(?:entry_type|type)\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const titleMatch = /\btitle\s*:\s*[`'"]([\s\S]*?)`['"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code) ?? /\btitle\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const projectMatch = /\b(?:project_number|project)\s*:\s*(\d+)/i.exec(code)
    const sessionMatch = /\bsession_id\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const impactMatch = /\bimpact\s*:\s*([0-9.]+)/i.exec(code)
    const trustMatch = /\btrust\s*:\s*([0-9.]+)/i.exec(code)
    const validationMatch = /\bvalidation_status\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const tagsMatch = /\btags\s*:\s*\[([\s\S]*?)\]/i.exec(code)
    const autoContextMatch = /\bauto_context\s*:\s*(\{[\s\S]*?\})(?=\s*,\s*\n|\s*\n\s*\})/i.exec(code)

    const entryType = typeMatch?.[1]
    const payload: Record<string, unknown> = {
        content,
        entry_type: entryType ?? 'technical_decision',
    }

    const title = titleMatch?.[1]?.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')
    if (title) payload['title'] = title

    const entryIdMatch = /\b(?:entry_id|id)\s*:\s*(\d+)/i.exec(code)
    const entryIdStr = entryIdMatch?.[1]
    if (entryIdStr) payload['entry_id'] = parseInt(entryIdStr, 10)

    const projectStr = projectMatch?.[1]
    if (projectStr) payload['project_number'] = parseInt(projectStr, 10)

    const session = sessionMatch?.[1]
    if (session) payload['session_id'] = session

    const impactStr = impactMatch?.[1]
    if (impactStr) payload['impact'] = parseFloat(impactStr)

    const trustStr = trustMatch?.[1]
    if (trustStr) payload['trust'] = parseFloat(trustStr)

    const validation = validationMatch?.[1]
    if (validation) payload['validation_status'] = validation

    const rawTags = tagsMatch?.[1]
    if (rawTags) {
        try {
            const parsedTags = rawTags.split(',').map((s: string): string => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
            payload['tags'] = parsedTags
        } catch {
            // Ignore tag parse error
        }
    }

    const rawAutoContext = autoContextMatch?.[1]
    if (rawAutoContext) {
        try {
            payload['auto_context'] = JSON.parse(rawAutoContext)
        } catch {
            try {
                const normalizedJson = rawAutoContext.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
                payload['auto_context'] = JSON.parse(normalizedJson)
            } catch {
                // Ignore auto_context parse error
            }
        }
    }

    const fnName = (isUpdate && payload['entry_id'] !== undefined) ? 'mj.updateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}

/**
 * Auto-heals raw SQL queries passed as code or script in Code Mode,
 * translating them to corresponding type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverSqlCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const trimmed = code.trim()

    // If it contains JavaScript declarations or mj.* calls, it is already a JS script
    if (/\b(?:const|let|var|function|return|await|mj\.|import|export|\(\s*\)\s*=>)\b/.test(trimmed)) {
        return null
    }

    // Strip leading SQL comments: -- comment or /* comment */
    const cleanSql = trimmed
        .replace(/^--[^\n]*\n/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()

    const isSql = /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(cleanSql) || /^(?:\.schema|\.tables|\\d|\\dt)/i.test(cleanSql)
    if (!isSql) return null

    // 1. PRAGMA, SHOW, DESCRIBE, EXPLAIN, SCHEMA, TABLES
    if (/^(?:PRAGMA|SHOW|DESCRIBE|EXPLAIN|SCHEMA|TABLES)\b/i.test(cleanSql) || /^(?:\.schema|\.tables|\\d|\\dt)/i.test(cleanSql)) {
        return `return await mj.analytics.getStatistics({});`
    }

    // 2. Extract table name
    const fromMatch = /\bFROM\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = fromMatch?.[1]?.toLowerCase()

    // 3. Extract LIMIT
    const limitMatch = /\bLIMIT\s+(\d+)/i.exec(cleanSql)
    const limitVal = limitMatch?.[1] ? parseInt(limitMatch[1], 10) : undefined

    // 4. Extract ID
    const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)/i.exec(cleanSql)
    const idVal = idMatch?.[1] ? parseInt(idMatch[1], 10) : undefined

    // 5. Extract text search query from LIKE / ILIKE / =
    const likeMatch = /\bWHERE\s+[`"']?(?:[a-zA-Z0-9_]+)[`"']?\s+(?:LIKE|ILIKE|=)\s*['"]%?([^%'"]+)%?['"]/i.exec(cleanSql)
    const searchQuery = likeMatch?.[1]

    // 6. Check for COUNT(*)
    const isCount = /\bCOUNT\s*\(/i.test(cleanSql)

    // Table-specific routing
    if (tableName === 'tags' || tableName === 'entry_tags' || tableName === 'journal_tags') {
        return `return await mj.core.listTags({});`
    }

    if (tableName === 'projects' || tableName === 'project_registry') {
        return `return await mj.admin.listProjects({});`
    }

    if (tableName === 'relationships' || tableName === 'entry_relationships' || tableName === 'links') {
        if (idVal !== undefined) {
            return `return await mj.relationships.visualizeRelationships({ entry_id: ${idVal} });`
        }
        return `return await mj.relationships.visualizeRelationships({});`
    }

    if (tableName === 'team_members' || tableName === 'members') {
        return `return await mj.team.teamListMembers({});`
    }

    if (tableName === 'author_aliases' || tableName === 'aliases') {
        return `return await mj.team.teamListAuthorAliases({});`
    }

    if (tableName === 'audit_log' || tableName === 'audit' || tableName === 'audit_logs') {
        return `return await mj.core.searchAuditLog({});`
    }

    // Default: journal_entries / entries table or general SELECT
    if (/^SELECT\b/i.test(cleanSql)) {
        if (isCount) {
            return `return await mj.analytics.getStatistics({});`
        }
        if (idVal !== undefined) {
            return `return await mj.core.getEntryById({ entry_id: ${idVal} });`
        }
        if (searchQuery) {
            const searchParams: Record<string, unknown> = { query: searchQuery }
            if (limitVal !== undefined) searchParams['limit'] = limitVal
            return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
        }
        // Check for project filter
        const projectMatch = /\bWHERE\s+[`"']?(?:project_number|project_id)[`"']?\s*=\s*(\d+)/i.exec(cleanSql)
        const projectVal = projectMatch?.[1] ? parseInt(projectMatch[1], 10) : undefined

        // Check for type filter
        const typeMatch = /\bWHERE\s+[`"']?(?:type|entry_type)[`"']?\s*=\s*['"]([^'"]+)['"]/i.exec(cleanSql)
        const typeVal = typeMatch?.[1]

        const params: Record<string, unknown> = {
            limit: limitVal ?? 10,
        }
        if (projectVal !== undefined) params['project_number'] = projectVal
        if (typeVal !== undefined) params['entry_type'] = typeVal

        return `return await mj.core.getRecentEntries(${JSON.stringify(params)});`
    }

    // INSERT INTO ...
    if (/^INSERT\s+INTO\b/i.test(cleanSql)) {
        const rec = extractAndRecoverEntryCode(cleanSql)
        if (rec) return rec
        return `return await mj.createEntry({ content: ${JSON.stringify(cleanSql)} });`
    }

    // UPDATE ...
    if (/^UPDATE\b/i.test(cleanSql)) {
        if (idVal !== undefined) {
            return `return await mj.core.updateEntry({ entry_id: ${idVal} });`
        }
    }

    // DELETE FROM ...
    if (/^DELETE\s+FROM\b/i.test(cleanSql)) {
        if (idVal !== undefined) {
            return `return await mj.core.deleteEntry({ entry_id: ${idVal} });`
        }
    }

    return `return await mj.core.getRecentEntries({ limit: ${limitVal ?? 10} });`
}

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    const securityManager = getSecurityManager()
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute JS Code (Sandbox)',
            description:
                'Run arbitrary JavaScript to automate tasks in a secure sandbox. IMPORTANT: You MUST use the `mj` object (NOT `api`, `journal`, or `mcp`) to access tools. DO NOT use import() or require(); the `mj` tools are globally available in the sandbox. Available tools are mapped directly from MCP tool names, converted to camelCase (e.g., `create_entry` -> `mj.createEntry()`, `search_entries` -> `mj.searchEntries()`). Anti-Hallucination Hint: DO NOT GUESS parameter keys (e.g., passing `repo` instead of `repo_name` will fail). ALWAYS inspect the schema first if unsure: `return await mj.createEntry.schema()`. Execution limit: 30s. Network access (`fetch`) disabled. Example: `return await mj.searchEntries({ query: "PowerShell" })`',
            group: 'codemode',
            inputSchema: ExecuteCodeSchemaMcp,
            outputSchema: undefined,
            annotations: {
                readOnlyHint: false, // Execution can be destructive
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                const start = performance.now()
                
                try {
                    const input = ExecuteCodeSchema.parse(params)
                    let executionCode = input.code || input.script || input.source || input.query || input.content || input.text || input.body || input.js || input.javascript || input.payload || input.executionCode || input.input || input.command || input.expression || input.fn || input.exec || input.eval || input.code_snippet || input.raw_code || input.statement || input.statements || input.codeBlock || input.code_block || input.script_content || input.js_code || input.code_string || input.action || input.task || input.instruction || input.instructions

                    // Fallback: search params object for entry object or string properties if code is still undefined
                    if (!executionCode && typeof params === 'object' && params !== null) {
                        const rawObj = params as Record<string, unknown>
                        const entryObj = (typeof rawObj['entry'] === 'object' && rawObj['entry'] !== null ? rawObj['entry'] : rawObj) as Record<string, unknown>
                        if (typeof entryObj['content'] === 'string' || typeof entryObj['title'] === 'string' || typeof entryObj['type'] === 'string' || typeof entryObj['entry_type'] === 'string' || typeof entryObj['instructions'] === 'string' || typeof rawObj['instructions'] === 'string') {
                            const titleVal = typeof entryObj['title'] === 'string' ? entryObj['title'] : 'Journal Entry'
                            const contentVal = typeof entryObj['content'] === 'string' ? entryObj['content'] : typeof entryObj['instructions'] === 'string' ? entryObj['instructions'] : typeof rawObj['instructions'] === 'string' ? rawObj['instructions'] : ''
                            const typeVal = typeof entryObj['type'] === 'string' ? entryObj['type'] : typeof entryObj['entry_type'] === 'string' ? entryObj['entry_type'] : typeof entryObj['category'] === 'string' ? entryObj['category'] : 'technical_decision'
                            const tagsVal = Array.isArray(entryObj['tags']) ? entryObj['tags'] : []
                            const projVal = typeof entryObj['project_number'] === 'number' ? entryObj['project_number'] : typeof rawObj['project_number'] === 'number' ? rawObj['project_number'] : undefined
                            const sessVal = typeof entryObj['session_id'] === 'string' ? entryObj['session_id'] : typeof rawObj['session_id'] === 'string' ? rawObj['session_id'] : undefined
                            
                            const payload: Record<string, unknown> = {
                                title: titleVal,
                                content: contentVal,
                                entry_type: typeVal,
                                tags: tagsVal
                            }
                            if (projVal !== undefined) payload['project_number'] = projVal
                            if (sessVal !== undefined) payload['session_id'] = sessVal
                            
                            executionCode = `return await mj.createEntry(${JSON.stringify(payload)});`
                        } else {
                            for (const [k, v] of Object.entries(rawObj)) {
                                if (typeof v === 'string' && v.trim().length > 0 && !['repo', 'workspace_id', 'expected_version', 'auto_version', 'project_number', 'readonly'].includes(k)) {
                                    executionCode = v
                                    break
                                }
                            }
                        }
                    }

                    // [Layer 2 Dispatcher Healing] Apply full script healing
                    if (executionCode) {
                        executionCode = healCodeModeScript(executionCode)

                        // Anti-Hallucination: Auto-heal raw JSON string passed directly as code parameter
                        const trimmedCode = executionCode.trim()
                        if (trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) {
                            try {
                                const parsedJson = JSON.parse(trimmedCode) as Record<string, unknown>
                                const hasContent = typeof parsedJson['content'] === 'string' && parsedJson['content'].length > 0
                                const op = typeof parsedJson['operation'] === 'string' ? parsedJson['operation'] : typeof parsedJson['op'] === 'string' ? parsedJson['op'] : ''
                                const hasOp = op === 'create_entry' || op === 'add_entry' || op === 'create' || op === 'update_entry' || op === 'update'
                                const hasType = typeof parsedJson['type'] === 'string' || typeof parsedJson['entry_type'] === 'string' || typeof parsedJson['category'] === 'string'
                                const hasSummaryOrFindings = typeof parsedJson['summary'] === 'string' || parsedJson['findings'] !== undefined || typeof parsedJson['description'] === 'string'

                                if (hasContent || hasOp || hasType || hasSummaryOrFindings) {
                                    const contentParts: string[] = []
                                    if (typeof parsedJson['summary'] === 'string' && parsedJson['summary'].trim().length > 0) {
                                        contentParts.push(parsedJson['summary'].trim())
                                    }
                                    if (typeof parsedJson['description'] === 'string' && parsedJson['description'].trim().length > 0) {
                                        contentParts.push(parsedJson['description'].trim())
                                    }
                                    if (Array.isArray(parsedJson['findings']) && parsedJson['findings'].length > 0) {
                                        const findingsList = parsedJson['findings'].map(f => `- ${String(f)}`).join('\n')
                                        contentParts.push(`**Findings:**\n${findingsList}`)
                                    } else if (typeof parsedJson['findings'] === 'string' && parsedJson['findings'].trim().length > 0) {
                                        contentParts.push(`**Findings:**\n${parsedJson['findings'].trim()}`)
                                    }

                                    let contentStr = typeof parsedJson['content'] === 'string'
                                        ? parsedJson['content']
                                        : typeof parsedJson['content'] === 'number' || typeof parsedJson['content'] === 'boolean'
                                            ? String(parsedJson['content'])
                                            : ''
                                    if (contentParts.length > 0) {
                                        contentStr = contentStr.length > 0 ? `${contentStr}\n\n${contentParts.join('\n\n')}` : contentParts.join('\n\n')
                                    }

                                    const rawType = parsedJson['entry_type'] ?? parsedJson['type'] ?? parsedJson['category']
                                    let entryType = 'technical_decision'
                                    if (typeof rawType === 'string') {
                                        const low = rawType.toLowerCase()
                                        if (low === 'code' || low === 'coding' || low === 'technical' || low === 'task') {
                                            entryType = 'technical_decision'
                                        } else {
                                            entryType = low
                                        }
                                    }

                                    const tags: string[] = Array.isArray(parsedJson['tags']) ? parsedJson['tags'].map(String) : []
                                    if (typeof parsedJson['project'] === 'string' && parsedJson['project'].trim().length > 0 && !tags.includes(parsedJson['project'].trim())) {
                                        tags.push(parsedJson['project'].trim())
                                    }

                                    const title = typeof parsedJson['title'] === 'string'
                                        ? parsedJson['title']
                                        : typeof parsedJson['summary'] === 'string'
                                            ? parsedJson['summary'].slice(0, 80)
                                            : undefined

                                    const entryParams: Record<string, unknown> = {
                                        title,
                                        content: contentStr,
                                        entry_type: entryType,
                                        tags,
                                        workspace_id: typeof parsedJson['workspace_id'] === 'string' ? parsedJson['workspace_id'] : undefined,
                                        session_id: typeof parsedJson['session_id'] === 'string' ? parsedJson['session_id'] : undefined,
                                        project_number: typeof parsedJson['project_number'] === 'number' ? parsedJson['project_number'] : undefined,
                                    }

                                    const isUpdate = op === 'update_entry' || op === 'update' || parsedJson['entry_id'] !== undefined || parsedJson['id'] !== undefined
                                    if (isUpdate) {
                                        if (parsedJson['entry_id'] !== undefined) entryParams['entry_id'] = parsedJson['entry_id']
                                        if (parsedJson['id'] !== undefined) entryParams['id'] = parsedJson['id']
                                        executionCode = `return await mj.admin.updateEntry(${JSON.stringify(entryParams)});`
                                    } else {
                                        executionCode = `return await mj.createEntry(${JSON.stringify(entryParams)});`
                                    }
                                }
                            } catch {
                                // Not valid JSON, continue normal execution
                            }
                        }

                        // Anti-Hallucination: Auto-heal raw Markdown text or natural language prompts passed directly to mj_execute_code
                        const rawObj = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>
                        const entryObj = (typeof rawObj['entry'] === 'object' && rawObj['entry'] !== null ? rawObj['entry'] : rawObj) as Record<string, unknown>
                        const entryKeys = [
                            'type', 'entry_type', 'title', 'category', 'changes', 'component',
                            'confidence', 'impact', 'trust', 'validation', 'validation_status',
                            'validationStatus', 'trustScore', 'trust_score', 'impactScore', 'impact_score',
                            'pr_link', 'pr_url', 'issue_link', 'issue_url', 'summary',
                            'description', 'details', 'keywords', 'topic', 'action', 'status',
                            'notes', 'tags', 'auto_context', 'content', 'body', 'text', 'message',
                            'entry_id', 'id', 'project_number', 'session_id', 'entry',
                            'learned_context', 'learnedContext', 'group_name', 'groupName',
                            'lesson', 'learning', 'insight', 'rule', 'takeaway', 'knowledge',
                            'finding', 'discovery'
                        ]
                        const hasEntryFields = entryKeys.some((k) => entryObj[k] !== undefined || rawObj[k] !== undefined)
                        
                        const isNaturalLanguagePrompt = (text: string): boolean => {
                            const trimmed = text.trim()
                            if (!trimmed) return false
                            if (/\b(const|let|var|function|return|await|mj\.|import|export|\(\s*\)\s*=>)\b/.test(trimmed)) {
                                return false // Has JS keywords or mj.* calls
                            }
                            if (/^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(trimmed) || /^(?:\.schema|\.tables|\\d|\\dt)/i.test(trimmed)) {
                                return false // Handled by extractAndRecoverSqlCode
                            }
                            const naturalVerbPattern = /^(write|document|create|include|record|summary|log|add|added|please|here\s+is|this\s+is|note|task|fix|fixed|implement|implemented|refactor|refactored|update|updated|change|changed|feat|feature|bug|bugfix|chore|perf|test|tests|tested|docs|cleanup|resolved|resolve|remove|removed|hotfix|patch|replace|replaced|migrate|migrated|upgrade|upgraded|enhance|enhanced|improve|improved|delete|deleted|extract|extracted|prevent|prevented|handle|handled|verify|verified|configure|configured|switch|switched|align|aligned|adjust|adjusted|simplify|simplified|rewrite|rewrote|optimize|optimized|investigate|investigated|evaluate|evaluated|eliminate|eliminated|diagnose|diagnosed)\b/i
                            if (naturalVerbPattern.test(trimmed)) return true
                            if (/^\s*([*#-]\s*\*?|\d+\.\s|[A-Z][a-z0-9_-]+:)/m.test(trimmed)) return true
                            
                            const words = trimmed.split(/\s+/)
                            if (words.length >= 3 && !/[;{}=]/.test(trimmed)) {
                                return true
                            }
                            return false
                        }

                        if (hasEntryFields || isNaturalLanguagePrompt(executionCode)) {
                            const learnedVal = typeof entryObj['learned_context'] === 'string' && entryObj['learned_context'].trim().length > 0
                                ? entryObj['learned_context']
                                : typeof rawObj['learned_context'] === 'string' && rawObj['learned_context'].trim().length > 0
                                    ? rawObj['learned_context']
                                    : typeof entryObj['learnedContext'] === 'string' && entryObj['learnedContext'].trim().length > 0
                                        ? entryObj['learnedContext']
                                        : typeof rawObj['learnedContext'] === 'string' && rawObj['learnedContext'].trim().length > 0
                                            ? rawObj['learnedContext']
                                            : typeof entryObj['lesson'] === 'string' && entryObj['lesson'].trim().length > 0
                                                ? entryObj['lesson']
                                                : typeof rawObj['lesson'] === 'string' && rawObj['lesson'].trim().length > 0
                                                    ? rawObj['lesson']
                                                    : typeof entryObj['insight'] === 'string' && entryObj['insight'].trim().length > 0
                                                        ? entryObj['insight']
                                                        : typeof rawObj['insight'] === 'string' && rawObj['insight'].trim().length > 0
                                                            ? rawObj['insight']
                                                            : typeof entryObj['knowledge'] === 'string' && entryObj['knowledge'].trim().length > 0
                                                                ? entryObj['knowledge']
                                                                : typeof rawObj['knowledge'] === 'string' && rawObj['knowledge'].trim().length > 0
                                                                    ? rawObj['knowledge']
                                                                    : undefined

                            const groupNameVal = typeof entryObj['group_name'] === 'string' && entryObj['group_name'].trim().length > 0
                                ? entryObj['group_name']
                                : typeof rawObj['group_name'] === 'string' && rawObj['group_name'].trim().length > 0
                                    ? rawObj['group_name']
                                    : typeof entryObj['groupName'] === 'string' && entryObj['groupName'].trim().length > 0
                                        ? entryObj['groupName']
                                        : typeof rawObj['groupName'] === 'string' && rawObj['groupName'].trim().length > 0
                                            ? rawObj['groupName']
                                            : undefined

                            const rawContent = typeof entryObj['content'] === 'string' && entryObj['content'].trim().length > 0
                                ? entryObj['content']
                                : typeof rawObj['content'] === 'string' && rawObj['content'].trim().length > 0
                                    ? rawObj['content']
                                    : (typeof entryObj['body'] === 'string' && entryObj['body'].trim().length > 0
                                        ? entryObj['body']
                                        : (typeof rawObj['body'] === 'string' && rawObj['body'].trim().length > 0
                                            ? rawObj['body']
                                            : (learnedVal ?? executionCode)))

                            const titleVal = typeof entryObj['title'] === 'string' && entryObj['title'].trim().length > 0
                                ? entryObj['title']
                                : typeof rawObj['title'] === 'string' && rawObj['title'].trim().length > 0
                                    ? rawObj['title']
                                    : (typeof entryObj['summary'] === 'string' && entryObj['summary'].trim().length > 0
                                        ? entryObj['summary']
                                        : (typeof rawObj['summary'] === 'string' && rawObj['summary'].trim().length > 0
                                            ? rawObj['summary']
                                            : (groupNameVal !== undefined
                                                ? (groupNameVal.charAt(0).toUpperCase() + groupNameVal.slice(1))
                                                : (typeof entryObj['entry_id'] === 'string' && Number.isNaN(Number(entryObj['entry_id']))
                                                    ? entryObj['entry_id']
                                                    : (typeof rawObj['entry_id'] === 'string' && Number.isNaN(Number(rawObj['entry_id']))
                                                        ? rawObj['entry_id']
                                                        : (learnedVal !== undefined
                                                            ? 'Learned Context'
                                                            : (() => {
                                                                const firstLine = (executionCode.trim().split('\n')[0] ?? '').replace(/^(?:create|add|new|record|log|insert)?\s*entry\s*(?:for|:)?\s*/i, '').replace(/[:.]+$/, '').trim()
                                                                return (firstLine.length > 0 && firstLine.length < 80) ? firstLine : 'Journal Entry'
                                                            })()))))))

                            const typeVal = typeof entryObj['type'] === 'string'
                                ? entryObj['type']
                                : typeof entryObj['entry_type'] === 'string'
                                    ? entryObj['entry_type']
                                    : typeof entryObj['category'] === 'string'
                                        ? entryObj['category']
                                        : typeof rawObj['type'] === 'string'
                                            ? rawObj['type']
                                            : typeof rawObj['entry_type'] === 'string'
                                                ? rawObj['entry_type']
                                                : (learnedVal !== undefined ? 'personal_reflection' : 'technical_decision')

                            let tagsVal: string[] = Array.isArray(entryObj['tags'])
                                ? (entryObj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
                                : (Array.isArray(rawObj['tags'])
                                    ? (rawObj['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
                                    : [])
                            const topicVal = typeof entryObj['topic'] === 'string' ? entryObj['topic'] : typeof rawObj['topic'] === 'string' ? rawObj['topic'] : undefined
                            if (topicVal !== undefined && !tagsVal.includes(topicVal)) {
                                tagsVal = [...tagsVal, topicVal]
                            }
                            if (groupNameVal !== undefined && !tagsVal.includes(groupNameVal)) {
                                tagsVal = [...tagsVal, groupNameVal]
                            }
                            if (learnedVal !== undefined && !tagsVal.includes('learned-context') && !tagsVal.includes('learning')) {
                                tagsVal = [...tagsVal, 'learned-context']
                            }

                            const projVal = typeof entryObj['project_number'] === 'number'
                                ? entryObj['project_number']
                                : typeof rawObj['project_number'] === 'number'
                                    ? rawObj['project_number']
                                    : (typeof entryObj['project'] === 'number'
                                        ? entryObj['project']
                                        : typeof rawObj['project'] === 'number'
                                            ? rawObj['project']
                                            : undefined)

                            const sessVal = typeof entryObj['session_id'] === 'string'
                                ? entryObj['session_id']
                                : typeof rawObj['session_id'] === 'string'
                                    ? rawObj['session_id']
                                    : undefined

                            const rawTrust = entryObj['trust'] ?? rawObj['trust'] ?? entryObj['trust_score'] ?? rawObj['trust_score'] ?? entryObj['trustScore'] ?? rawObj['trustScore'] ?? entryObj['confidence'] ?? rawObj['confidence']
                            let trustVal: number | undefined = undefined
                            if (rawTrust !== undefined && rawTrust !== null) {
                                const n = Number(rawTrust)
                                if (!Number.isNaN(n)) {
                                    trustVal = n > 1 && n <= 10 ? n / 10 : Math.min(1, Math.max(0, n))
                                }
                            }

                            const rawImpact = entryObj['impact'] ?? rawObj['impact'] ?? entryObj['impact_score'] ?? rawObj['impact_score'] ?? entryObj['impactScore'] ?? rawObj['impactScore']
                            let impactVal: number | undefined = undefined
                            if (rawImpact !== undefined && rawImpact !== null) {
                                const n = Number(rawImpact)
                                if (!Number.isNaN(n)) {
                                    impactVal = n > 1 && n <= 10 ? n / 10 : Math.min(1, Math.max(0, n))
                                }
                            }

                            const rawValStatus = typeof entryObj['validation_status'] === 'string'
                                ? entryObj['validation_status']
                                : typeof rawObj['validation_status'] === 'string'
                                    ? rawObj['validation_status']
                                    : (typeof entryObj['validation'] === 'string'
                                        ? entryObj['validation']
                                        : typeof rawObj['validation'] === 'string'
                                            ? rawObj['validation']
                                            : (typeof entryObj['validationStatus'] === 'string'
                                                ? entryObj['validationStatus']
                                                : typeof rawObj['validationStatus'] === 'string'
                                                    ? rawObj['validationStatus']
                                                    : undefined))

                            let validVal: 'passed' | 'failed' | 'none' | undefined = undefined
                            if (rawValStatus !== undefined && rawValStatus !== null) {
                                const lower = rawValStatus.trim().toLowerCase()
                                if (['passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1'].includes(lower)) {
                                    validVal = 'passed'
                                } else if (['failed', 'fail', 'error', 'failing', 'false', '0'].includes(lower)) {
                                    validVal = 'failed'
                                } else {
                                    validVal = 'none'
                                }
                            }

                            const rawEntryId = entryObj['entry_id'] ?? rawObj['entry_id'] ?? entryObj['id'] ?? rawObj['id']
                            const numericEntryId = typeof rawEntryId === 'number' ? rawEntryId : (typeof rawEntryId === 'string' && !Number.isNaN(Number(rawEntryId)) ? Number(rawEntryId) : undefined)

                            // Build extra auto_context metadata if component / changes / pr_link / learned_context are present
                            const extraContext: Record<string, unknown> = {}
                            for (const k of ['component', 'changes', 'pr_link', 'pr_url', 'issue_link', 'issue_url', 'details', 'notes', 'learned_context', 'group_name']) {
                                if (entryObj[k] !== undefined) extraContext[k] = entryObj[k]
                                else if (rawObj[k] !== undefined) extraContext[k] = rawObj[k]
                            }

                            const payload: Record<string, unknown> = {
                                title: titleVal,
                                content: rawContent,
                                entry_type: typeVal,
                                tags: tagsVal
                            }
                            if (numericEntryId !== undefined) payload['entry_id'] = numericEntryId
                            if (projVal !== undefined) payload['project_number'] = projVal
                            if (sessVal !== undefined) payload['session_id'] = sessVal
                            if (trustVal !== undefined) payload['trust'] = trustVal
                            if (impactVal !== undefined) payload['impact'] = impactVal
                            if (validVal !== undefined) payload['validation_status'] = validVal
                            if (Object.keys(extraContext).length > 0) {
                                payload['auto_context'] = extraContext
                            }

                            const fnName = numericEntryId !== undefined ? 'mj.updateEntry' : 'mj.createEntry'
                            executionCode = `return await ${fnName}(${JSON.stringify(payload)});`
                        }
                    }

                    // 1. Configuration Validation
                    if (context.config?.codemodeEnabled !== true) {
                        throw new ConfigurationError('Code Mode is disabled in the server configuration.')
                    }

                    // 1a. Missing Payload Interceptor
                    if (!executionCode || executionCode.trim() === '') {
                        const inputContext = (input as Record<string, unknown>)['context']
                        const paramsContext = typeof params === 'object' && params !== null ? (params as Record<string, unknown>)['context'] : undefined
                        if (typeof inputContext === 'string' && inputContext.trim().length > 0) {
                            executionCode = inputContext
                        } else if (typeof paramsContext === 'string' && paramsContext.trim().length > 0) {
                            executionCode = paramsContext
                        } else if (typeof inputContext === 'object' && inputContext !== null) {
                            const ctxObj = inputContext as Record<string, unknown>
                            if (typeof ctxObj['code'] === 'string' && ctxObj['code'].trim().length > 0) {
                                executionCode = ctxObj['code']
                            } else if (typeof ctxObj['script'] === 'string' && ctxObj['script'].trim().length > 0) {
                                executionCode = ctxObj['script']
                            } else if (typeof ctxObj['query'] === 'string' && ctxObj['query'].trim().length > 0) {
                                executionCode = `return await mj.searchEntries(${JSON.stringify({ query: ctxObj['query'] })});`
                            } else if (typeof ctxObj['content'] === 'string' || typeof ctxObj['instructions'] === 'string') {
                                const titleVal = typeof ctxObj['title'] === 'string' ? ctxObj['title'] : 'Journal Entry'
                                const contentVal = typeof ctxObj['content'] === 'string' ? ctxObj['content'] : ctxObj['instructions']
                                const typeVal = typeof ctxObj['type'] === 'string' ? ctxObj['type'] : 'technical_decision'
                                executionCode = `return await mj.createEntry(${JSON.stringify({ title: titleVal, content: contentVal, entry_type: typeVal })});`
                            }
                        } else if (typeof paramsContext === 'object' && paramsContext !== null) {
                            const ctxObj = paramsContext as Record<string, unknown>
                            if (typeof ctxObj['code'] === 'string' && ctxObj['code'].trim().length > 0) {
                                executionCode = ctxObj['code']
                            } else if (typeof ctxObj['script'] === 'string' && ctxObj['script'].trim().length > 0) {
                                executionCode = ctxObj['script']
                            } else if (typeof ctxObj['query'] === 'string' && ctxObj['query'].trim().length > 0) {
                                executionCode = `return await mj.searchEntries(${JSON.stringify({ query: ctxObj['query'] })});`
                            } else if (typeof ctxObj['content'] === 'string' || typeof ctxObj['instructions'] === 'string') {
                                const titleVal = typeof ctxObj['title'] === 'string' ? ctxObj['title'] : 'Journal Entry'
                                const contentVal = typeof ctxObj['content'] === 'string' ? ctxObj['content'] : ctxObj['instructions']
                                const typeVal = typeof ctxObj['type'] === 'string' ? ctxObj['type'] : 'technical_decision'
                                executionCode = `return await mj.createEntry(${JSON.stringify({ title: titleVal, content: contentVal, entry_type: typeVal })});`
                            }
                        }

                        // Auto-heal empty code payload (e.g. mj_execute_code({}), mj_execute_code({ auto_version: true }))
                        if (!executionCode || executionCode.trim() === '') {
                            return {
                                success: true,
                                result: {
                                    status: 'active',
                                    message: 'Code Mode sandbox is active. Provide JavaScript code in the `code` parameter to execute.',
                                    availableNamespaces: [
                                        'mj.core',
                                        'mj.search',
                                        'mj.admin',
                                        'mj.analytics',
                                        'mj.relationships',
                                        'mj.io',
                                        'mj.git',
                                        'mj.team',
                                        'mj.backup',
                                        'mj.staleness'
                                    ],
                                    example: 'return await mj.searchEntries({ query: "example" })',
                                    discovery: 'Use mj.help() or return await mj.core.searchEntries.schema() to inspect parameters.'
                                },
                                _healing_note: '🛠️ AUTONOMOUS HEALING: `mj_execute_code` was called without a `code` parameter or with an empty payload. Returned active sandbox status, available namespaces, and execution examples.',
                                project_id: undefined,
                                executionTimeMs: Math.round(performance.now() - start)
                            }
                        }
                    }

                    // 1b. Security Validation
                    const validation = securityManager.validateCode(executionCode)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join(', ')}`,
                            project_id: undefined,
                            executionTimeMs: 0
                        }
                    }

                    // 1b. Rate Limiting
                    const clientId = context.auth?.sub ?? context.auth?.subject ?? 'default'
                    if (!securityManager.checkRateLimit(clientId)) {
                        return {
                            success: false,
                            error: 'Rate limit exceeded: Maximum code executions per minute reached.',
                            project_id: undefined,
                            executionTimeMs: 0
                        }
                    }

                    // 2. Project Injection Check
                    // If no explicit project is provided, check request context
                    let projectId = input.project_number
                    if (projectId === undefined || projectId === null) {
                        if (context.config?.defaultProjectNumber !== undefined) {
                            projectId = context.config.defaultProjectNumber
                        } else if (context.config?.projectRegistry) {
                            const cwd = path.resolve(process.cwd()).toLowerCase()
                            for (const entry of Object.values(context.config.projectRegistry)) {
                                if (entry.path && path.resolve(entry.path).toLowerCase() === cwd && entry.project_number !== undefined) {
                                    projectId = entry.project_number
                                    break
                                }
                            }
                        }
                    }

                    const numericProjectId = typeof projectId === 'number' ? projectId : undefined
                    const workspaceId = resolveWorkspaceId(input.workspace_id, numericProjectId, context.config)

                    let sessionContext = context

                    // Context injection for GitHub / Kanban routing
                    const repo = input.repo
                    if (repo) {
                        if (!context.config?.codemodeInternalFullAccess) {
                            return {
                                success: false,
                                error: 'Repo switching is restricted to internal administrative access.',
                                project_id: undefined,
                                executionTimeMs: 0
                            }
                        }
                        if (context.config?.projectRegistry) {
                            let registryEntry = context.config.projectRegistry[repo]
                            if (!registryEntry && repo.includes('/')) {
                                const repoName = repo.split('/').pop()
                                if (repoName) {
                                    registryEntry = context.config.projectRegistry[repoName]
                                }
                            }

                            if (registryEntry) {
                                let injectedGithub
                                try {
                                    injectedGithub = getGitHubIntegration(
                                        registryEntry.path,
                                        undefined,
                                        process.env['GITHUB_TOKEN']
                                    )
                                    // Pre-populate cache so synchronous tools (like create_entry) can resolve Issue URLs
                                    await injectedGithub.getRepoInfo()
                                } catch (error) {
                                    return {
                                        success: false,
                                        error: `Failed to initialize injected repository '${repo}': ${error instanceof Error ? error.message : String(error)}`,
                                        project_id: undefined,
                                        executionTimeMs: 0
                                    }
                                }
                                sessionContext = {
                                    ...context,
                                    github: injectedGithub,
                                }
                            }
                        }
                    }

                    // Resolve string projectId at the outer level so:
                    // (a) auto-injection into tool calls always uses numeric values
                    // (b) the response project_id field is numeric
                    if (typeof projectId === 'string' && sessionContext.config?.projectRegistry) {
                        let entry = sessionContext.config.projectRegistry[projectId]
                        if (!entry && projectId.includes('/')) {
                            const repoName = projectId.split('/').pop()
                            if (repoName) {
                                entry = sessionContext.config.projectRegistry[repoName] ?? undefined
                            }
                        }
                        if (entry?.project_number !== undefined) {
                            projectId = entry.project_number
                        }
                    }
                    // Numeric string coercion for outer projectId: "14" -> 14
                    if (typeof projectId === 'string') {
                        const parsed = Number(projectId)
                        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
                            projectId = parsed
                        }
                    }

                    // Dynamically inject Git and GitHub context for the resolved project
                    if (projectId !== undefined && sessionContext.config?.projectRegistry) {
                        const registryEntry = Object.values(sessionContext.config.projectRegistry).find(
                            (r) => r.project_number === projectId
                        )
                        if (registryEntry?.path) {
                            try {
                                const injectedGithub = getGitHubIntegration(
                                    registryEntry.path,
                                    undefined,
                                    process.env['GITHUB_TOKEN']
                                )
                                sessionContext = {
                                    ...sessionContext,
                                    github: injectedGithub
                                }
                            } catch {
                                // Ignore injection failures; tools will fallback to global context or throw
                            }
                        }
                    }

                    // 2. Fetch all tools and cache them
                    let tools = collectNonCodeModeTools(sessionContext)

                    // 2b. Enforce Readonly Mode
                    // If the sandbox is explicitly requested as readonly, OR the server itself is in readonly mode
                    // and the user didn't explicitly override it with readonly: false, filter out mutating tools.
                    let isGlobalReadonly = false;
                    if (context.config?.filterConfig?.raw) {
                        const rawFilter = context.config.filterConfig.raw;
                        // Determine if server is explicitly configured with a readonly filter.
                        // We check for the 'readonly' meta-group explicitly, rather than checking if 
                        // create_entry is missing, because '--tool-filter codemode' strips create_entry 
                        // from the top-level but shouldn't inherently force codemode into readonly mode.
                        if (rawFilter.includes('readonly') && !rawFilter.includes('-readonly')) {
                            isGlobalReadonly = true;
                        }
                    }
                    const isSandboxReadonly = input.readonly ?? isGlobalReadonly;

                    if (isSandboxReadonly) {
                        tools = tools.filter((t) => t.annotations?.readOnlyHint === true)
                    }

                    // 3. Create the secure dispatcher wrapper around tool handlers
                    const secureDispatcher = async (
                        toolName: string,
                        toolParams: unknown,
                        isSimulation?: boolean
                    ): Promise<unknown> => {
                        const tool = tools.find((t) => t.name === toolName)
                        if (!tool) {
                            throw new Error(`[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`)
                        }

                        let finalParams = toolParams

                        // Helper to deep convert camelCase to snake_case for top-level code mode payloads
                        const deepCamelToSnake = (obj: unknown): unknown => {
                            if (Array.isArray(obj)) return obj.map(deepCamelToSnake)
                            if (obj !== null && typeof obj === 'object') {
                                const newObj: Record<string, unknown> = {}
                                for (const [k, v] of Object.entries(obj)) {
                                    const snakeKey = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
                                    if (snakeKey === 'id' && !('entry_id' in obj)) {
                                        newObj['entry_id'] = deepCamelToSnake(v)
                                        continue
                                    }
                                    if (snakeKey === 'ids' && !('entry_ids' in obj)) {
                                        const vSnake = deepCamelToSnake(v);
                                        newObj['entry_ids'] = Array.isArray(vSnake) ? vSnake : [vSnake];
                                        continue
                                    }
                                    newObj[snakeKey] = deepCamelToSnake(v)
                                }
                                return newObj
                            }
                            return obj
                        }
                        
                        // Apply deep camelCase normalization to prevent basic hallucinations (e.g. projectNumber -> project_number)
                        finalParams = deepCamelToSnake(finalParams)

                        // Inject and resolve project_number for ALL tools (not just team operations)
                        if (typeof finalParams === 'object' && finalParams !== null) {
                            const paramsObj = { ...(finalParams as Record<string, unknown>) }
                            
                            // Auto-inject project_number if not present but available from context
                            // ONLY inject if the tool actually expects a project_number (inspect Zod schema)
                            interface ZodLike {
                                shape?: Record<string, unknown>;
                                _def?: {
                                    typeName?: string;
                                    type?: string;
                                    schema?: ZodLike;
                                    in?: ZodLike;
                                    out?: ZodLike;
                                    left?: ZodLike;
                                    right?: ZodLike;
                                };
                                innerType?: () => ZodLike;
                            }

                            const checkSchemaAcceptsKey = (schema: unknown, key: string): boolean => {
                                if (schema === null || schema === undefined || typeof schema !== 'object') return false;
                                
                                // Support standard JSON Schema format (MCP Tool schemas)
                                if ('properties' in schema && schema.properties !== null && typeof schema.properties === 'object') {
                                    if (key in (schema.properties as Record<string, unknown>)) return true;
                                }
                                
                                const s = schema as ZodLike;
                                
                                if (s.shape !== undefined && s.shape !== null && typeof s.shape === 'object' && key in s.shape) return true;
                                
                                if (s._def !== undefined && s._def !== null) {
                                    const typeName = s._def.typeName ?? s._def.type;
                                    
                                    if ((typeName === 'ZodObject' || typeName === 'object') && s.shape !== undefined && s.shape !== null) {
                                        return key in s.shape;
                                    }
                                    if (typeName === 'ZodEffects' || typeName === 'pipe' || typeName === 'ZodOptional' || typeName === 'optional' || typeName === 'ZodNullable' || typeName === 'nullable') {
                                        return checkSchemaAcceptsKey(s._def.schema ?? s._def.out ?? s._def.in ?? s.innerType?.(), key);
                                    }
                                    if (typeName === 'ZodIntersection' || typeName === 'intersection') {
                                        return checkSchemaAcceptsKey(s._def.left, key) || checkSchemaAcceptsKey(s._def.right, key);
                                    }
                                    if (typeName === 'ZodPipeline' || (s._def.out !== undefined && s._def.out !== null)) {
                                        return checkSchemaAcceptsKey(s._def.out, key);
                                    }
                                    if (s._def.schema) {
                                        return checkSchemaAcceptsKey(s._def.schema, key);
                                    }
                                }
                                return false;
                            };
                            const acceptsProjectNumber = checkSchemaAcceptsKey(tool.inputSchema, 'project_number');
                            if (paramsObj['project_number'] === undefined && projectId !== undefined && acceptsProjectNumber) {
                                paramsObj['project_number'] = projectId
                            }

                            // Dispatcher Healing: map 'workspace' to 'workspace_id'
                            if (paramsObj['workspace'] !== undefined && paramsObj['workspace_id'] === undefined) {
                                paramsObj['workspace_id'] = paramsObj['workspace']
                            }
                            // Gracefully cast numeric workspace_id to string
                            if (typeof paramsObj['workspace_id'] === 'number') {
                                paramsObj['workspace_id'] = String(paramsObj['workspace_id'])
                            }

                            const acceptsWorkspaceId = checkSchemaAcceptsKey(tool.inputSchema, 'workspace_id');
                            if (paramsObj['workspace_id'] === undefined && workspaceId !== undefined && acceptsWorkspaceId) {
                                paramsObj['workspace_id'] = workspaceId
                            }

                            // Auto-inject issue_url if issue_number is present and we have GitHub context
                            if (
                                paramsObj['issue_number'] !== undefined && 
                                paramsObj['issue_url'] === undefined && 
                                sessionContext.github
                            ) {
                                try {
                                    const repoInfo = await sessionContext.github.getRepoInfo()
                                    if (repoInfo?.owner && repoInfo?.repo) {
                                        paramsObj['issue_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${String(Number(paramsObj['issue_number']))}`
                                    }
                                } catch {
                                    // Ignore errors and proceed without issue_url
                                }
                            }

                            // Auto-inject pr_url if pr_number is present and we have GitHub context
                            if (
                                paramsObj['pr_number'] !== undefined && 
                                paramsObj['pr_url'] === undefined && 
                                sessionContext.github
                            ) {
                                try {
                                    const repoInfo = await sessionContext.github.getRepoInfo()
                                    if (repoInfo?.owner && repoInfo?.repo) {
                                        paramsObj['pr_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${String(Number(paramsObj['pr_number']))}`
                                    }
                                } catch {
                                    // Ignore errors and proceed without pr_url
                                }
                            }                          
                            
                            // Try string -> number resolution if registry is available
                            if (
                                typeof paramsObj['project_number'] === 'string' && 
                                sessionContext.config?.projectRegistry
                            ) {
                                // 1. Check if the string matches an explicit registry key -> numeric ID
                                const strVal = paramsObj['project_number']
                                const entry = sessionContext.config.projectRegistry[strVal]
                                if (entry?.project_number !== undefined) {
                                    paramsObj['project_number'] = entry.project_number
                                } else {
                                    // 2. Attempt 'owner/repo' splitting heuristic if no exact match
                                    if (strVal.includes('/')) {
                                        const repoName = strVal.split('/').pop()
                                        if (repoName) {
                                            const splitEntry = sessionContext.config.projectRegistry[repoName]
                                            if (splitEntry?.project_number !== undefined) {
                                                paramsObj['project_number'] = splitEntry.project_number
                                            }
                                        }
                                    }
                                }
                            }

                            // Numeric string coercion: "14" -> 14
                            if (typeof paramsObj['project_number'] === 'string') {
                                const parsed = Number(paramsObj['project_number'])
                                if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
                                    paramsObj['project_number'] = parsed
                                } else {
                                    return {
                                        success: false,
                                        error: `Invalid project_number: '${paramsObj['project_number']}'. Code Mode failed to resolve this to a known numeric ID. You can pass the exact numeric ID (e.g. 14), the repo name (e.g. 'mysql-mcp'), or simply OMIT the project_number field entirely to let the system auto-inject the current workspace's ID.`
                                    }
                                }
                            }

                            finalParams = paramsObj
                        }

                        // Expected Version Injection
                        if (
                            input.auto_version && 
                            VERSION_AWARE_TOOL_NAMES.has(toolName) &&
                            typeof finalParams === 'object' && 
                            finalParams !== null
                        ) {
                            const paramsObj = { ...(finalParams as Record<string, unknown>) }
                            // Only inject if they didn't explicitly provide it
                            if (paramsObj['expected_version'] === undefined && typeof paramsObj['entry_id'] === 'number') {
                                const entryId = paramsObj['entry_id'];
                                const existingEntry = sessionContext.teamDb?.getEntryById(entryId) ?? sessionContext.db.getEntryById(entryId);
                                if (existingEntry && typeof existingEntry === 'object' && 'version' in existingEntry) {
                                    paramsObj['expected_version'] = existingEntry.version;
                                }
                            }
                            finalParams = paramsObj
                        }

                        // Mutation protection (after normalization so simulated responses show resolved params)
                        if (tool.annotations?.readOnlyHint === false && input.dry_run) {
                            return {
                                success: true,
                                dry_run: true,
                                message: `Simulated successful execution of ${toolName}`,
                                simulatedParams: finalParams,
                            }
                        }

                        // Optional Simulation Phase (e.g. for optimistic updates)
                        if (isSimulation && tool.annotations?.readOnlyHint === false) {
                            return {
                                success: true,
                                simulated: true,
                                params: finalParams,
                            }
                        }

                        // Execute the underlying handler directly
                        const result = await tool.handler(finalParams)
                        injectProjectNames(result, sessionContext.config?.projectRegistry)
                        return result
                    }

                    // Prepare api bindings using the unified JournalApi factory
                    const { createJournalApi } = await import('../../../codemode/api/journal-api.js')
                    const journalApi = createJournalApi(tools, secureDispatcher)
                    const apiBindings = journalApi.createSandboxBindings(sessionContext.progress)
                    const schemas = journalApi.createSandboxSchemas()

                    // 4. Execute Code in Sandbox Worker
                    const pool = getSandboxPool()
                    
                    // Prepare sandbox payload
                    let userContext: Record<string, unknown> = {}
                    if (input.context !== undefined && input.context !== null) {
                        if (typeof input.context === 'object' && !Array.isArray(input.context)) {
                            userContext = input.context as Record<string, unknown>
                        } else if (typeof input.context === 'string') {
                            const trimmed = input.context.trim()
                            if (
                                (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                                (trimmed.startsWith('[') && trimmed.endsWith(']'))
                            ) {
                                try {
                                    const parsed: unknown = JSON.parse(trimmed)
                                    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                                        userContext = parsed as Record<string, unknown>
                                    } else {
                                        userContext = { value: parsed, raw: input.context, text: input.context, content: input.context }
                                    }
                                } catch {
                                    userContext = { content: input.context, text: input.context, raw: input.context }
                                }
                            } else {
                                userContext = { content: input.context, text: input.context, raw: input.context }
                            }
                        } else {
                            userContext = { value: input.context, raw: input.context }
                        }
                    }
                    
                    // IMPORTANT: The worker relies on capturing the AuthContext from AsyncLocalStorage.
                    // We must run the execution wrapped in the current context so the worker thread
                    // can read the identical context values via getAuthContext().
                    // (Assuming our pool implementation forwards ALS correctly via node:worker_threads)
                    let execResult: SandboxResult | undefined
                    
                    // Re-wrap in auth and request context to ensure propagation into the pool
                    const authCtx = getAuthContext()
                    const reqCtx = getRequestContext()
                    
                    const runSandbox = async (codeToRun: string): Promise<void> => {
                        if (authCtx) {
                            await runWithAuthContext(authCtx, async () => {
                                execResult = await pool.execute(
                                    codeToRun,
                                    apiBindings,
                                    schemas,
                                    input.timeout ?? input.timeout_ms,
                                    userContext,
                                    input.dry_run
                                )
                            })
                        } else {
                            execResult = await pool.execute(
                                codeToRun,
                                apiBindings,
                                schemas,
                                input.timeout ?? input.timeout_ms,
                                userContext,
                                input.dry_run
                            )
                        }
                    }

                    await requestContextStorage.run(reqCtx ?? {}, async () => {
                        await runSandbox(executionCode ?? '')

                        // Autonomous Recovery Retry: If execution failed due to syntax error or TypeError (e.g. tagged template tag or unescaped backtick)
                        if (execResult && !execResult.success && typeof execResult.error === 'string') {
                            const errLower = execResult.error.toLowerCase()
                            if (
                                errLower.includes('syntax error') ||
                                errLower.includes('is not a function') ||
                                errLower.includes('unexpected token') ||
                                errLower.includes('unexpected identifier') ||
                                errLower.includes('missing ) after argument list') ||
                                errLower.includes('is not valid json') ||
                                errLower.includes('[object object]')
                            ) {
                                const originalInput = typeof input.code === 'string' ? input.code : (executionCode ?? '')
                                const recoveredCode = extractAndRecoverSqlCode(originalInput) ?? extractAndRecoverEntryCode(originalInput)
                                if (recoveredCode && recoveredCode !== executionCode) {
                                    logger.info('CODEMODE_AUTONOMOUS_RECOVERY', { originalError: execResult.error, recoveredCode })
                                    await runSandbox(recoveredCode)
                                }
                            }
                        }
                    })
                    
                    const executionTime = performance.now() - start

                    // 5. Format and return results
                    return {
                        success: Boolean(execResult?.success),
                        executionTimeMs: Math.round(executionTime * 100) / 100,
                        result: execResult?.result,
                        error: execResult?.error,
                        metrics: execResult?.metrics,
                        simulated: input.dry_run ? true : undefined,
                        project_id: projectId,
                    }
                } catch (err) {
                    logger.error('CODEMODE_HANDLER_ERROR', { error: err })
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
