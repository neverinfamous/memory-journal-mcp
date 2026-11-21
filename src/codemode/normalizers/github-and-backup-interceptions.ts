import { isRecord } from './shared-utils.js'

const GITHUB_METHODS: ReadonlySet<string> = new Set([
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
])

const BACKUP_METHODS: ReadonlySet<string> = new Set([
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
    'team_restore_backup',
    'teamRestoreBackup',
    'cleanup_backups',
    'cleanupBackups',
    'team_cleanup_backups',
    'teamCleanupBackups',
])

const SINGULAR_MILESTONE_METHODS: ReadonlySet<string> = new Set([
    'get_github_milestone',
    'getGithubMilestone',
    'update_github_milestone',
    'updateGithubMilestone',
    'delete_github_milestone',
    'deleteGithubMilestone',
])

export function applyGithubAndBackupInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (GITHUB_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const ghRes = applyGithubInterceptions(methodName, args[0])
        if ('error' in ghRes) return ghRes
        args[0] = ghRes.obj
    }

    if (BACKUP_METHODS.has(methodName) && args.length === 1 && isRecord(args[0])) {
        const bkRes = applyBackupInterceptions(methodName, args[0])
        if ('error' in bkRes) return bkRes
        args[0] = bkRes.obj
    }

    return { args }
}

function methodLeaf(methodName: string): string {
    const splitAt = Math.max(methodName.lastIndexOf('.'), methodName.lastIndexOf('/'))
    return splitAt === -1 ? methodName : methodName.slice(splitAt + 1)
}

function leafEquals(methodName: string, names: readonly string[]): boolean {
    return names.includes(methodLeaf(methodName))
}

