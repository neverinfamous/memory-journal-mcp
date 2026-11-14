/**
 * memory-journal-mcp - Code Mode API Interceptions for Git Tools
 */

export function applyGitInterceptions(methodName: string, args: unknown[]): { args: unknown[] } | { error: Record<string, unknown> } | null {
    const gitMethods = [
        'get_commit_history', 'getCommitHistory',
        'search_commits', 'searchCommits',
        'get_release_info', 'getReleaseInfo',
        'get_unreleased_commits', 'getUnreleasedCommits',
        'analyze_commit_patterns', 'analyzeCommitPatterns'
    ];
    
    if (gitMethods.includes(methodName) && args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const obj = args[0] as Record<string, unknown>;
        
        // Hallucination mappings for Git
        for (const key of ['text', 'message', 'description', 'q', 'search']) {
            if (
                obj[key] !== undefined &&
                obj['query'] === undefined &&
                (methodName === 'search_commits' || methodName === 'searchCommits')
            ) {
                obj['query'] = obj[key];
                Reflect.deleteProperty(obj, key);
            }
        }
        
        if (obj['keep'] !== undefined && obj['maxCount'] === undefined) {
            obj['maxCount'] = obj['keep'];
            delete obj['keep'];
        }
        
        if (obj['limit'] !== undefined && obj['maxCount'] === undefined) {
            obj['maxCount'] = obj['limit'];
            delete obj['limit'];
        }

        if (obj['max_count'] !== undefined && obj['maxCount'] === undefined) {
            obj['maxCount'] = obj['max_count'];
            delete obj['max_count'];
        }

        if (obj['repository'] !== undefined && obj['repo'] === undefined) {
            obj['repo'] = obj['repository'];
            delete obj['repository'];
        }
        if (obj['workspace'] !== undefined && obj['workspace_id'] === undefined) {
            obj['workspace_id'] = obj['workspace'];
            delete obj['workspace'];
        }

        // Q/Query error interception for non-search tools
        if (
            methodName !== 'search_commits' &&
            methodName !== 'searchCommits' &&
            (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined)
        ) {
             return { error: {
                success: false,
                error: `${methodName} does not support search queries (q/query/search). It only retrieves history or analysis.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the query parameter, or use search_commits for text search.',
                recoverable: true
            }};
        }

        return { args: [obj] };
    }
    
    return null;
}
