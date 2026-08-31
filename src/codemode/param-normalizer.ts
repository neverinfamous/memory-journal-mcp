import { applyGitInterceptions } from './api/git-api.js';
import { resolveProjectContext } from '../utils/workspace-resolver.js';

export function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function safeString(val: unknown): string {
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'object' && val !== null) {
        try {
            return JSON.stringify(val, null, 2);
        } catch {
            return '';
        }
    }
    return '';
}

export function applyArgInterceptions(methodName: string, args: unknown[]): { args: unknown[] } | { error: Record<string, unknown> } {
    const gitIntercept = applyGitInterceptions(methodName, args);
    if (gitIntercept) return gitIntercept;

    // Raw string argument normalization for execute_code
    if ((methodName === 'execute_code' || methodName === 'executeCode' || methodName === 'mj_execute_code' || methodName === 'mjExecuteCode' || methodName === 'mysql_execute_code' || methodName === 'mysqlExecuteCode') && args.length === 1 && typeof args[0] === 'string') {
        args = [{ code: args[0] }];
    }

    // Positional Argument Normalization (e.g. MemoryJournal.appendEntry('workspace-id', { ... }))
    if (args.length === 2 && typeof args[0] === 'string' && isRecord(args[1])) {
        const firstStr = args[0].trim();
        const mergedObj = { ...args[1] };
        if (mergedObj['workspace_id'] === undefined && mergedObj['workspaceId'] === undefined) {
            mergedObj['workspace_id'] = firstStr;
        } else if (mergedObj['title'] === undefined && mergedObj['content'] === undefined) {
            mergedObj['title'] = firstStr;
        }
        args = [mergedObj];
    }

    // Generic Parameter Aliases (Phase 31.1 Hallucination Smoothing)
    if (args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below

        // Clean up system/SDK metadata keys
        if (obj['_u_r_i'] !== undefined) {
            if (obj['uri'] === undefined && obj['Uri'] === undefined) obj['uri'] = obj['_u_r_i'];
            delete obj['_u_r_i'];
        }
        delete obj['_server_name'];
        delete obj['_tool_name'];
        delete obj['_meta'];
        for (const key of Object.keys(obj)) {
            if (key.startsWith('_') && key !== '_journal') {
                Reflect.deleteProperty(obj, key);
            }
        }

        // Extract parameter hallucinations nested inside metadata/context
        const metaObj = isRecord(obj['metadata']) ? obj['metadata'] : (isRecord(obj['context']) ? obj['context'] : undefined);
        if (metaObj) {
            if (obj['project_number'] === undefined && metaObj['project_number'] !== undefined) obj['project_number'] = metaObj['project_number'];
            if (obj['project_number'] === undefined && metaObj['projectNumber'] !== undefined) obj['project_number'] = metaObj['projectNumber'];
            if (obj['session_id'] === undefined && metaObj['session_id'] !== undefined) obj['session_id'] = metaObj['session_id'];
            if (obj['session_id'] === undefined && metaObj['sessionId'] !== undefined) obj['session_id'] = metaObj['sessionId'];
            if (obj['type'] === undefined && metaObj['type'] !== undefined) obj['type'] = metaObj['type'];
            if (obj['type'] === undefined && metaObj['entry_type'] !== undefined) obj['type'] = metaObj['entry_type'];
            if (obj['type'] === undefined && metaObj['category'] !== undefined) obj['type'] = metaObj['category'];
            if (obj['tags'] === undefined && metaObj['tags'] !== undefined) obj['tags'] = metaObj['tags'];
            if (obj['workspace_id'] === undefined && metaObj['workspace_id'] !== undefined) obj['workspace_id'] = metaObj['workspace_id'];
            if (obj['workspace_id'] === undefined && metaObj['workspaceId'] !== undefined) obj['workspace_id'] = metaObj['workspaceId'];
        }

        // Global coercion of numeric strings for integer ID parameters
        for (const key of ['entry_id', 'entryId', 'id', 'from_entry_id', 'fromEntryId', 'to_entry_id', 'toEntryId', 'project_number', 'projectNumber', 'issue_number', 'issueNumber', 'pr_number', 'prNumber', 'milestone_number', 'milestoneNumber']) {
            const val = obj[key];
            if (typeof val === 'string') {
                const strVal = val.trim();
                if (/^-?\d+$/.test(strVal)) {
                    const parsed = parseInt(strVal, 10);
                    if (!isNaN(parsed)) obj[key] = parsed;
                } else if (key === 'project_number' || key === 'projectNumber') {
                    // Delete non-numeric string representations (e.g. 'N/A', 'none', 'unknown')
                    Reflect.deleteProperty(obj, key);
                }
            }
        }

        if (obj['user'] !== undefined && obj['target_user'] === undefined) { obj['target_user'] = obj['user']; delete obj['user']; }
        if (obj['severity'] !== undefined && obj['flag_type'] === undefined) { obj['flag_type'] = obj['severity']; delete obj['severity']; }
        if (obj['msg'] !== undefined && obj['message'] === undefined) { obj['message'] = obj['msg']; delete obj['message']; }
        if (obj['sort'] !== undefined && obj['sort_by'] === undefined) { obj['sort_by'] = obj['sort']; delete obj['sort']; }
        if (obj['sortBy'] !== undefined && obj['sort_by'] === undefined) { obj['sort_by'] = obj['sortBy']; delete obj['sortBy']; }
        if (obj['orderBy'] !== undefined && obj['sort_by'] === undefined) { obj['sort_by'] = obj['orderBy']; delete obj['orderBy']; }
        if (obj['order_by'] !== undefined && obj['sort_by'] === undefined) { obj['sort_by'] = obj['order_by']; delete obj['order_by']; }

        if (obj['confidence'] !== undefined) {
            if (obj['trust_score'] === undefined) obj['trust_score'] = typeof obj['confidence'] === 'string' ? Number(obj['confidence']) : obj['confidence'];
            delete obj['confidence'];
        }
        if (obj['trust'] !== undefined) {
            if (obj['trust_score'] === undefined) obj['trust_score'] = typeof obj['trust'] === 'string' ? Number(obj['trust']) : obj['trust'];
            delete obj['trust'];
        }
        if (obj['trustScore'] !== undefined) {
            if (obj['trust_score'] === undefined) obj['trust_score'] = typeof obj['trustScore'] === 'string' ? Number(obj['trustScore']) : obj['trustScore'];
            delete obj['trustScore'];
        }
        if (obj['impact'] !== undefined) {
            if (obj['impact_score'] === undefined) obj['impact_score'] = typeof obj['impact'] === 'string' ? Number(obj['impact']) : obj['impact'];
            delete obj['impact'];
        }
        if (obj['impactScore'] !== undefined) {
            if (obj['impact_score'] === undefined) obj['impact_score'] = typeof obj['impactScore'] === 'string' ? Number(obj['impactScore']) : obj['impactScore'];
            delete obj['impactScore'];
        }
        if (obj['validation'] !== undefined) {
            if (obj['validation_status'] === undefined) obj['validation_status'] = obj['validation'];
            delete obj['validation'];
        }
        if (obj['validationStatus'] !== undefined) {
            if (obj['validation_status'] === undefined) obj['validation_status'] = obj['validationStatus'];
            delete obj['validationStatus'];
        }
        
        if (obj['project_name'] !== undefined) {
            if (obj['project_number'] === undefined) {
                const num = Number(obj['project_name']);
                const strVal = typeof obj['project_name'] === 'string' || typeof obj['project_name'] === 'number' ? String(obj['project_name']) : '';
                if (!Number.isNaN(num) && strVal.trim() !== '') {
                    obj['project_number'] = num;
                }
            }
            delete obj['project_name'];
        }
        if (obj['projectName'] !== undefined) {
            if (obj['project_number'] === undefined) {
                const num = Number(obj['projectName']);
                const strVal = typeof obj['projectName'] === 'string' || typeof obj['projectName'] === 'number' ? String(obj['projectName']) : '';
                if (!Number.isNaN(num) && strVal.trim() !== '') {
                    obj['project_number'] = num;
                }
            }
            delete obj['projectName'];
        }
        if ((methodName === 'create_entry' || methodName === 'createEntry' || methodName === 'team_create_entry' || methodName === 'teamCreateEntry')) {
            const projNum = typeof obj['project_number'] === 'number' ? obj['project_number'] : undefined;
            const content = typeof obj['content'] === 'string' ? obj['content'] : undefined;
            const tags = Array.isArray(obj['tags']) ? obj['tags'].filter((t): t is string => typeof t === 'string') : undefined;
            const resolved = resolveProjectContext({
                workspace_id: typeof obj['workspace_id'] === 'string' ? obj['workspace_id'] : undefined,
                project_number: projNum,
                content,
                tags
            });
            if (resolved.workspaceId && (obj['workspace_id'] === undefined || obj['workspace_id'] === null || obj['workspace_id'] === '' || obj['workspace_id'] === 'default')) {
                if (resolved.workspaceId !== 'default') {
                    obj['workspace_id'] = resolved.workspaceId;
                } else if (process.env['MCP_WORKSPACE_ID']) {
                    obj['workspace_id'] = process.env['MCP_WORKSPACE_ID'];
                } else {
                    obj['workspace_id'] = 'default';
                }
            }
            if (obj['project_number'] === undefined && resolved.projectNumber !== undefined) {
                obj['project_number'] = resolved.projectNumber;
            }
        }
        
        if (typeof obj['sort_by'] === 'string') {
            const lowerSort = obj['sort_by'].toLowerCase();
            if (lowerSort.endsWith('_asc')) {
                obj['sort_by'] = obj['sort_by'].replace(/_asc$/i, '');
                if (obj['sort_order'] === undefined) obj['sort_order'] = 'asc';
            } else if (lowerSort.endsWith('_desc')) {
                obj['sort_by'] = obj['sort_by'].replace(/_desc$/i, '');
                if (obj['sort_order'] === undefined) obj['sort_order'] = 'desc';
            }
        }

        if (methodName === 'execute_code' || methodName === 'executeCode' || methodName === 'mj_execute_code' || methodName === 'mjExecuteCode' || methodName === 'mysql_execute_code' || methodName === 'mysqlExecuteCode') {
            if (obj['repo_name'] !== undefined && obj['repo'] === undefined) {
                obj['repo'] = obj['repo_name'];
                delete obj['repo_name'];
            }
            if (obj['code'] === undefined) {
                const codeAlias = obj['script'] ?? obj['js'] ?? obj['javascript'] ?? obj['query'] ?? obj['command'] ?? obj['content'] ?? obj['eval'] ?? obj['source'] ?? obj['body'] ?? obj['expression'] ?? obj['fn'] ?? obj['exec'] ?? obj['code_snippet'] ?? obj['raw_code'] ?? obj['statement'] ?? obj['statements'] ?? obj['codeBlock'] ?? obj['code_block'] ?? obj['script_content'] ?? obj['js_code'] ?? obj['code_string'] ?? obj['action'] ?? obj['task'] ?? obj['instruction'] ?? obj['instructions'] ?? obj['input'] ?? obj['payload'] ?? obj['text'];
                if (typeof codeAlias === 'string') {
                    obj['code'] = codeAlias;
                } else {
                    // Fallback: search any string property in obj that looks like JS code or contains text
                    for (const [k, v] of Object.entries(obj)) {
                        if (typeof v === 'string' && v.trim().length > 0 && !['repo', 'workspace_id', 'expected_version', 'auto_version', 'project_number'].includes(k)) {
                            obj['code'] = v;
                            break;
                        }
                    }
                }
            }
        } else {
            if (obj['repo'] !== undefined && obj['repo_name'] === undefined) {
                obj['repo_name'] = obj['repo'];
                delete obj['repo'];
            }
        }
        if (obj['item_type'] !== undefined && obj['type'] === undefined) { obj['type'] = obj['item_type']; delete obj['item_type']; }
        if (obj['category'] !== undefined && obj['type'] === undefined) { obj['type'] = obj['category']; delete obj['category']; }
        if (obj['metadata'] !== undefined && obj['context'] === undefined) { obj['context'] = obj['metadata']; delete obj['metadata']; }

        // Intercept update_configuration hallucination when passed project notes
        if (methodName === 'update_configuration' || methodName === 'updateConfiguration') {
            if (obj['update_notes'] !== undefined || obj['notes'] !== undefined || (obj['text'] !== undefined && obj['tool_filter'] === undefined && obj['briefing'] === undefined)) {
                return { error: {
                    success: false,
                    error: "update_configuration is for changing server configuration (tool_filter, briefing). To create journal entries or update notes, use mj.core.createEntry({ ... }).",
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: "Use mj.core.createEntry({ content: '...', project_number: 1 }) instead.",
                    recoverable: true
                }};
            }
        }

        const isEntryMutation = methodName === 'create_entry' || methodName === 'createEntry' || methodName === 'update_entry' || methodName === 'updateEntry' || methodName === 'team_create_entry' || methodName === 'teamCreateEntry';
        if (isEntryMutation) {
            const contentParts: string[] = [];

            const title = obj['title'] ?? obj['heading'] ?? obj['subject'];
            if (title !== undefined) {
                const titleStr = safeString(title);
                if (titleStr !== '') contentParts.push(`# ${titleStr}`);
                delete obj['title']; delete obj['heading']; delete obj['subject'];
            }

            const desc = obj['description'] ?? obj['details'] ?? obj['summary'] ?? obj['notes'] ?? obj['text'] ?? obj['message'];
            if (desc !== undefined) {
                const descStr = safeString(desc);
                if (descStr !== '') contentParts.push(descStr);
                delete obj['description']; delete obj['details']; delete obj['summary']; delete obj['notes']; delete obj['text']; delete obj['message'];
            }

            if (obj['context'] !== undefined) {
                const ctxStr = safeString(obj['context']);
                if (ctxStr !== '') contentParts.push(`**Context:** ${ctxStr}`);
                delete obj['context'];
            }

            const focus = obj['focus'] ?? obj['goal'] ?? obj['objective'];
            if (focus !== undefined) {
                const focusStr = safeString(focus);
                if (focusStr !== '') contentParts.push(`**Focus:** ${focusStr}`);
                delete obj['focus']; delete obj['goal']; delete obj['objective'];
            }

            const resolution = obj['resolution'] ?? obj['fix'] ?? obj['solution'] ?? obj['result'];
            if (resolution !== undefined) {
                const resStr = safeString(resolution);
                if (resStr !== '') contentParts.push(`**Resolution:** ${resStr}`);
                delete obj['resolution']; delete obj['fix']; delete obj['solution']; delete obj['result'];
            }

            const artifacts = obj['artifacts'] ?? obj['files'] ?? obj['changes'] ?? obj['modified_files'];
            if (artifacts !== undefined) {
                const artStr = Array.isArray(artifacts) ? artifacts.map(safeString).join(', ') : safeString(artifacts);
                if (artStr !== '') contentParts.push(`**Artifacts:** ${artStr}`);
                delete obj['artifacts']; delete obj['files']; delete obj['changes']; delete obj['modified_files'];
            }

            if (obj['content'] !== undefined) {
                const existing = safeString(obj['content']);
                if (contentParts.length > 0) {
                    obj['content'] = existing !== '' ? `${existing}\n\n${contentParts.join('\n\n')}` : contentParts.join('\n\n');
                }
            } else if (contentParts.length > 0) {
                obj['content'] = contentParts.join('\n\n');
            }
        }

        if (obj['search'] !== undefined && obj['query'] === undefined) { obj['query'] = obj['search']; delete obj['search']; }
        if ((methodName === 'import_external' || methodName === 'importExternal' || methodName === 'team_import_external' || methodName === 'teamImportExternal') && obj['source_dir'] === undefined) {
            if (obj['filename'] !== undefined) { obj['source_dir'] = obj['filename']; delete obj['filename']; }
        }
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
        isRecord(args[0])
    ) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        
        if (methodName === 'search_by_date_range' || methodName === 'searchByDateRange' || methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') {
            if (obj['q'] !== undefined || obj['query'] !== undefined || obj['text'] !== undefined || obj['message'] !== undefined || obj['description'] !== undefined || obj['keep'] !== undefined || obj['path'] !== undefined) {
                return { error: {
                    success: false,
                    error: `${methodName} does not support search queries. It only searches by date.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Use team_search (or search_entries) if you want to search by text, or remove the text/query parameters.',
                    recoverable: true
                }};
            }
        }
        
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

        if (methodName !== 'search_entries' && methodName !== 'searchEntries' && methodName !== 'team_search' && methodName !== 'teamSearch') {
            if (obj['mode'] !== undefined) {
                return { error: {
                    success: false,
                    error: `${methodName} does not support the 'mode' parameter.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove the mode parameter or use search_entries instead.',
                    recoverable: true
                }};
            }
        }
    }
    // Hallucination intercept for search exact_match
    if (
        (methodName === 'search_entries' || methodName === 'searchEntries' || methodName === 'team_search' || methodName === 'teamSearch' || methodName === 'search_by_date_range' || methodName === 'searchByDateRange' || methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange' || methodName === 'cross_team_search' || methodName === 'crossTeamSearch') &&
        args.length === 1 &&
        isRecord(args[0])
    ) {
        const obj = { ...args[0] };
        args[0] = obj;
        if ('exact_match' in obj) {
            const isFuzzy = obj['exact_match'] === false;
            obj['fuzzy_match'] = isFuzzy;
            if (methodName !== 'cross_team_search' && methodName !== 'crossTeamSearch') {
                obj['auto_correct'] = isFuzzy;
            }
            delete obj['exact_match']
        } else if (obj['fuzzy_match'] === true && !('auto_correct' in obj)) {
            if (methodName !== 'cross_team_search' && methodName !== 'crossTeamSearch') {
                obj['auto_correct'] = true;
            }
        }
        
        if (typeof obj['start_date'] === 'string' && (obj['end_date'] === undefined || obj['end_date'] === null || obj['end_date'] === '')) {
            obj['end_date'] = new Date().toISOString().split('T')[0];
        }

        if ((methodName === 'team_search' || methodName === 'teamSearch') && obj['project_number'] == null) {
            const tags = obj['tags'] as string[] | undefined;
            const entryType = obj['entry_type'] as string | undefined;
            const isFlagSearch = Boolean(tags && tags.length > 0 && tags.every(t => typeof t === 'string' && t.startsWith('flag:'))) || entryType === 'flag';
            if (!isFlagSearch) {
                return { error: {
                    success: false,
                    error: 'Cross-project team searches are only permitted for flags. Provide a project_number or filter by entry_type="flag" or flag:* tags.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a project_number, or use tags starting with "flag:" or entry_type="flag"',
                    recoverable: true
                }};
            }
        }

        if ((methodName === 'team_search_by_date_range' || methodName === 'teamSearchByDateRange') && obj['project_number'] == null) {
            const tags = obj['tags'] as string[] | undefined;
            const entryType = obj['entry_type'] as string | undefined;
            const isFlagSearch = Boolean(tags && tags.length > 0 && tags.every(t => typeof t === 'string' && t.startsWith('flag:'))) || entryType === 'flag';
            if (!isFlagSearch) {
                return { error: {
                    success: false,
                    error: 'Cross-project team date range searches are only permitted for flags. Provide a project_number or filter by entry_type="flag" or flag:* tags.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Provide a project_number, or use tags starting with "flag:" or entry_type="flag"',
                    recoverable: true
                }};
            }
        }
    }

    // IO tools hallucinations
    const ioMethods = ['export_entries', 'exportEntries', 'team_export_entries', 'teamExportEntries', 'export_markdown', 'exportMarkdown', 'team_export_markdown', 'teamExportMarkdown', 'import_markdown', 'importMarkdown', 'team_import_markdown', 'teamImportMarkdown', 'import_external', 'importExternal', 'team_import_external', 'teamImportExternal'];
    if (ioMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below

        // Keep alias maps to limit for all IO methods
        if (obj['keep'] !== undefined && obj['limit'] === undefined) {
            obj['limit'] = obj['keep'];
            delete obj['keep'];
        }

        // Intercept query/text/mode hallucinations on all IO methods
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['text'] !== undefined || obj['search'] !== undefined || obj['message'] !== undefined || obj['description'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support text search or content parameters. It only exports/imports data.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'To search for specific text, use search_entries (or team_search). Otherwise, remove the search/content parameters.',
                recoverable: true
            }};
        }
        
        if (obj['mode'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support the 'mode' parameter.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the mode parameter.',
                recoverable: true
            }};
        }

        if (methodName === 'export_entries' || methodName === 'exportEntries' || methodName === 'team_export_entries' || methodName === 'teamExportEntries') {
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
                if (methodName.includes('export_markdown') || methodName.includes('exportMarkdown') || methodName.includes('teamExportMarkdown') || methodName.includes('team_export_markdown')) {
                    if (obj['output_dir'] === undefined) obj['output_dir'] = obj[key];
                    didMap = true;
                } else if (methodName.toLowerCase().includes('import')) {
                    if (key === 'source' && (methodName.includes('import_external') || methodName.includes('importExternal') || methodName.includes('teamImportExternal') || methodName.includes('team_import_external'))) {
                        // Do not map 'source' to 'source_dir' for import_external.
                        // It represents source_format, which is handled below.
                    } else {
                        if (obj['source_dir'] === undefined) obj['source_dir'] = obj[key];
                        didMap = true;
                    }
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
        if (methodName.includes('import_external') || methodName.includes('importExternal') || methodName.includes('teamImportExternal') || methodName.includes('team_import_external')) {
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
            if (obj['source'] !== undefined && obj['source_format'] === undefined) {
                obj['source_format'] = obj['source'];
                delete obj['source'];
            }
        }
    }

    // Vector index stats hallucination: passing `q` or `query`
    if ((methodName === 'team_get_vector_index_stats' || methodName === 'teamGetVectorIndexStats' || methodName === 'get_vector_index_stats' || methodName === 'getVectorIndexStats') && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined || obj['text'] !== undefined || obj['message'] !== undefined || obj['description'] !== undefined || obj['path'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support search queries. It returns overall index statistics.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the search query parameter.',
                recoverable: true
            }};
        }
    }

    // Parameterless functions hallucination: passing primitives
    const parameterlessMethods = ['rebuild_vector_index', 'rebuildVectorIndex', 'team_rebuild_vector_index', 'teamRebuildVectorIndex'];
    if (parameterlessMethods.includes(methodName) && args.length === 1 && (typeof args[0] === 'boolean' || typeof args[0] === 'string' || typeof args[0] === 'number')) {
        args[0] = {};
    }

    // List deleted entries hallucinations
    const listDeletedMethods = ['list_deleted_entries', 'listDeletedEntries', 'team_list_deleted_entries', 'teamListDeletedEntries'];
    if (listDeletedMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined || obj['text'] !== undefined || obj['message'] !== undefined || obj['description'] !== undefined || obj['path'] !== undefined || obj['mode'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support search queries, path, or mode. It returns all deleted entries.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove these parameters.',
                recoverable: true
            }};
        }
        if (obj['keep'] !== undefined && obj['limit'] === undefined) {
            obj['limit'] = obj['keep'];
            delete obj['keep'];
        }
        if ((methodName === 'list_deleted_entries' || methodName === 'listDeletedEntries') && obj['project_number'] !== undefined) {
            delete obj['project_number'];
        }
        if (obj['project_id'] !== undefined) {
            delete obj['project_id'];
        }
    }

    // Analytics tools hallucinations
    const analyticsMethods = ['get_statistics', 'getStatistics', 'get_cross_project_insights', 'getCrossProjectInsights', 'team_get_statistics', 'teamGetStatistics', 'team_get_cross_project_insights', 'teamGetCrossProjectInsights', 'get_collaboration_matrix', 'getCollaborationMatrix', 'team_get_collaboration_matrix', 'teamGetCollaborationMatrix'];
    if (analyticsMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined || obj['text'] !== undefined || obj['message'] !== undefined || obj['description'] !== undefined || obj['path'] !== undefined || obj['keep'] !== undefined || obj['mode'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support search queries, content parameters, or modes. It returns analytical data.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove these parameters. Use search_entries or team_search if you want to find specific content.',
                recoverable: true
            }};
        }

        if (methodName.includes('get_statistics') || methodName.includes('getStatistics')) {
            const timeVal = obj['time'] ?? obj['timeframe'] ?? obj['period']
            if (timeVal !== undefined) {
                if (obj['group_by'] === undefined && typeof timeVal === 'string') {
                    const validGroupBy = ['day', 'week', 'month'].includes(timeVal.toLowerCase()) ? timeVal.toLowerCase() : 'month'
                    obj['group_by'] = validGroupBy
                }
                delete obj['time']
                delete obj['timeframe']
                delete obj['period']
            }
        }

        if (methodName.includes('get_cross_project_insights') || methodName.includes('getCrossProjectInsights')) {
            if (obj['limit'] !== undefined) {
                return { error: {
                    success: false,
                    error: `get_cross_project_insights does not accept a limit parameter. It analyzes all projects.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove the limit parameter.',
                    recoverable: true
                }};
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
    if (githubMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        
        // 1. Text aliases
        for (const key of ['text', 'message', 'description'] as const) {
            if (obj[key] !== undefined) {
                if (methodName.includes('create_github_issue') || methodName.includes('createGithubIssue')) {
                    if (obj['body'] === undefined) {
                        obj['body'] = obj[key];
                        if (key === 'text') delete obj['text'];
                        else if (key === 'message') delete obj['message'];
                        else if (key === 'description') delete obj['description'];
                    }
                } else if (methodName.includes('create_github_milestone') || methodName.includes('createGithubMilestone') || methodName.includes('update_github_milestone') || methodName.includes('updateGithubMilestone')) {
                    if (obj['title'] === undefined && (key === 'text' || key === 'message' || key === 'description')) {
                        obj['title'] = obj[key];
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
        const hasStateParam = methodName.includes('get_github_issues') || methodName.includes('getGithubIssues') || methodName.includes('get_github_prs') || methodName.includes('getGithubPrs') || methodName.includes('get_github_milestones') || methodName.includes('getGithubMilestones');
        if (hasStateParam && obj['keep'] !== undefined && obj['state'] === undefined) {
            if (obj['keep'] === true) {
                obj['state'] = 'open';
            } else if (obj['keep'] === false) {
                obj['state'] = 'closed';
            } else if (typeof obj['keep'] === 'string') {
                obj['state'] = obj['keep'];
            }
            delete obj['keep'];
        }

        // 2b. Kanban specific aliases
        if (methodName.includes('get_kanban_board') || methodName.includes('getKanbanBoard')) {
            if (obj['keep'] !== undefined && obj['project_number'] === undefined) {
                obj['project_number'] = obj['keep'];
                delete obj['keep'];
            }
            if (obj['path'] !== undefined && obj['project_number'] === undefined) {
                obj['project_number'] = obj['path'];
                delete obj['path'];
            }
        }
        if (methodName.includes('move_kanban_item') || methodName.includes('moveKanbanItem')) {
            if (obj['keep'] !== undefined && obj['item_id'] === undefined) {
                obj['item_id'] = obj['keep'];
                delete obj['keep'];
            }
            if (obj['path'] !== undefined && obj['target_status'] === undefined) {
                obj['target_status'] = obj['path'];
                delete obj['path'];
            }
        }
        if (methodName.includes('add_kanban_item') || methodName.includes('addKanbanItem')) {
            if (obj['keep'] !== undefined && obj['issue_number'] === undefined) {
                obj['issue_number'] = obj['keep'];
                delete obj['keep'];
            }
        }
        if (methodName.includes('delete_kanban_item') || methodName.includes('deleteKanbanItem')) {
            if (obj['keep'] !== undefined && obj['item_id'] === undefined) {
                obj['item_id'] = obj['keep'];
                delete obj['keep'];
            }
        }

        // 2c. Milestone specific aliases
        if (methodName.includes('get_github_milestone') || methodName.includes('getGithubMilestone') || methodName.includes('update_github_milestone') || methodName.includes('updateGithubMilestone') || methodName.includes('delete_github_milestone') || methodName.includes('deleteGithubMilestone')) {
            if (obj['keep'] !== undefined && obj['milestone_number'] === undefined) {
                obj['milestone_number'] = obj['keep'];
                delete obj['keep'];
            }
        }

        // 3. Mode alias for Kanban
        if (obj['mode'] !== undefined && obj['summary_only'] === undefined) {
            obj['summary_only'] = obj['mode'] === 'summary';
            delete obj['mode'];
        }

        // 4. Q/Query for list issues/PRs/Milestones
        if ((methodName.includes('get_github_issues') || methodName.includes('getGithubIssues') || methodName.includes('get_github_prs') || methodName.includes('getGithubPrs') || methodName.includes('get_github_milestones') || methodName.includes('getGithubMilestones')) && (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined)) {
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
    if (backupMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below

        if (methodName.includes('backup_journal') || methodName.includes('backupJournal') || methodName.includes('team_backup') || methodName.includes('teamBackup')) {
            if (obj['name'] === undefined) {
                if (obj['description'] !== undefined) obj['name'] = obj['description'];
                else if (obj['message'] !== undefined) obj['name'] = obj['message'];
                else if (obj['text'] !== undefined) obj['name'] = obj['text'];
                else if (obj['path'] !== undefined) obj['name'] = obj['path'];
                else if (obj['q'] !== undefined) obj['name'] = obj['q'];
                else if (obj['keep'] !== undefined) obj['name'] = obj['keep'];
                else if (obj['mode'] !== undefined) obj['name'] = obj['mode'];
                
                delete obj['description'];
                delete obj['message'];
                delete obj['text'];
                delete obj['path'];
                delete obj['q'];
                delete obj['keep'];
                delete obj['mode'];
            }
        }

        if (methodName.includes('list_backups') || methodName.includes('listBackups') || methodName.includes('team_list_backups') || methodName.includes('teamListBackups')) {
            if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined || obj['text'] !== undefined || obj['message'] !== undefined || obj['description'] !== undefined || obj['path'] !== undefined || obj['keep'] !== undefined || obj['mode'] !== undefined) {
                return { error: {
                    success: false,
                    error: `list_backups does not support search queries or other parameters. It lists all available backups.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove these parameters.',
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
            if (obj['filename'] === undefined) {
                if (obj['path'] !== undefined) obj['filename'] = obj['path'];
                else if (obj['file'] !== undefined) obj['filename'] = obj['file'];
                else if (obj['text'] !== undefined) obj['filename'] = obj['text'];
                else if (obj['message'] !== undefined) obj['filename'] = obj['message'];
                else if (obj['description'] !== undefined) obj['filename'] = obj['description'];
                else if (obj['q'] !== undefined) obj['filename'] = obj['q'];
                else if (obj['keep'] !== undefined) obj['filename'] = obj['keep'];
                else if (obj['mode'] !== undefined) obj['filename'] = obj['mode'];

                delete obj['path'];
                delete obj['file'];
                delete obj['text'];
                delete obj['message'];
                delete obj['description'];
                delete obj['q'];
                delete obj['keep'];
                delete obj['mode'];
            }
        }

        if (methodName.includes('cleanup_backups') || methodName.includes('cleanupBackups')) {
            if (obj['keep_count'] === undefined) {
                if (obj['keep'] !== undefined) obj['keep_count'] = obj['keep'];
                else if (obj['limit'] !== undefined) obj['keep_count'] = obj['limit'];
                else if (obj['q'] !== undefined) obj['keep_count'] = obj['q'];
                else if (obj['mode'] !== undefined) obj['keep_count'] = obj['mode'];
                else if (obj['text'] !== undefined) obj['keep_count'] = obj['text'];
                else if (obj['message'] !== undefined) obj['keep_count'] = obj['message'];
                else if (obj['description'] !== undefined) obj['keep_count'] = obj['description'];
                else if (obj['path'] !== undefined) obj['keep_count'] = obj['path'];

                delete obj['keep'];
                delete obj['limit'];
                delete obj['q'];
                delete obj['mode'];
                delete obj['text'];
                delete obj['message'];
                delete obj['description'];
                delete obj['path'];
            }
        }
    }

    // Single ID methods hallucination: passing primitive instead of object, passing array, or missing ID
    const singleIdMethods = ['delete_entry', 'deleteEntry', 'restore_entry', 'restoreEntry', 'get_entry_by_id', 'getEntryById', 'team_get_entry_by_id', 'teamGetEntryById', 'get_entry_history', 'getEntryHistory', 'add_to_vector_index', 'addToVectorIndex', 'team_add_to_vector_index', 'teamAddToVectorIndex', 'add_to_index', 'addToIndex', 'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry', 'edit', 'update', 'team_delete_entry', 'teamDeleteEntry', 'delete', 'team_restore_entry', 'teamRestoreEntry', 'restore', 'team_restore', 'teamRestore'];
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
        } else if (isRecord(args[0])) {
            const obj = { ...args[0] };
        args[0] = obj; // We clone it below
            if (Array.isArray(obj['ids']) || Array.isArray(obj['entry_ids']) || Array.isArray(obj['entry_id']) || Array.isArray(obj['id'])) {
                return { error: {
                    success: false,
                    error: `${methodName} only accepts a single entry_id. To process multiple entries, use the batch equivalent.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: `Use a batch method (e.g. batch_delete_entries) or pass { entry_id: number }`,
                    recoverable: true
                }};
            }
            if (obj['entry_id'] === undefined && obj['id'] === undefined && obj['entryId'] === undefined && obj['path'] === undefined && obj['keep'] === undefined) {
                return { error: {
                    success: false,
                    error: `${methodName} requires an 'entry_id' parameter.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: `Provide { entry_id: number, ... } as the argument`,
                    recoverable: true
                }};
            }
            const idVal = obj['entry_id'] !== undefined ? obj['entry_id'] : (obj['entryId'] !== undefined ? obj['entryId'] : (obj['id'] !== undefined ? obj['id'] : (obj['path'] !== undefined ? obj['path'] : obj['keep'])));
            if (obj['path'] !== undefined && obj['entry_id'] === undefined) {
                obj['entry_id'] = obj['path'];
                delete obj['path'];
            }
            if (obj['keep'] !== undefined && obj['entry_id'] === undefined) {
                obj['entry_id'] = obj['keep'];
                delete obj['keep'];
            }
            if (obj['q'] !== undefined || obj['query'] !== undefined || obj['mode'] !== undefined || obj['search'] !== undefined) {
                if (methodName !== 'update_entry' && methodName !== 'updateEntry' && methodName !== 'team_update_entry' && methodName !== 'teamUpdateEntry') {
                    return { error: {
                        success: false,
                        error: `${methodName} does not support q, query, search, or mode parameters. It operates on a single entry by entry_id.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        suggestion: 'Remove these parameters. Provide only the entry_id.',
                        recoverable: true
                    }};
                }
            }
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
    if ((methodName === 'batch_create_entries' || methodName === 'batchCreateEntries' || methodName === 'team_batch_create_entries' || methodName === 'teamBatchCreateEntries') && args.length === 1) {
        if (Array.isArray(args[0])) {
            args[0] = { entries: args[0] };
        } else if (isRecord(args[0]) && !('entries' in args[0])) {
            return { error: {
                success: false,
                error: `${methodName} requires an 'entries' array.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: `Provide { entries: [...] } as the argument`,
                recoverable: true
            }};
        }
    }

    // batch_update_entries hallucination: passing array directly
    if ((methodName === 'batch_update_entries' || methodName === 'batchUpdateEntries' || methodName === 'team_batch_update_entries' || methodName === 'teamBatchUpdateEntries') && args.length === 1) {
        if (Array.isArray(args[0])) {
            args[0] = { updates: args[0] };
        } else if (isRecord(args[0]) && !('updates' in args[0])) {
            return { error: {
                success: false,
                error: `${methodName} requires an 'updates' array.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: `Provide { updates: [...] } as the argument`,
                recoverable: true
            }};
        }
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
        } else if (args.length === 1 && isRecord(args[0]) && !Array.isArray(args[0]) && !('entry_ids' in args[0])) {
            return { error: {
                success: false,
                error: `${methodName} requires an 'entry_ids' array.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: `Provide { entry_ids: [...] } as the argument`,
                recoverable: true
            }};
        }
    }

    // link_entries hallucination: passing source, target, type, description, etc.
    if (methodName === 'link_entries' || methodName === 'linkEntries' || methodName === 'team_link_entries' || methodName === 'teamLinkEntries') {
        if (args.length === 1 && isRecord(args[0])) {
            const obj = { ...args[0] };
        args[0] = obj; // We clone it below
            if (obj['source'] !== undefined && obj['from_entry_id'] === undefined) {
                obj['from_entry_id'] = obj['source'];
                delete obj['source'];
            }
            if (obj['from'] !== undefined && obj['from_entry_id'] === undefined) {
                obj['from_entry_id'] = obj['from'];
                delete obj['from'];
            }
            if (obj['source_id'] !== undefined && obj['from_entry_id'] === undefined) {
                obj['from_entry_id'] = obj['source_id'];
                delete obj['source_id'];
            }
            if (obj['from_id'] !== undefined && obj['from_entry_id'] === undefined) {
                obj['from_entry_id'] = obj['from_id'];
                delete obj['from_id'];
            }
            if (obj['target'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['target'];
                delete obj['target'];
            }
            if (obj['to'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['to'];
                delete obj['to'];
            }
            if (obj['target_id'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['target_id'];
                delete obj['target_id'];
            }
            if (obj['to_id'] !== undefined && obj['to_entry_id'] === undefined) {
                obj['to_entry_id'] = obj['to_id'];
                delete obj['to_id'];
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
            if (obj['notes'] !== undefined && obj['description'] === undefined) {
                obj['description'] = obj['notes'];
                delete obj['notes'];
            }
            if (obj['message'] !== undefined && obj['description'] === undefined) {
                obj['description'] = obj['message'];
                delete obj['message'];
            }
            if (obj['text'] !== undefined && obj['description'] === undefined) {
                obj['description'] = obj['text'];
                delete obj['text'];
            }
        }
    }

    // update_configuration hallucination: passing string directly or nested config object
    if (methodName === 'update_configuration' || methodName === 'updateConfiguration' || methodName === 'config' || methodName === 'configure') {
        if (args.length === 1 && typeof args[0] === 'string') {
            // instruction_level is deprecated, no fallback needed
        } else if (args.length === 1 && isRecord(args[0])) {
            const obj = { ...args[0] };
            if (typeof obj['config'] === 'object' && obj['config'] !== null) {
                args[0] = { ...obj, ...(obj['config'] as Record<string, unknown>) };
                delete (args[0] as Record<string, unknown>)['config'];
            }
            if (obj['maxTokens'] !== undefined || obj['max_tokens'] !== undefined || obj['temperature'] !== undefined || obj['model'] !== undefined || obj['top_p'] !== undefined) {
                return { error: {
                    success: false,
                    error: `update_configuration is for configuring the memory-journal-mcp server. It does not configure the LLM context (like maxTokens or temperature).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove LLM parameters. Server configuration does not accept LLM generation parameters.',
                    recoverable: true
                }};
            }
        }
    }

    // team_update_entry hallucination: passing `keep` instead of `is_archived`
    if (methodName === 'update_entry' || methodName === 'updateEntry' || methodName === 'team_update_entry' || methodName === 'teamUpdateEntry') {
        if (args.length === 1 && isRecord(args[0])) {
            const obj = { ...args[0] };
        args[0] = obj; // We clone it below
            if (obj['keep'] !== undefined && obj['is_archived'] === undefined) {
                obj['is_archived'] = !obj['keep'];
                delete obj['keep'];
            }
            if (obj['text'] !== undefined && obj['content'] === undefined) {
                obj['content'] = obj['text'];
                delete obj['text'];
            }
            if (obj['message'] !== undefined && obj['content'] === undefined) {
                obj['content'] = obj['message'];
                delete obj['message'];
            }
            if (obj['description'] !== undefined && obj['content'] === undefined) {
                obj['content'] = obj['description'];
                delete obj['description'];
            }
            if (obj['q'] !== undefined || obj['query'] !== undefined || obj['path'] !== undefined || obj['mode'] !== undefined || obj['search'] !== undefined) {
                return { error: {
                    success: false,
                    error: `${methodName} does not support q, query, search, path, or mode parameters.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove these parameters. Use entry_id and content to update the entry.',
                    recoverable: true
                }};
            }
        }
    }
    
    // delete_entry hallucination: version -> expected_version mapping
    const deleteMethods = ['delete_entry', 'deleteEntry', 'team_delete_entry', 'teamDeleteEntry'];
    if (deleteMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['version'] !== undefined && obj['expected_version'] === undefined) {
            obj['expected_version'] = obj['version'];
            delete obj['version'];
        }
        if ((methodName === 'delete_entry' || methodName === 'deleteEntry') && obj['project_number'] !== undefined) {
            delete obj['project_number'];
        }
    }
    
    // team_get_recent hallucination: passing `q` or `query` or `keep`
    const recentMethods = ['get_recent_entries', 'getRecentEntries', 'team_get_recent', 'teamGetRecent'];
    if (recentMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support search queries. It only returns the most recent entries.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'To search for specific text, use team_search (or search_entries) instead.',
                recoverable: true
            }};
        }
        if (obj['keep'] !== undefined && obj['limit'] === undefined) {
            obj['limit'] = obj['keep'];
            delete obj['keep'];
        }
    }

    // team_list_tags hallucination: passing `q` or `query`
    const listTagsMethods = ['list_tags', 'listTags', 'team_list_tags', 'teamListTags'];
    if (listTagsMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined || obj['path'] !== undefined || obj['mode'] !== undefined || obj['keep'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support search queries, path, mode, or keep. It returns all tags.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove these parameters.',
                recoverable: true
            }};
        }
    }

    // team_create_entry hallucination: text/message/description
    const createMethods = ['create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry'];
    if (createMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['text'] !== undefined && obj['content'] === undefined) {
            obj['content'] = obj['text'];
            delete obj['text'];
        }
        if (obj['message'] !== undefined && obj['content'] === undefined) {
            obj['content'] = obj['message'];
            delete obj['message'];
        }
        if (obj['description'] !== undefined && obj['content'] === undefined) {
            obj['content'] = obj['description'];
            delete obj['description'];
        }
        // auto_context: objects are silently stringified (agents may pass a plain object);
        // valid JSON strings pass through unchanged; other types are rejected with an actionable error.
        if (obj['auto_context'] !== undefined) {
            if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null) {
                try {
                    obj['auto_context'] = JSON.stringify(obj['auto_context']);
                } catch {
                    return { error: {
                        success: false,
                        error: `${methodName}: auto_context could not be serialized to JSON. Ensure it is a plain object (e.g. { commits: ['<sha>'] }) or a valid JSON string.`,
                        code: 'VALIDATION_ERROR',
                        category: 'validation',
                        suggestion: 'Pass auto_context as either a JSON string (e.g. JSON.stringify({ commits: [sha] })) or a plain serializable object.',
                        recoverable: true
                    }};
                }
            } else if (typeof obj['auto_context'] !== 'string') {
                return { error: {
                    success: false,
                    error: `${methodName}: auto_context must be a JSON string or plain object (received ${typeof obj['auto_context']}).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Pass auto_context as a JSON string, e.g. JSON.stringify({ commits: ["<sha>"] }), or as a plain object like { commits: ["<sha>"] }.',
                    recoverable: true
                }};
            }
            // typeof string: passes through unchanged
        }
        if (obj['q'] !== undefined || obj['query'] !== undefined || obj['path'] !== undefined || obj['mode'] !== undefined || obj['keep'] !== undefined || obj['search'] !== undefined) {
            return { error: {
                success: false,
                error: `${methodName} does not support q, query, search, path, mode, or keep parameters. It creates a new journal entry.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove these parameters. Ensure you are providing the "content" of the entry.',
                recoverable: true
            }};
        }
    }

    // test_simple & test_error_handling hallucination: passing text/description instead of message
    if ((methodName === 'test_simple' || methodName === 'testSimple' || methodName === 'test_error_handling' || methodName === 'testErrorHandling') && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        if (obj['text'] !== undefined && obj['message'] === undefined) {
            obj['message'] = obj['text'];
            delete obj['text'];
        }
        if (obj['description'] !== undefined && obj['message'] === undefined) {
            obj['message'] = obj['description'];
            delete obj['description'];
        }
        if (obj['type'] !== undefined && obj['error_type'] === undefined && (methodName === 'test_error_handling' || methodName === 'testErrorHandling')) {
            obj['error_type'] = obj['type'];
            delete obj['type'];
        }
    }

    // merge_tags hallucination: passing `source_tags` or `from`/`to` or comma-separated tags
    if (methodName === 'merge_tags' || methodName === 'mergeTags' || methodName === 'team_merge_tags' || methodName === 'teamMergeTags') {
        if (args.length === 1 && isRecord(args[0])) {
            const obj = { ...args[0] };
        args[0] = obj; // We clone it below
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

    // search_audit_log hallucination: passing `limit` as a string or using `keep` instead of `limit`
    if (methodName === 'search_audit_log' || methodName === 'searchAuditLog') {
        if (args.length === 1 && isRecord(args[0])) {
            const obj = { ...args[0] };
        args[0] = obj; // We clone it below
            if (obj['keep'] !== undefined && obj['limit'] === undefined) {
                obj['limit'] = obj['keep'];
                delete obj['keep'];
            }
            if (typeof obj['limit'] === 'string') {
                const parsed = parseInt(obj['limit'], 10);
                if (!isNaN(parsed)) obj['limit'] = parsed;
            }
        }
    }

    // rebuild_vector_index hallucination: passing a boolean or string instead of object
    if (methodName === 'rebuild_vector_index' || methodName === 'rebuildVectorIndex' || methodName === 'team_rebuild_vector_index' || methodName === 'teamRebuildVectorIndex') {
        if (args.length === 1 && (typeof args[0] === 'boolean' || typeof args[0] === 'string')) {
            args[0] = {};
        }
    }

    // team member tools hallucination: path/target/user -> author, keep/mode -> role
    const memberMethods = ['team_add_member', 'teamAddMember', 'team_update_member_role', 'teamUpdateMemberRole', 'team_remove_member', 'teamRemoveMember', 'team_get_member', 'teamGetMember'];
    if (memberMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        for (const key of ['path', 'target', 'user', 'name', 'account', 'username', 'member']) {
            if (obj[key] !== undefined && obj['author'] === undefined) {
                obj['author'] = obj[key];
                Reflect.deleteProperty(obj, key);
            }
        }
        for (const key of ['keep', 'mode', 'type', 'level', 'permission']) {
            if (obj[key] !== undefined && obj['role'] === undefined) {
                obj['role'] = obj[key];
                Reflect.deleteProperty(obj, key);
            }
        }
    }

    // team alias tools hallucination: text/message/name -> alias, target/to/author -> canonical_author
    const aliasMethods = ['team_add_author_alias', 'teamAddAuthorAlias', 'team_remove_author_alias', 'teamRemoveAuthorAlias', 'team_list_author_aliases', 'teamListAuthorAliases', 'team_resolve_author', 'teamResolveAuthor', 'team_consolidate_authors', 'teamConsolidateAuthors'];
    if (aliasMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        
        for (const key of ['q', 'query', 'search']) {
            if (obj[key] !== undefined) {
                if (obj['canonical_author'] === undefined && obj['author'] === undefined && obj['alias'] === undefined) {
                    obj['canonical_author'] = obj[key];
                    obj['author'] = obj[key];
                    obj['alias'] = obj[key];
                }
                Reflect.deleteProperty(obj, key);
            }
        }
        for (const key of ['text', 'message', 'description', 'name', 'from', 'source']) {
            if (obj[key] !== undefined && obj['alias'] === undefined) {
                obj['alias'] = obj[key];
                Reflect.deleteProperty(obj, key);
            }
        }
        for (const key of ['target', 'to', 'canonical', 'dest']) {
            if (obj[key] !== undefined && obj['canonical_author'] === undefined) {
                obj['canonical_author'] = obj[key];
                Reflect.deleteProperty(obj, key);
            }
        }
        if (obj['author'] !== undefined && obj['canonical_author'] === undefined && obj['alias'] === undefined) {
            obj['canonical_author'] = obj['author'];
        }
    }


    // update_configuration hallucination: trying to change maxTokens or temperature
    if (methodName === 'update_configuration' || methodName === 'updateConfiguration') {
        if (args.length === 1 && isRecord(args[0])) {
            const obj = { ...args[0] };
        args[0] = obj; // We clone it below
            const hasContextParam = ['maxTokens', 'max_tokens', 'temperature', 'top_p', 'topP'].find(k => k in obj);
            if (hasContextParam) {
                return {
                    error: {
                        success: false,
                        error: `Unrecognized key: "${hasContextParam}". update_configuration does not support changing LLM context parameters.`,
                        code: "VALIDATION_ERROR",
                        category: "validation",
                        suggestion: `Remove '${hasContextParam}' from the payload. Only tool_filter and briefing preferences are supported.`,
                        recoverable: false
                    }
                };
            }
        }
    }

    // Session Summary Hallucination Healing
    const sessionSummaryMethods = ['create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry', 'update_entry', 'updateEntry', 'team_update_entry', 'teamUpdateEntry'];
    if (sessionSummaryMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj; // We clone it below
        const tags = obj['tags'] as string[] | undefined;
        const entryType = obj['entry_type'] as string | undefined;
        
        if (typeof obj['content'] === 'string' && (tags?.includes('session-summary') || entryType === 'retrospective')) {
            let content = obj['content'];
            
            // Normalize mangled headers
            content = content.replace(/^#+\s+(?:Accomplishments|Completed|Done|What I did|What we did)\s*$/gim, '## Accomplished');
            content = content.replace(/^#+\s+(?:Blockers|Unfinished|Unfinished\/?Blocked|Blocked)\s*$/gim, '## Unfinished / Blocked');
            content = content.replace(/^#+\s+(?:Next Session|Context|Next steps)\s*$/gim, '## Context for Next Session');
            
            // Strip duplicate empty sections
            content = content.replace(/(?:^#+\s+Accomplished\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Accomplished\n- None.\n');
            content = content.replace(/(?:^#+\s+Unfinished \/ Blocked\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Unfinished / Blocked\n- None.\n');
            content = content.replace(/(?:^#+\s+Context for Next Session\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Context for Next Session\n- None.\n');
            content = content.replace(/(?:^#+\s+Commits\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Commits\n- None.\n');
            
            // Remove subsequent heading text if duplicates still exist
            const deduplicate = (str: string, headerRegexStr: string): string => {
                let count = 0;
                return str.replace(new RegExp(headerRegexStr, 'gim'), (match) => {
                    count++;
                    return count === 1 ? match : '';
                });
            };
            content = deduplicate(content, '^#+\\s+Accomplished');
            content = deduplicate(content, '^#+\\s+Unfinished \\/ Blocked');
            content = deduplicate(content, '^#+\\s+Context for Next Session');
            content = deduplicate(content, '^#+\\s+Commits');
            
            // Append missing headers
            const hasAccomplished = /#+\s+Accomplished/i.test(content);
            const hasUnfinished = /#+\s+Unfinished \/ Blocked/i.test(content);
            const hasContext = /#+\s+Context for Next Session/i.test(content);
            const hasCommits = /#+\s+Commits/i.test(content);
            
            if (!hasAccomplished) content += '\n\n## Accomplished\n- \n';
            if (!hasUnfinished) content += '\n\n## Unfinished / Blocked\n- None\n';
            if (!hasContext) content += '\n\n## Context for Next Session\n- \n';
            if (!hasCommits) content += '\n\n## Commits\n- None\n';
            
            obj['content'] = content.trim();
        }
    }

    return { args };
}
