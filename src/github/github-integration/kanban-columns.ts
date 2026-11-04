import type { KanbanColumn, ProjectV2Item, ProjectV2StatusOption } from '../../types/index.js'

export interface ProjectV2Data {
    id: string
    title: string
    fields: {
        nodes: {
            id?: string
            name?: string
            options?: {
                id: string
                name: string
                color?: string
            }[]
        }[]
    }
    items: {
        pageInfo?: { hasNextPage: boolean }
        nodes: {
            id: string
            type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE'
            createdAt: string
            updatedAt: string
            fieldValues: {
                nodes: {
                    name?: string
                    field?: { name?: string }
                }[]
            }
            content: {
                number?: number
                title?: string
                url?: string
                labels?: { nodes: { name: string }[] }
                assignees?: { nodes: { login: string }[] }
            } | null
        }[]
    }
}

export function groupItemsIntoColumns(
    statusOptions: ProjectV2StatusOption[],
    items: ProjectV2Data['items']['nodes']
): KanbanColumn[] {
    const columnMap = new Map<string, ProjectV2Item[]>()
    for (const opt of statusOptions) {
        columnMap.set(opt.name, [])
    }
    columnMap.set('No Status', [])

    for (const item of items) {
        const statusValue = item.fieldValues.nodes.find((fv) => fv.field?.name === 'Status')
        const status = statusValue?.name ?? 'No Status'
        const content = item.content
        const projectItem: ProjectV2Item = {
            id: item.id,
            title: content?.title ?? 'Draft Issue',
            url: content?.url ?? '',
            type: item.type,
            status,
            number: content?.number,
            labels: content?.labels?.nodes.map((label) => label.name) ?? [],
            assignees: content?.assignees?.nodes.map((assignee) => assignee.login) ?? [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        }

        const column = columnMap.get(status)
        if (column !== undefined) {
            column.push(projectItem)
        } else {
            columnMap.get('No Status')?.push(projectItem)
        }
    }

    const columns: KanbanColumn[] = []
    for (const opt of statusOptions) {
        const columnItems = columnMap.get(opt.name) ?? []
        columns.push({
            status: opt.name,
            statusOptionId: opt.id,
            items: columnItems,
        })
    }

    const noStatusItems = columnMap.get('No Status') ?? []
    if (noStatusItems.length > 0) {
        columns.push({
            status: 'No Status',
            statusOptionId: '',
            items: noStatusItems,
        })
    }
    return columns
}
