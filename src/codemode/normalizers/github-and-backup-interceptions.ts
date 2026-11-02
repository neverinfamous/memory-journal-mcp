import { isRecord } from './shared-utils.js'

const GITHUB_METHODS = [
    'get_github_issues',
    'getGithubIssues',
    'get_github_prs',
    'getGithubPrs',
    'get_github_issue',
    'getGithubIssue',
    'get_github_pr',
    'getGithubPr',
    'get_github_context',
    'getGithubContext',
    'get_kanban_board',
    'getKanbanBoard',
    'move_kanban_item',
    'moveKanbanItem',
    'add_kanban_item',
    'addKanbanItem',
    'delete_kanban_item',
    'deleteKanbanItem',
    'create_github_issue_with_entry',
    'createGithubIssueWithEntry',
    'close_github_issue_with_entry',
    'closeGithubIssueWithEntry',
    'get_github_milestones',
    'getGithubMilestones',
    'get_github_milestone',
    'getGithubMilestone',
    'create_github_milestone',
    'createGithubMilestone',
    'update_github_milestone',
    'updateGithubMilestone',
    'delete_github_milestone',
    'deleteGithubMilestone',
    'get_repo_insights',
    'getRepoInsights',
    'get_copilot_reviews',
    'getCopilotReviews',
]

const BACKUP_METHODS = [
    'backup_journal',
    'backupJournal',
    'team_backup',
    'teamBackup',
    'list_backups',
    'listBackups',
    'team_list_backups',
    'teamListBackups',
    'restore_backup',
    'restoreBackup',
    'cleanup_backups',
    'cleanupBackups',
]

export function applyGithubAndBackupInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (GITHUB_METHODS.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const ghRes = applyGithubInterceptions(methodName, args[0])
        if ('error' in ghRes) return ghRes
        args[0] = ghRes.obj
    }

    if (BACKUP_METHODS.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const bkRes = applyBackupInterceptions(methodName, args[0])
        if ('error' in bkRes) return bkRes
        args[0] = bkRes.obj
    }

    return { args }
}

