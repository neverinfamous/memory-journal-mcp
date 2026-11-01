/**
 * SQL and prepared statement recovery helpers for Code Mode execution payloads.
 */

import * as vm from 'node:vm'
import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { extractAndRecoverEntryCode } from './json-entry-recovery.js'

/**
 * Auto-heals raw SQL queries passed as code or script in Code Mode,
 * translating them to corresponding type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverSqlCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const trimmed = code.trim()

    if (/\b(?:const|let|var|function|return|await|mj\.|import|export|\(\s*\)\s*=>)\b/.test(trimmed)) {
        return null
    }

    const cleanSql = trimmed
        .replace(/^--[^\n]*\n/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()

    const isSql =
        /^(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|SHOW|DESCRIBE|EXPLAIN|WITH|SCHEMA|TABLES)\b/i.test(cleanSql) ||
        /^(?:\.schema|\.tables|\\d|\\dt)/i.test(cleanSql)
    if (!isSql) return null

    if (
        /^(?:PRAGMA|SHOW|DESCRIBE|EXPLAIN|SCHEMA|TABLES)\b/i.test(cleanSql) ||
        /^(?:\.schema|\.tables|\\d|\\dt)/i.test(cleanSql)
    ) {
        return `return await mj.analytics.getStatistics({});`
    }

    const fromMatch = /\bFROM\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i.exec(cleanSql)
    const tableName = fromMatch?.[1]?.toLowerCase()

    const limitMatch = /\bLIMIT\s+(\d+)/i.exec(cleanSql)
    const limitVal = limitMatch?.[1] !== undefined ? parseInt(limitMatch[1], 10) : undefined

    const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(\d+)/i.exec(cleanSql)
    const idVal = idMatch?.[1] !== undefined ? parseInt(idMatch[1], 10) : undefined

    const likeMatch = /\bWHERE\s+[`"']?(?:[a-zA-Z0-9_]+)[`"']?\s+(?:LIKE|ILIKE|=)\s*['"]%?([^%'"]+)%?['"]/i.exec(cleanSql)
    const searchQuery = likeMatch?.[1]

    const isCount = /\bCOUNT\s*\(/i.test(cleanSql)

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

    if (/^SELECT\b/i.test(cleanSql)) {
        if (isCount) {
            return `return await mj.analytics.getStatistics({});`
        }
        if (idVal !== undefined) {
            return `return await mj.core.getEntryById({ entry_id: ${idVal} });`
        }
        if (searchQuery !== undefined && searchQuery !== '') {
            const searchParams: Record<string, unknown> = { query: searchQuery }
            if (limitVal !== undefined) searchParams['limit'] = limitVal
            return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
        }
        const projectMatch = /\bWHERE\s+[`"']?(?:project_number|project_id)[`"']?\s*=\s*(\d+)/i.exec(cleanSql)
        const projectVal = projectMatch?.[1] !== undefined ? parseInt(projectMatch[1], 10) : undefined

        const typeMatch = /\bWHERE\s+[`"']?(?:type|entry_type)[`"']?\s*=\s*['"]([^'"]+)['"]/i.exec(cleanSql)
        const typeVal = typeMatch?.[1]

        const params: Record<string, unknown> = {
            limit: limitVal ?? 10,
        }
        if (projectVal !== undefined) params['project_number'] = projectVal
        if (typeVal !== undefined) params['entry_type'] = typeVal

        return `return await mj.core.getRecentEntries(${JSON.stringify(params)});`
    }

    if (/^INSERT\s+INTO\b/i.test(cleanSql)) {
        const rec = extractAndRecoverEntryCode(cleanSql)
        if (rec !== null) return rec
        return `return await mj.createEntry({ content: ${JSON.stringify(cleanSql)} });`
    }

    if (/^UPDATE\b/i.test(cleanSql)) {
        if (idVal !== undefined) {
            const updatePayload: Record<string, unknown> = { entry_id: idVal }
            const setContentMatch = /\bSET\s+[\s\S]*?\bcontent\s*=\s*(['"])([\s\S]*?)\1/i.exec(cleanSql)
            if (setContentMatch?.[2] !== undefined) {
                updatePayload['content'] = setContentMatch[2]
            }
            return `return await mj.admin.updateEntry(${JSON.stringify(updatePayload)});`
        }
    }

    if (/^DELETE\s+FROM\b/i.test(cleanSql)) {
        if (idVal !== undefined) {
            return `return await mj.core.deleteEntry({ entry_id: ${idVal} });`
        }
    }

    return `return await mj.core.getRecentEntries({ limit: ${limitVal ?? 10} });`
}

function parsePreparedStatementArgs(rawArgs: string): unknown[] {
    // 1. Try safe JSON.parse first
    try {
        const parsed: unknown = JSON.parse(`[${rawArgs}]`)
        if (Array.isArray(parsed)) return parsed
    } catch {
        // Fallback to guarded VM or token splitter
    }

    // 2. Guarded VM evaluation for single-quoted strings or literals (Critical C-2 fix)
    if (!/[(){};=]/.test(rawArgs)) {
        try {
            const evaluated: unknown = vm.runInNewContext(
                `[${rawArgs}]`,
                {},
                { timeout: 50, microtaskMode: 'afterEvaluate' }
            )
            if (Array.isArray(evaluated)) return evaluated
        } catch {
            // Fall through to token splitting
        }
    }

    // 3. Token splitting fallback (supports JSON.stringify(...) tokens safely via JSON.parse)
    const tokens = rawArgs.split(/,\s*(?=(?:[^"']*["'][^"']*["'])*[^"']*$)/)
    return tokens.map((t) => {
        const trimmedToken = t.trim()
        if (/^\d+$/.test(trimmedToken)) return parseInt(trimmedToken, 10)
        if (trimmedToken.startsWith('"') && trimmedToken.endsWith('"')) return trimmedToken.slice(1, -1)
        if (trimmedToken.startsWith("'") && trimmedToken.endsWith("'")) return trimmedToken.slice(1, -1)
        if (trimmedToken.startsWith('JSON.stringify(') && trimmedToken.endsWith(')')) {
            try {
                const inner = trimmedToken.slice(15, -1)
                const parsed: unknown = JSON.parse(inner)
                return parsed
            } catch {
                return trimmedToken
            }
        }
        return trimmedToken
    })
}

/**
 * Auto-heals prepared statement execution patterns (db.prepare(...).run(...), stmt.run(...))
 * into corresponding canonical mj.* API calls.
 */
export function extractAndRecoverPreparedStatementCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    if (!code.includes('.prepare(')) return null

    const prepMatch = /\.prepare\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(code)
    if (prepMatch?.[2] === undefined) return null
    const rawSql = prepMatch[2].trim()

    const runMatch = /\.(?:run|get|all)\s*\(([\s\S]*?)\)(?:\s*;|\s*\n|$)/.exec(code)
    let parsedArgs: unknown[] = []
    if (runMatch?.[1] !== undefined) {
        const rawArgs = runMatch[1].trim()
        if (rawArgs.length > 0) {
            parsedArgs = parsePreparedStatementArgs(rawArgs)
        }
    }

    const cleanSql = rawSql.replace(/^--[^\n]*\n/gm, '').trim()
    const isUpdate = /^UPDATE\b/i.test(cleanSql)
    const isInsert = /^INSERT\b/i.test(cleanSql)
    const isDelete = /^DELETE\b/i.test(cleanSql)
    const isSelect = /^SELECT\b/i.test(cleanSql)

    if (isUpdate) {
        const payload: Record<string, unknown> = {}
        const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i.exec(cleanSql)
        if (idMatch?.[1] !== undefined) {
            payload['entry_id'] = parseInt(idMatch[1], 10)
        }

        for (const arg of parsedArgs) {
            if (typeof arg === 'number') {
                payload['entry_id'] = arg
            } else if (typeof arg === 'string') {
                let isTags = false
                if (arg.trim().startsWith('[') && arg.trim().endsWith(']')) {
                    try {
                        const parsed: unknown = JSON.parse(arg)
                        if (Array.isArray(parsed)) {
                            payload['tags'] = parsed.map(String)
                            isTags = true
                        }
                    } catch {
                        // ignore
                    }
                }
                if (!isTags) {
                    if (payload['content'] === undefined) payload['content'] = arg
                    else if (payload['title'] === undefined) payload['title'] = arg
                }
            } else if (Array.isArray(arg)) {
                payload['tags'] = arg.map(String)
            } else if (isRecord(arg)) {
                if (typeof arg['entry_id'] === 'number') payload['entry_id'] = arg['entry_id']
                if (typeof arg['id'] === 'number') payload['entry_id'] = arg['id']
                if (typeof arg['content'] === 'string') payload['content'] = arg['content']
                if (Array.isArray(arg['tags'])) payload['tags'] = arg['tags'].map(String)
            }
        }

        if (payload['content'] === undefined) {
            const setContentMatch = /\bSET\s+[\s\S]*?\bcontent\s*=\s*['"]([\s\S]*?)['"]/i.exec(cleanSql)
            if (setContentMatch?.[1] !== undefined) {
                payload['content'] = setContentMatch[1]
            }
        }

        if (payload['entry_id'] !== undefined) {
            return `return await mj.admin.updateEntry(${JSON.stringify(payload)});`
        }
    }

    if (isInsert) {
        const payload: Record<string, unknown> = {
            entry_type: 'technical_decision',
        }
        for (const arg of parsedArgs) {
            if (typeof arg === 'string') {
                let isTags = false
                if (arg.trim().startsWith('[') && arg.trim().endsWith(']')) {
                    try {
                        const parsed: unknown = JSON.parse(arg)
                        if (Array.isArray(parsed)) {
                            payload['tags'] = parsed.map(String)
                            isTags = true
                        }
                    } catch {
                        // ignore
                    }
                }
                if (!isTags) {
                    if (typeof payload['content'] !== 'string') payload['content'] = arg
                    else if (typeof payload['title'] !== 'string') payload['title'] = arg
                }
            } else if (Array.isArray(arg)) {
                payload['tags'] = arg.map(String)
            } else if (isRecord(arg)) {
                if (typeof arg['content'] === 'string') payload['content'] = arg['content']
                if (typeof arg['title'] === 'string') payload['title'] = arg['title']
                if (Array.isArray(arg['tags'])) payload['tags'] = arg['tags'].map(String)
            }
        }
        if (typeof payload['title'] !== 'string') payload['title'] = 'Journal Entry'
        return `return await mj.core.createEntry(${JSON.stringify(payload)});`
    }

    if (isDelete) {
        let entryId: number | undefined
        const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i.exec(cleanSql)
        if (idMatch?.[1] !== undefined) entryId = parseInt(idMatch[1], 10)
        for (const arg of parsedArgs) {
            if (typeof arg === 'number') entryId = arg
        }
        if (entryId !== undefined) {
            return `return await mj.admin.deleteEntry({ entry_id: ${entryId} });`
        }
    }

    if (isSelect) {
        let entryId: number | undefined
        const idMatch = /\bWHERE\s+[`"']?(?:id|entry_id)[`"']?\s*=\s*(?:\?|(\d+))/i.exec(cleanSql)
        if (idMatch?.[1] !== undefined) entryId = parseInt(idMatch[1], 10)
        for (const arg of parsedArgs) {
            if (typeof arg === 'number') entryId = arg
        }
        if (entryId !== undefined) {
            return `return await mj.core.getEntryById({ entry_id: ${entryId} });`
        }
        return `return await mj.core.getRecentEntries({ limit: 10 });`
    }

    return null
}
