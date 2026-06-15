/**
 * Worker API Proxy Builder — constructs the `mj.*` proxy API for the sandbox.
 *
 * Each tool group becomes a namespace with methods that dispatch RPC calls
 * to the main thread. Includes snake_case→camelCase fallback, readResource
 * hallucination handling, and schema() introspection on every method.
 */

import { wrapResult } from './worker-result-proxy.js'
import { METHOD_ALIASES } from './api-constants.js'

function applyArgInterceptions(methodName: string, args: unknown[]): { args: unknown[] } | { error: Record<string, unknown> } {
    // Hallucination intercept for _executeRawQueryUnsafe string arguments
    if (methodName === '_executeRawQueryUnsafe' && args.length === 1 && typeof args[0] === 'string') {
        args[0] = { query: args[0] }
    }

    // Search tools hallucinations (q -> query, start -> start_date, end -> end_date, limit string -> number)
    if (
        (methodName === 'search_entries' || methodName === 'searchEntries' || 
         methodName === 'team_search' || methodName === 'teamSearch' || 
         methodName === 'search_by_date_range' || methodName === 'searchByDateRange' || 
         methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange' ||
         methodName === 'semantic_search' || methodName === 'semanticSearch' ||
         methodName === 'team_semantic_search' || methodName === 'teamSemanticSearch' ||
         methodName === 'cross_team_search' || methodName === 'crossTeamSearch') &&
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null
    ) {
        const obj = args[0] as Record<string, unknown>;
        
        if (obj['q'] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj['q'];
            delete obj['q'];
        }
        
        if (obj['text'] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj['text'];
            delete obj['text'];
        }
        if (obj['message'] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj['message'];
            delete obj['message'];
        }
        if (obj['description'] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj['description'];
            delete obj['description'];
        }
        if (obj['path'] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj['path'];
            delete obj['path'];
        }
        if (obj['keep'] !== undefined && obj['query'] === undefined) {
            obj['query'] = obj['keep'];
            delete obj['keep'];
        }
        
        if (obj['start'] !== undefined && obj['start_date'] === undefined) {
            obj['start_date'] = obj['start'];
            delete obj['start'];
        }
        
        if (obj['end'] !== undefined && obj['end_date'] === undefined) {
            obj['end_date'] = obj['end'];
            delete obj['end'];
        }
        
        if (typeof obj['limit'] === 'string') {
            const parsed = parseInt(obj['limit'], 10);
            if (!isNaN(parsed)) obj['limit'] = parsed;
        }
    }
    // Hallucination intercept for search exact_match
    if (
        (methodName === 'search_entries' || methodName === 'searchEntries' || methodName === 'team_search' || methodName === 'teamSearch' || methodName === 'search_by_date_range' || methodName === 'searchByDateRange' || methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') &&
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null
    ) {
        const obj = args[0] as Record<string, unknown>
        if ('exact_match' in obj) {
            const isFuzzy = obj['exact_match'] === false;
            obj['fuzzy_match'] = isFuzzy;
            obj['auto_correct'] = isFuzzy;
            delete obj['exact_match']
        } else if (obj['fuzzy_match'] === true && !('auto_correct' in obj)) {
            obj['auto_correct'] = true;
        }
        
        if (typeof obj['start_date'] === 'string' && (obj['end_date'] === undefined || obj['end_date'] === null || obj['end_date'] === '')) {
            obj['end_date'] = new Date().toISOString().split('T')[0];
        }

        if ((methodName === 'team_search' || methodName === 'teamSearch') && obj['project_number'] == null) {
            const tags = obj['tags'] as string[] | undefined;
            if (tags && tags.length > 0 && tags.some(t => !t.startsWith('flag:'))) {
                return { error: {
                    success: false,
                    error: 'Cross-project team searches are only permitted for flags. Provide a project_number or use flag:* tags.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a project_number, or use tags starting with "flag:"',
                    recoverable: true
                }};
            }
        }

        if ((methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') && obj['project_number'] == null) {
            const entryType = obj['entry_type'] as string | undefined;
            if (entryType && entryType !== 'flag') {
                return { error: {
                    success: false,
                    error: 'Cross-project team date range searches are only permitted for flags. Provide a project_number or use entry_type="flag".',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a project_number, or set entry_type to "flag"',
                    recoverable: true
                }};
            }
        }
    }

    // IO tools hallucinations
    const ioMethods = ['export_entries', 'exportEntries', 'team_export_entries', 'teamExportEntries', 'export_markdown', 'exportMarkdown', 'team_export_markdown', 'teamExportMarkdown', 'import_markdown', 'importMarkdown', 'team_import_markdown', 'teamImportMarkdown', 'import_external', 'importExternal', 'team_import_external', 'teamImportExternal'];
    if (ioMethods.includes(methodName) && args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const obj = args[0] as Record<string, unknown>;

        // Intercept query/text hallucinations on export_entries
        if (methodName === 'export_entries' || methodName === 'exportEntries' || methodName === 'team_export_entries' || methodName === 'teamExportEntries') {
            if (obj['q'] !== undefined || obj['query'] !== undefined || obj['text'] !== undefined || obj['search'] !== undefined) {
                return { error: {
                    success: false,
                    error: `export_entries does not support text search. It exports all entries (optionally filtered by date or tags).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'To search for specific text, use search_entries. Otherwise, remove the search query parameter.',
                    recoverable: true
                }};
            }
            if (obj['path'] !== undefined || obj['output_dir'] !== undefined || obj['file'] !== undefined) {
                return { error: {
                    success: false,
                    error: `export_entries returns the exported data directly and does not write to disk.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Use export_markdown if you want to save files to a directory, or remove path/output_dir.',
                    recoverable: true
                }};
            }
        }

        // Map path/file/dir to output_dir or source_dir
        for (const key of ['path', 'file', 'filepath', 'dir', 'folder', 'target', 'source']) {
            if (obj[key] !== undefined) {
                let didMap = false;
                if (methodName.includes('export_markdown') || methodName.includes('exportMarkdown')) {
                    if (obj['output_dir'] === undefined) obj['output_dir'] = obj[key];
                    didMap = true;
                } else if (methodName.includes('import')) {
                    if (obj['source_dir'] === undefined) obj['source_dir'] = obj[key];
                    didMap = true;
                }
                
                if (didMap) {
                    if (key === 'path') delete obj['path'];
                    else if (key === 'file') delete obj['file'];
                    else if (key === 'filepath') delete obj['filepath'];
                    else if (key === 'dir') delete obj['dir'];
                    else if (key === 'folder') delete obj['folder'];
                    else if (key === 'target') delete obj['target'];
                    else if (key === 'source') delete obj['source'];
                }
            }
        }

        // URL hallucination on import_external
        if (methodName.includes('import_external') || methodName.includes('importExternal')) {
            if (obj['url'] !== undefined || obj['link'] !== undefined) {
                return { error: {
                    success: false,
                    error: `import_external does not download from URLs. It imports from a local directory (source_dir).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a local directory path in source_dir.',
                    recoverable: true
                }};
            }
            if (obj['format'] !== undefined && obj['source_format'] === undefined) {
                obj['source_format'] = obj['format'];
                delete obj['format'];
            }
        }
    }

    // GitHub tools hallucinations
    const githubMethods = [
        'get_github_issues', 'getGithubIssues',
        'get_github_prs', 'getGithubPrs',
        'get_github_issue', 'getGithubIssue',
        'get_github_pr', 'getGithubPr',
        'get_github_context', 'getGithubContext',
        'get_kanban_board', 'getKanbanBoard',
        'move_kanban_item', 'moveKanbanItem',
        'add_kanban_item', 'addKanbanItem',
        'delete_kanban_item', 'deleteKanbanItem',
        'create_github_issue_with_entry', 'createGithubIssueWithEntry',
        'close_github_issue_with_entry', 'closeGithubIssueWithEntry',
        'get_github_milestones', 'getGithubMilestones',
        'get_github_milestone', 'getGithubMilestone',
        'create_github_milestone', 'createGithubMilestone',
        'update_github_milestone', 'updateGithubMilestone',
        'delete_github_milestone', 'deleteGithubMilestone',
        'get_repo_insights', 'getRepoInsights',
        'get_copilot_reviews', 'getCopilotReviews'
    ];
    if (githubMethods.includes(methodName) && args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const obj = args[0] as Record<string, unknown>;
        
        // 1. Text aliases
        for (const key of ['text', 'message', 'description'] as const) {
            if (obj[key] !== undefined) {
                if (methodName.includes('create_github_issue') || methodName.includes('createGithubIssue') || methodName.includes('create_github_milestone') || methodName.includes('update_github_milestone') || methodName.includes('createGithubMilestone') || methodName.includes('updateGithubMilestone')) {
                    const targetProp = methodName.includes('milestone') || methodName.includes('Milestone') ? 'description' : 'body';
                    if (obj[targetProp] === undefined) {
                        obj[targetProp] = obj[key];
                        if (key === 'text') delete obj['text'];
                        else if (key === 'message') delete obj['message'];
                        else if (key === 'description') delete obj['description'];
                    }
                } else if (methodName.includes('close_github_issue') || methodName.includes('closeGithubIssue')) {
                    if (obj['comment'] === undefined && key !== 'description') {
                        obj['comment'] = obj[key];
                        if (key === 'text') delete obj['text'];
                        else if (key === 'message') delete obj['message'];
                    } else if (obj['resolution_notes'] === undefined && key === 'description') {
                        obj['resolution_notes'] = obj[key];
                        delete obj['description'];
                    }
                }
            }
        }

        // 2. State aliases
        if (obj['keep'] !== undefined && obj['state'] === undefined) {
            if (obj['keep'] === true) {
                obj['state'] = 'open';
            } else if (obj['keep'] === false) {
                obj['state'] = 'closed';
            } else if (typeof obj['keep'] === 'string') {
                obj['state'] = obj['keep'];
            }
            delete obj['keep'];
        }

        // 3. Mode alias for Kanban
        if (obj['mode'] !== undefined && obj['summary_only'] === undefined) {
            obj['summary_only'] = obj['mode'] === 'summary';
            delete obj['mode'];
        }

        // 4. Q/Query for list issues/PRs
        if ((methodName.includes('get_github_issues') || methodName.includes('getGithubIssues') || methodName.includes('get_github_prs') || methodName.includes('getGithubPrs')) && (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined)) {
            return { error: {
                success: false,
                error: `${methodName} does not support search queries (q/query/search). It only supports listing by state (open/closed).`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the query parameter to list items, or use GitHub directly for complex searches.',
                recoverable: true
            }};
        }

        // 5. Path for context
        if ((methodName.includes('get_github_context') || methodName.includes('getGithubContext')) && obj['path'] !== undefined) {
             return { error: {
                success: false,
                error: `get_github_context does not take a 'path' parameter. It returns repository-wide context.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the path parameter.',
                recoverable: true
            }};
        }
    }

    // Backup tools hallucinations
    const backupMethods = ['backup_journal', 'backupJournal', 'team_backup', 'teamBackup', 'list_backups', 'listBackups', 'team_list_backups', 'teamListBackups', 'restore_backup', 'restoreBackup', 'cleanup_backups', 'cleanupBackups'];
    if (backupMethods.includes(methodName) && args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const obj = args[0] as Record<string, unknown>;

        if (methodName.includes('backup_journal') || methodName.includes('backupJournal') || methodName.includes('team_backup') || methodName.includes('teamBackup')) {
            if (obj['name'] === undefined) {
                if (obj['description'] !== undefined) obj['name'] = obj['description'];
                else if (obj['message'] !== undefined) obj['name'] = obj['message'];
                else if (obj['text'] !== undefined) obj['name'] = obj['text'];
                else if (obj['path'] !== undefined) obj['name'] = obj['path'];
                
                delete obj['description'];
                delete obj['message'];
                delete obj['text'];
                delete obj['path'];
            }
        }

        if (methodName.includes('list_backups') || methodName.includes('listBackups') || methodName.includes('team_list_backups') || methodName.includes('teamListBackups')) {
            if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined) {
                return { error: {
                    success: false,
                    error: `list_backups does not support search queries. It lists all available backups.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove the query parameter.',
                    recoverable: true
                }};
            }
            if (obj['limit'] !== undefined) {
                return { error: {
                    success: false,
                    error: `list_backups does not support a limit parameter.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove the limit parameter.',
                    recoverable: true
                }};
            }
        }

        if (methodName.includes('restore_backup') || methodName.includes('restoreBackup')) {
            if (obj['path'] !== undefined && obj['filename'] === undefined) {
                obj['filename'] = obj['path'];
                delete obj['path'];
            }
            if (obj['file'] !== undefined && obj['filename'] === undefined) {
                obj['filename'] = obj['file'];
                delete obj['file'];
            }
        }

        if (methodName.includes('cleanup_backups') || methodName.includes('cleanupBackups')) {
            if (obj['keep'] !== undefined && obj['keep_count'] === undefined) {
                obj['keep_count'] = obj['keep'];
                delete obj['keep'];
            }
        }
    }

    // Single ID methods hallucination: passing primitive instead of object, passing array, or missing ID
    const singleIdMethods = ['delete_entry', 'deleteEntry', 'restore_entry', 'restoreEntry', 'get_entry_by_id', 'getEntryById', 'get_entry_history', 'getEntryHistory', 'add_to_vector_index', 'addToVectorIndex', 'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry', 'team_delete_entry', 'teamDeleteEntry', 'team_restore_entry', 'teamRestoreEntry', 'visualize_relationships', 'visualizeRelationships', 'team_visualize_relationships', 'teamVisualizeRelationships'];
    if (singleIdMethods.includes(methodName)) {
        if (args.length === 0) {
            return { error: {
                success: false,
                error: `${methodName} requires an 'entry_id' parameter.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: `Provide { entry_id: number } as the argument`,
                recoverable: true
            }};
        } else if (args.length === 1) {
        if (Array.isArray(args[0])) {
            return { error: {
                success: false,
                error: `${methodName} only accepts a single entry. To process multiple entries, use the batch equivalent (e.g., batch_delete_entries).`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: `Use a batch method or pass a single object like { entry_id: number }`,
                recoverable: true
            }};
        } else if (typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (Array.isArray(obj['ids']) || Array.isArray(obj['entry_ids'])) {
                return { error: {
                    success: false,
                    error: `${methodName} only accepts a single entry_id. To process multiple entries, use the batch equivalent.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: `Use a batch method (e.g. batch_delete_entries) or pass { entry_id: number }`,
                    recoverable: true
                }};
            }
            if (obj['entry_id'] === undefined && obj['id'] === undefined && obj['entryId'] === undefined) {
                return { error: {
                    success: false,
                    error: `${methodName} requires an 'entry_id' parameter.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: `Provide { entry_id: number, ... } as the argument`,
                    recoverable: true
                }};
            }
            const idVal = obj['entry_id'] !== undefined ? obj['entry_id'] : (obj['entryId'] !== undefined ? obj['entryId'] : obj['id']);
            if (typeof idVal === 'string' && isNaN(parseInt(idVal, 10))) {
                return { error: {
                    success: false,
                    error: `${methodName} requires a numeric entry_id, but received a non-numeric string ('${idVal}'). Journal entries use auto-incrementing integer IDs.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a numeric ID.',
                    recoverable: true
                }};
            }
        } else if (typeof args[0] === 'number' || typeof args[0] === 'string') {
            const asNum = typeof args[0] === 'string' ? parseInt(args[0], 10) : args[0];
            if (!isNaN(asNum)) {
                args[0] = { entry_id: asNum };
            } else {
                return { error: {
                    success: false,
                    error: `${methodName} requires a numeric entry_id, but received a non-numeric string ('${args[0]}'). Journal entries use auto-incrementing integer IDs.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a numeric ID.',
                    recoverable: true
                }};
            }
        }
        }
    }

    // update_entry hallucination: passing ID as first arg and data as second arg
    if ((methodName === 'update_entry' || methodName === 'updateEntry') && args.length === 2 && (typeof args[0] === 'number' || typeof args[0] === 'string') && typeof args[1] === 'object' && args[1] !== null) {
        const asNum = typeof args[0] === 'string' ? parseInt(args[0], 10) : args[0];
        if (!isNaN(asNum)) {
            args = [{ entry_id: asNum, ...args[1] }];
        }
    }

    // batch_create_entries hallucination: passing array directly
    if ((methodName === 'batch_create_entries' || methodName === 'batchCreateEntries' || methodName === 'team_batch_create_entries' || methodName === 'teamBatchCreateEntries') && args.length === 1 && Array.isArray(args[0])) {
        args[0] = { entries: args[0] };
    }

    // batch_update_entries hallucination: passing array directly
    if ((methodName === 'batch_update_entries' || methodName === 'batchUpdateEntries' || methodName === 'team_batch_update_entries' || methodName === 'teamBatchUpdateEntries') && args.length === 1 && Array.isArray(args[0])) {
        args[0] = { updates: args[0] };
    }

    // batch_delete_entries hallucination: passing comma-separated string or multiple args or direct array
    if (methodName === 'batch_delete_entries' || methodName === 'batchDeleteEntries' || methodName === 'team_batch_delete_entries' || methodName === 'teamBatchDeleteEntries') {
        if (args.length === 1 && typeof args[0] === 'string') {
            const ids = args[0].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            args[0] = { entry_ids: ids };
        } else if (args.length === 1 && Array.isArray(args[0])) {
            const hasStrings = args[0].some(id => typeof id === 'string');
            if (hasStrings) {
                return { error: {
                    success: false,
                    error: `batch_delete_entries expects an array of numeric IDs, but received an array containing strings.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Ensure all IDs in the array are numbers. Use parseInt() if necessary.',
                    recoverable: true
                }};
            }
            args[0] = { entry_ids: args[0] };
        } else if (args.length > 1 && args.every(a => typeof a === 'number')) {
            args = [{ entry_ids: args }];
        }
    }

    // link_entries hallucination: passing source, target, type, description, etc.
    if (methodName === 'link_entries' || methodName === 'linkEntries' || methodName === 'team_link_entries' || methodName === 'teamLinkEntries') {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (obj['source'] !== undefined && obj['from_entry_id'] === undefined) {
                obj['from_entry_id'] = obj['source'];
                delete obj['source'];
            }
            if (obj['source_id'] !== undefined && obj['from_entry_id'] === undefined) {
                obj['from_entry_id'] = obj['source_id'];
                delete obj['source_id'];
            }
            if (obj['target'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['target'];
                delete obj['target'];
            }
            if (obj['target_id'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['target_id'];
                delete obj['target_id'];
            }
            if (obj['dest'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['dest'];
                delete obj['dest'];
            }
            if (obj['type'] !== undefined && obj['relationship_type'] === undefined) {
                obj['relationship_type'] = obj['type'];
                delete obj['type'];
            }
            if (obj['rel'] !== undefined && obj['relationship_type'] === undefined) {
                obj['relationship_type'] = obj['rel'];
                delete obj['rel'];
            }
            if (obj['description'] !== undefined && obj['notes'] === undefined) {
                obj['notes'] = obj['description'];
                delete obj['description'];
            }
            if (obj['message'] !== undefined && obj['notes'] === undefined) {
                obj['notes'] = obj['message'];
                delete obj['message'];
            }
        }
    }

    // update_configuration hallucination: passing string directly or nested config object
    if (methodName === 'update_configuration' || methodName === 'updateConfiguration' || methodName === 'config' || methodName === 'configure') {
        if (args.length === 1 && typeof args[0] === 'string') {
            args[0] = { instruction_level: args[0] };
        } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = { ...(args[0] as Record<string, unknown>) };
            if (typeof obj['config'] === 'object' && obj['config'] !== null) {
                args[0] = { ...obj, ...(obj['config'] as Record<string, unknown>) };
                delete (args[0] as Record<string, unknown>)['config'];
            }
        }
    }

    // merge_tags hallucination: passing `source_tags` or `from`/`to` or comma-separated tags
    if (methodName === 'merge_tags' || methodName === 'mergeTags' || methodName === 'team_merge_tags' || methodName === 'teamMergeTags') {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (obj['source_tags'] !== undefined && obj['source_tag'] === undefined) {
                obj['source_tag'] = Array.isArray(obj['source_tags']) ? obj['source_tags'][0] : obj['source_tags'];
                delete obj['source_tags'];
            }
            if (obj['old_tag'] !== undefined && obj['source_tag'] === undefined) {
                obj['source_tag'] = obj['old_tag'];
                delete obj['old_tag'];
            }
            if (obj['new_tag'] !== undefined && obj['target_tag'] === undefined) {
                obj['target_tag'] = obj['new_tag'];
                delete obj['new_tag'];
            }
            if (obj['from'] !== undefined && obj['source_tag'] === undefined) {
                obj['source_tag'] = obj['from'];
                delete obj['from'];
            }
            if (obj['to'] !== undefined && obj['target_tag'] === undefined) {
                obj['target_tag'] = obj['to'];
                delete obj['to'];
            }
            if (typeof obj['source_tag'] === 'string' && obj['source_tag'].includes(',')) {
                return { error: {
                    success: false,
                    error: `merge_tags only accepts a single source_tag string, not a comma-separated list.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a single tag string for source_tag. To merge multiple tags, call this tool multiple times.',
                    recoverable: true
                }};
            }
        }
    }

    // search_audit_log hallucination: passing `limit` as a string
    if (methodName === 'search_audit_log' || methodName === 'searchAuditLog') {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if (typeof obj['limit'] === 'string') {
                const parsed = parseInt(obj['limit'], 10);
                if (!isNaN(parsed)) obj['limit'] = parsed;
            }
        }
    }

    // rebuild_vector_index hallucination: passing a boolean or string instead of object
    if (methodName === 'rebuild_vector_index' || methodName === 'rebuildVectorIndex') {
        if (args.length === 1 && (typeof args[0] === 'boolean' || typeof args[0] === 'string')) {
            args[0] = {};
        }
    }

    // update_configuration hallucination: trying to change maxTokens
    if (methodName === 'update_configuration') {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
            const obj = args[0] as Record<string, unknown>;
            if ('maxTokens' in obj || 'max_tokens' in obj) {
                return {
                    error: {
                        success: false,
                        error: "[VALIDATION_ERROR] Unrecognized key: \"max_tokens\". update_configuration does not support changing maxTokens.",
                        code: "VALIDATION_ERROR",
                        category: "validation",
                        suggestion: "Remove 'max_tokens' from the payload. Only instruction_level, tool_filters, and briefing preferences are supported.",
                        recoverable: false
                    }
                };
            }
        }
    }

    return { args };
}

/**
 * Build the mj.* API proxy from method and schema lists.
 *
 * @param rpcCall - Function to dispatch RPC calls to main thread
 * @param methods - Map of group name → method names
 * @param schemas - Optional map of group name → method name → type string
 * @param readonlyMode - If true, blocked methods show readonly error
 */
export function buildApiProxy(
    rpcCall: (group: string, method: string, args: unknown[]) => Promise<unknown>,
    methods: Record<string, string[]>,
    schemas?: Record<string, Record<string, string>>,
    readonlyMode?: boolean
): Record<string, unknown> {
    const api: Record<string, unknown> = {}

    function wrapPromise(promise: Promise<unknown>, methodName: string): Promise<unknown> {
        return new Proxy(promise, {
            get(target, prop) {
                if (prop === 'then') return target.then.bind(target)
                if (prop === 'catch') return target.catch.bind(target)
                if (prop === 'finally') return target.finally.bind(target)
                if (typeof prop === 'string' && prop !== 'constructor' && prop !== 'toString' && prop !== 'valueOf' && prop !== 'toJSON') {
                    throw new Error(`Attempted to access property '${prop}' on a Promise object. Did you forget to 'await' the tool call? (e.g. const result = await mj.group.${methodName}(...))`)
                }
                if (prop === Symbol.iterator) {
                    throw new Error(`Attempted to iterate over a Promise object. Did you forget to 'await' the tool call? (e.g. const [item] = await mj.group.${methodName}(...))`)
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                return Reflect.get(target, prop)
            }
        })
    }

    for (const [group, methodNames] of Object.entries(methods)) {
        if (group === '_topLevel') {
            for (const methodName of methodNames) {
                const proxyFn = (...args: unknown[]): Promise<unknown> => {
                    const intercept = applyArgInterceptions(methodName, args)
                    if ('error' in intercept) {
                        return wrapPromise(Promise.resolve(wrapResult(intercept.error)), methodName)
                    }
                    const resultPromise = rpcCall('_topLevel', methodName, intercept.args).then(wrapResult)
                    return wrapPromise(resultPromise, methodName)
                }
                Object.assign(proxyFn, {
                    schema: (): Promise<string> =>
                        Promise.resolve(schemas?.['_topLevel']?.[methodName] ?? 'unknown'),
                })
                api[methodName] = proxyFn
            }
            continue
        }

        const groupProxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

        for (const methodName of methodNames) {
            const proxyFn = (...args: unknown[]): Promise<unknown> => {
                const intercept = applyArgInterceptions(methodName, args)
                if ('error' in intercept) {
                    return wrapPromise(Promise.resolve(wrapResult(intercept.error)), methodName)
                }
                const resultPromise = rpcCall(group, methodName, intercept.args).then(wrapResult)
                return wrapPromise(resultPromise, methodName)
            }
            Object.assign(proxyFn, {
                schema: (): Promise<string> =>
                    Promise.resolve(schemas?.[group]?.[methodName] ?? 'unknown'),
            })
            groupProxy[methodName] = proxyFn
        }

        groupProxy['help'] = () =>
            Promise.resolve({
                group,
                methods: methodNames,
            })

        const groupProxyWrapped = new Proxy(groupProxy, {
            get(target, prop) {
                if (typeof prop === 'symbol') return undefined
                const key = prop
                if (key in target) return target[key]

                // Generic camelCase to snake_case fallback
                if (typeof key === 'string' && /[A-Z]/.test(key)) {
                    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                    if (snakeKey in target) return target[snakeKey]
                }

                // Resolve using unified METHOD_ALIASES map
                const aliases = METHOD_ALIASES[group]
                if (aliases && typeof key === 'string' && aliases[key]) {
                    const canonicalCamel = aliases[key]
                    // Convert the canonical camelCase to the target's snake_case keys
                    const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)
                    if (canonicalSnake in target) return target[canonicalSnake]
                    if (canonicalCamel in target) return target[canonicalCamel]
                }

                if (key === 'getConfig') {
                    return () => Promise.reject(new Error(
                        "Code Mode cannot directly read configuration via getConfig(). Use mj.core.listProjects() to discover active projects, or updateConfiguration() to change settings."
                    ))
                }

                if (key === 'getBriefing') {
                    return () => Promise.reject(new Error(
                        "Code Mode cannot directly read the briefing resource via getBriefing(). Use mj.core.getRecentEntries() instead, or read the memory://briefing resource via standard MCP client requests outside of Code Mode."
                    ))
                }

                if (key === 'readResource') {
                    // §2.3: URI-aware suggestions for common readResource hallucinations
                    return (uri?: string) => {
                        const suggestions: Record<string, string> = {
                            'memory://recent': 'mj.core.getRecentEntries()',
                            'memory://statistics': 'mj.analytics.getStatistics()',
                            'memory://tags': 'mj.core.listTags()',
                            'memory://flags': 'mj.team.teamListFlags({ status: "active" })',
                            'memory://significant': 'mj.search.searchEntries({ sort_by: "importance" })',
                            'memory://insights': 'mj.analytics.getCrossProjectInsights()',
                        }
                        let hint = ''
                        if (typeof uri === 'string') {
                            const match = Object.entries(suggestions).find(([k]) => uri.startsWith(k))
                            if (match !== undefined) {
                                hint = ` Try: ${match[1]}`
                            }
                        }
                        return Promise.reject(new Error(
                            `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`
                        ))
                    }
                }

                if (key === 'then') return undefined
                
                // Cross-group search and Team tool transparent routing
                if (typeof key === 'string') {
                    const snakeKey = /[A-Z]/.test(key) ? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : key;
                    
                    // 1. Check for team prefix hallucination (e.g. semanticSearch -> team_semantic_search)
                    const teamSnakeKey = `team_${snakeKey}`;
                    const teamGroup = Object.keys(methods).find(g => methods[g]?.includes(teamSnakeKey));
                    if (teamGroup && !Object.keys(methods).some(g => methods[g]?.includes(snakeKey))) {
                        return (...args: unknown[]): Promise<unknown> => {
                            const intercept = applyArgInterceptions(teamSnakeKey, args);
                            if ('error' in intercept) {
                                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
                            }
                            const resultPromise = rpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
                            return wrapPromise(resultPromise, teamSnakeKey);
                        }
                    }

                    // 2. Check for cross-group hallucination (e.g. mj.core.searchEntries -> mj.search.searchEntries)
                    const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                    if (foundGroup) {
                        return (...args: unknown[]): Promise<unknown> => {
                            const intercept = applyArgInterceptions(snakeKey, args);
                            if ('error' in intercept) {
                                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
                            }
                            const resultPromise = rpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                            return wrapPromise(resultPromise, snakeKey);
                        }
                    }
                }

                const available = methodNames.join(', ') || 'none'
                const reason = readonlyMode
                    ? `Operation '${key}' is blocked in readonly mode. Read operations only.`
                    : methodNames.length === 0
                      ? `Operation '${key}' is not available — this group has no methods (read-only mode?). Available: ${available}.`
                      : `Operation '${key}' is not found in group '${group}'. Available: ${available}.`
                return (..._args: unknown[]) => {
                    throw new Error(reason)
                }
            },
        })

        api[group] = groupProxyWrapped
    }

    api['help'] = () => {
        const groups = Object.keys(methods).filter(
            (g) => g !== '_topLevel' && g !== 'memory' && g !== 'entries'
        )
        let totalMethods = 0
        for (const group of groups) {
            totalMethods += methods[group]?.length ?? 0
        }
        return Promise.resolve({
            groups,
            totalMethods,
            usage: 'Use mj.<group>.help() for group details. Use mj.<group>.<method>.schema() for parameter details.',
        })
    }

    return new Proxy(api, {
        get(target, prop) {
            if (typeof prop === 'symbol') return undefined
            if (prop in target) return target[prop]
            if (prop === 'then') return undefined

            if (typeof prop === 'string') {
                const snakeKey = /[A-Z]/.test(prop) ? prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : prop;
                
                // 1. Check if the property is an alias in any group
                for (const [g, groupAliases] of Object.entries(METHOD_ALIASES)) {
                    if (groupAliases?.[prop] !== undefined) {
                        const canonicalCamel = groupAliases[prop];
                        const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
                        if (methods[g]?.includes(canonicalSnake)) {
                            return (...args: unknown[]): Promise<unknown> => {
                                const intercept = applyArgInterceptions(canonicalSnake, args);
                                if ('error' in intercept) {
                                    return wrapPromise(Promise.resolve(wrapResult(intercept.error)), canonicalSnake);
                                }
                                const resultPromise = rpcCall(g, canonicalSnake, intercept.args).then(wrapResult);
                                return wrapPromise(resultPromise, canonicalSnake);
                            }
                        }
                    }
                }

                // 2. Check for team prefix hallucination (e.g. mj.semanticSearch -> mj.team.teamSemanticSearch)
                const teamSnakeKey = `team_${snakeKey}`;
                const teamGroup = Object.keys(methods).find(g => methods[g]?.includes(teamSnakeKey));
                if (teamGroup && !Object.keys(methods).some(g => methods[g]?.includes(snakeKey))) {
                    return (...args: unknown[]): Promise<unknown> => {
                        const intercept = applyArgInterceptions(teamSnakeKey, args);
                        if ('error' in intercept) {
                            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
                        }
                        const resultPromise = rpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, teamSnakeKey);
                    }
                }

                // 3. Check for cross-group hallucination (e.g. mj.update_configuration -> mj.admin.update_configuration)
                const foundGroup = Object.keys(methods).find(g => methods[g]?.includes(snakeKey));
                if (foundGroup) {
                    return (...args: unknown[]): Promise<unknown> => {
                        const intercept = applyArgInterceptions(snakeKey, args);
                        if ('error' in intercept) {
                            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
                        }
                        const resultPromise = rpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
                        return wrapPromise(resultPromise, snakeKey);
                    }
                }
            }

            const available = Object.keys(methods)
                .filter((k) => k !== '_topLevel')
                .join(', ')
            const reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`

            // Return a proxy that rejects any method call
            return new Proxy(
                () => {
                    // no-op function target for the proxy
                },
                {
                    apply() {
                        throw new Error(reason)
                    },
                    get(_t, subProp) {
                        if (typeof subProp === 'symbol') return undefined
                        if (subProp === 'then') return undefined
                        return (..._args: unknown[]) => {
                            throw new Error(
                                `${reason} (Attempted to access 'mj.${prop}.${subProp}')`
                            )
                        }
                    },
                }
            )
        },
    })
}