function applyGithubInterceptions(
    methodName: string,
    rawObj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    const obj = { ...rawObj }

    for (const key of ['text', 'message', 'description'] as const) {
        if (obj[key] !== undefined) {
            if (methodName.includes('create_github_issue') || methodName.includes('createGithubIssue')) {
                if (obj['body'] === undefined) {
                    obj['body'] = obj[key]
                    Reflect.deleteProperty(obj, key)
                }
            } else if (
                methodName.includes('create_github_milestone') ||
                methodName.includes('createGithubMilestone') ||
                methodName.includes('update_github_milestone') ||
                methodName.includes('updateGithubMilestone')
            ) {
                if (obj['title'] === undefined) {
                    obj['title'] = obj[key]
                    Reflect.deleteProperty(obj, key)
                }
            } else if (methodName.includes('close_github_issue') || methodName.includes('closeGithubIssue')) {
                if (obj['comment'] === undefined && key !== 'description') {
                    obj['comment'] = obj[key]
                    Reflect.deleteProperty(obj, key)
                } else if (obj['resolution_notes'] === undefined && key === 'description') {
                    obj['resolution_notes'] = obj[key]
                    delete obj['description']
                }
            }
        }
    }

    const hasStateParam =
        methodName.includes('get_github_issues') ||
        methodName.includes('getGithubIssues') ||
        methodName.includes('get_github_prs') ||
        methodName.includes('getGithubPrs') ||
        methodName.includes('get_github_milestones') ||
        methodName.includes('getGithubMilestones')
    if (hasStateParam && obj['keep'] !== undefined && obj['state'] === undefined) {
        if (obj['keep'] === true) obj['state'] = 'open'
        else if (obj['keep'] === false) obj['state'] = 'closed'
        else if (typeof obj['keep'] === 'string') obj['state'] = obj['keep']
        delete obj['keep']
    }

    if (methodName.includes('get_kanban_board') || methodName.includes('getKanbanBoard')) {
        for (const k of ['keep', 'path']) {
            if (obj[k] !== undefined && obj['project_number'] === undefined) {
                obj['project_number'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }
    if (methodName.includes('move_kanban_item') || methodName.includes('moveKanbanItem')) {
        if (obj['keep'] !== undefined && obj['item_id'] === undefined) {
            obj['item_id'] = obj['keep']
            delete obj['keep']
        }
        if (obj['path'] !== undefined && obj['target_status'] === undefined) {
            obj['target_status'] = obj['path']
            delete obj['path']
        }
    }
    if (methodName.includes('add_kanban_item') || methodName.includes('addKanbanItem')) {
        if (obj['keep'] !== undefined && obj['issue_number'] === undefined) {
            obj['issue_number'] = obj['keep']
            delete obj['keep']
        }
    }
    if (methodName.includes('delete_kanban_item') || methodName.includes('deleteKanbanItem')) {
        if (obj['keep'] !== undefined && obj['item_id'] === undefined) {
            obj['item_id'] = obj['keep']
            delete obj['keep']
        }
    }
    if (
        methodName.includes('get_github_milestone') ||
        methodName.includes('getGithubMilestone') ||
        methodName.includes('update_github_milestone') ||
        methodName.includes('updateGithubMilestone') ||
        methodName.includes('delete_github_milestone') ||
        methodName.includes('deleteGithubMilestone')
    ) {
        if (obj['keep'] !== undefined && obj['milestone_number'] === undefined) {
            obj['milestone_number'] = obj['keep']
            delete obj['keep']
        }
    }

    if (obj['mode'] !== undefined && obj['summary_only'] === undefined) {
        obj['summary_only'] = obj['mode'] === 'summary'
        delete obj['mode']
    }

    if (hasStateParam && (obj['q'] !== undefined || obj['query'] !== undefined || obj['search'] !== undefined)) {
        return {
            error: {
                success: false,
                error: `${methodName} does not support search queries (q/query/search). It only supports listing by state (open/closed).`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the query parameter to list items, or use GitHub directly for complex searches.',
                recoverable: true,
            },
        }
    }

    if ((methodName.includes('get_github_context') || methodName.includes('getGithubContext')) && obj['path'] !== undefined) {
        return {
            error: {
                success: false,
                error: "get_github_context does not take a 'path' parameter. It returns repository-wide context.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Remove the path parameter.',
                recoverable: true,
            },
        }
    }

    return { obj }
}

function applyBackupInterceptions(
    methodName: string,
    rawObj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    const obj = { ...rawObj }

    if (
        methodName.includes('backup_journal') ||
        methodName.includes('backupJournal') ||
        methodName.includes('team_backup') ||
        methodName.includes('teamBackup')
    ) {
        if (obj['name'] === undefined) {
            for (const k of ['description', 'message', 'text', 'path', 'q', 'keep', 'mode']) {
                if (obj[k] !== undefined && obj['name'] === undefined) obj['name'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }

    if (
        methodName.includes('list_backups') ||
        methodName.includes('listBackups') ||
        methodName.includes('team_list_backups') ||
        methodName.includes('teamListBackups')
    ) {
        if (
            obj['q'] !== undefined ||
            obj['query'] !== undefined ||
            obj['search'] !== undefined ||
            obj['text'] !== undefined ||
            obj['message'] !== undefined ||
            obj['description'] !== undefined ||
            obj['path'] !== undefined ||
            obj['keep'] !== undefined ||
            obj['mode'] !== undefined
        ) {
            return {
                error: {
                    success: false,
                    error: 'list_backups does not support search queries or other parameters. It lists all available backups.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove these parameters.',
                    recoverable: true,
                },
            }
        }
        if (obj['limit'] !== undefined) {
            return {
                error: {
                    success: false,
                    error: 'list_backups does not support a limit parameter.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Remove the limit parameter.',
                    recoverable: true,
                },
            }
        }
    }

    if (methodName.includes('restore_backup') || methodName.includes('restoreBackup')) {
        if (obj['filename'] === undefined) {
            for (const k of ['path', 'file', 'text', 'message', 'description', 'q', 'keep', 'mode']) {
                if (obj[k] !== undefined && obj['filename'] === undefined) obj['filename'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }

    if (methodName.includes('cleanup_backups') || methodName.includes('cleanupBackups')) {
        if (obj['keep_count'] === undefined) {
            for (const k of ['keep', 'limit', 'q', 'mode', 'text', 'message', 'description', 'path']) {
                if (obj[k] !== undefined && obj['keep_count'] === undefined) obj['keep_count'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }

    return { obj }
}
