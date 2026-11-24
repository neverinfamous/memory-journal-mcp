/**
 * memory-journal-mcp - Code Mode API Interceptions for Git Tools
 */

import { isRecord } from '../../utils/type-guards.js'

function remapGitParamAliases(methodName: string, obj: Record<string, unknown>): void {
    const isSearchCommits = methodName === 'search_commits' || methodName === 'searchCommits'
    for (const key of ['text', 'message', 'description', 'q', 'search']) {
        if (isSearchCommits && obj[key] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj[key]
            Reflect.deleteProperty(obj, key)
        }
    }
    const remaps: readonly [string, string][] = [
        ['keep', 'maxCount'],
        ['limit', 'maxCount'],
        ['max_count', 'maxCount'],
        ['tech_debt_audit', 'techDebtAudit'],
        ['sort_by', 'sortBy'],
        ['repo_name', 'repo'],
        ['repository', 'repo'],
        ['workspace', 'workspace_id'],
    ]
    for (const [src, dst] of remaps) {
        if (obj[src] !== undefined && obj[dst] === undefined) {
            obj[dst] = obj[src]
            Reflect.deleteProperty(obj, src)
        }
    }
}

const GIT_METHODS: ReadonlySet<string> = new Set([
    'get_commit_history',
    'getCommitHistory',
    'search_commits',
    'searchCommits',
    'get_release_info',
    'getReleaseInfo',
    'get_unreleased_commits',
    'getUnreleasedCommits',
    'analyze_commit_patterns',
    'analyzeCommitPatterns',
])

export function applyGitInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } | null {
    const firstArg = args[0]
    if (GIT_METHODS.has(methodName) && args.length === 1 && isRecord(firstArg)) {
        const obj: Record<string, unknown> = { ...firstArg }
        args[0] = obj
        remapGitParamAliases(methodName, obj)

        // Q/Query error interception for non-search tools
        if (
            methodName !== 'search_commits' &&
            methodName !== 'searchCommits' &&
            (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined)
        ) {
            return {
                error: {
                    success: false,
                    error: `${methodName} does not support search queries (q/query/search). It only retrieves history or analysis.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove the query parameter, or use search_commits for text search.',
                    recoverable: true,
                },
            }
        }

        return { args: [obj] }
    }

    return null
}