function mapGithubTextKeys(methodName: string, obj: Record<string, unknown>): void {
    const isCreateIssue = leafEquals(methodName, [
        'create_github_issue',
        'createGithubIssue',
        'create_github_issue_with_entry',
        'createGithubIssueWithEntry',
    ])
    const isMilestoneWrite = leafEquals(methodName, [
        'create_github_milestone',
        'createGithubMilestone',
        'update_github_milestone',
        'updateGithubMilestone',
    ])
    const isCloseIssue = leafEquals(methodName, [
        'close_github_issue',
        'closeGithubIssue',
        'close_github_issue_with_entry',
        'closeGithubIssueWithEntry',
    ])

    for (const key of ['text', 'message', 'description'] as const) {
        if (obj[key] === undefined) continue
        if (isCreateIssue) {
            if (obj['journal_content'] !== undefined) {
                if (obj['entry_content'] === undefined) {
                    obj['entry_content'] = obj['journal_content']
                }
                Reflect.deleteProperty(obj, 'journal_content')
            }
            if (obj['body'] === undefined) {
                obj['body'] = obj[key]
                Reflect.deleteProperty(obj, key)
            }
        } else if (isMilestoneWrite) {
            if (key !== 'description' && obj['title'] === undefined) {
                obj['title'] = obj[key]
                Reflect.deleteProperty(obj, key)
            }
        } else if (isCloseIssue) {
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

function mapKanbanAndMilestoneKeepAliases(methodName: string, obj: Record<string, unknown>): void {
    if (methodName === 'get_kanban_board' || methodName === 'getKanbanBoard') {
        for (const k of ['keep', 'path']) {
            if (obj[k] !== undefined && obj['project_number'] === undefined) {
                obj['project_number'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }
    if (methodName === 'move_kanban_item' || methodName === 'moveKanbanItem') {
        if (obj['keep'] !== undefined && obj['item_id'] === undefined) {
            obj['item_id'] = obj['keep']
            delete obj['keep']
        }
        if (obj['path'] !== undefined && obj['target_status'] === undefined) {
            obj['target_status'] = obj['path']
            delete obj['path']
        }
    }
    if (methodName === 'add_kanban_item' || methodName === 'addKanbanItem') {
        if (obj['keep'] !== undefined && obj['issue_number'] === undefined) {
            obj['issue_number'] = obj['keep']
            delete obj['keep']
        }
    }
    if (methodName === 'delete_kanban_item' || methodName === 'deleteKanbanItem') {
        if (obj['keep'] !== undefined && obj['item_id'] === undefined) {
            obj['item_id'] = obj['keep']
            delete obj['keep']
        }
    }
    if (
        SINGULAR_MILESTONE_METHODS.has(methodName) &&
        obj['keep'] !== undefined &&
        obj['milestone_number'] === undefined
    ) {
        obj['milestone_number'] = obj['keep']
        delete obj['keep']
    }
}

function splitOwnerRepoSlug(obj: Record<string, unknown>): void {
    if (typeof obj['repo'] !== 'string' || !obj['repo'].includes('/') || obj['repo'].includes('\\')) return
    const parts = obj['repo'].trim().split('/')
    const isSlug =
        parts.length === 2 &&
        Boolean(parts[0]) &&
        Boolean(parts[1]) &&
        parts[0] !== '.' &&
        parts[0] !== '..' &&
        !/^[a-zA-Z]:$/.test(parts[0] ?? '')
    if (isSlug && parts[0] && parts[1]) {
        if (obj['owner'] === undefined) obj['owner'] = parts[0]
        obj['repo'] = parts[1].replace(/\.git$/i, '')
    }
}

function applyGithubInterceptions(
    methodName: string,
    rawObj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    const obj = { ...rawObj }

    if (obj['repo'] === undefined && obj['repo_name'] !== undefined) {
        obj['repo'] = obj['repo_name']
        delete obj['repo_name']
    }

    splitOwnerRepoSlug(obj)
    mapGithubTextKeys(methodName, obj)

    const hasStateParam = leafEquals(methodName, [
        'get_github_issues',
        'getGithubIssues',
        'get_github_prs',
        'getGithubPrs',
        'get_github_milestones',
        'getGithubMilestones',
    ])
    if (hasStateParam && obj['keep'] !== undefined && obj['state'] === undefined) {
        if (obj['keep'] === true) obj['state'] = 'open'
        else if (obj['keep'] === false) obj['state'] = 'closed'
        else if (typeof obj['keep'] === 'string') obj['state'] = obj['keep']
        delete obj['keep']
    }

    mapKanbanAndMilestoneKeepAliases(methodName, obj)

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

    if (leafEquals(methodName, ['get_github_context', 'getGithubContext']) && obj['path'] !== undefined) {
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

    if (['backup_journal', 'backupJournal', 'team_backup', 'teamBackup'].includes(methodName)) {
        if (obj['name'] === undefined) {
            for (const k of ['description', 'message', 'text', 'path', 'q', 'keep', 'mode']) {
                if (obj[k] !== undefined && obj['name'] === undefined) obj['name'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }

    if (['list_backups', 'listBackups', 'team_list_backups', 'teamListBackups'].includes(methodName)) {
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

    if (['restore_backup', 'restoreBackup', 'team_restore_backup', 'teamRestoreBackup'].includes(methodName)) {
        if (obj['filename'] === undefined) {
            for (const k of ['path', 'file', 'text', 'message', 'description', 'q', 'keep', 'mode']) {
                if (obj[k] !== undefined && obj['filename'] === undefined) obj['filename'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }

    if (['cleanup_backups', 'cleanupBackups', 'team_cleanup_backups', 'teamCleanupBackups'].includes(methodName)) {
        if (obj['keep_count'] === undefined) {
            for (const k of ['keep', 'limit', 'q', 'mode', 'text', 'message', 'description', 'path']) {
                if (obj[k] !== undefined && obj['keep_count'] === undefined) obj['keep_count'] = obj[k]
                Reflect.deleteProperty(obj, k)
            }
        }
    }

    return { obj }
}
