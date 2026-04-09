import { logger } from '../../utils/logger.js'
import type { GitHubClient } from './client.js'
import type {
    KanbanBoard,
    KanbanColumn,
    ProjectV2Item,
    ProjectV2StatusOption,
} from '../../types/index.js'

export class ProjectsManager {
    constructor(private client: GitHubClient) {}

    async getProjectKanban(
        owner: string,
        projectNumber: number,
        repo?: string
    ): Promise<KanbanBoard | null> {
        if (!this.client.graphqlWithAuth) {
            logger.debug('GraphQL not available - no token', { module: 'GitHub' })
            return null
        }

        const projectFragment = `
            fragment ProjectData on ProjectV2 {
                id
                title
                fields(first: 20) {
                    nodes {
                        ... on ProjectV2SingleSelectField {
                            id
                            name
                            options {
                                id
                                name
                                color
                            }
                        }
                    }
                }
                items(first: 100) {
                    nodes {
                        id
                        type
                        createdAt
                        updatedAt
                        fieldValues(first: 10) {
                            nodes {
                                ... on ProjectV2ItemFieldSingleSelectValue {
                                    name
                                    field {
                                        ... on ProjectV2SingleSelectField {
                                            name
                                        }
                                    }
                                }
                            }
                        }
                        content {
                            ... on Issue {
                                number
                                title
                                url
                                labels(first: 5) {
                                    nodes { name }
                                }
                                assignees(first: 5) {
                                    nodes { login }
                                }
                            }
                            ... on PullRequest {
                                number
                                title
                                url
                                labels(first: 5) {
                                    nodes { name }
                                }
                                assignees(first: 5) {
                                    nodes { login }
                                }
                            }
                            ... on DraftIssue {
                                title
                            }
                        }
                    }
                }
            }
        `

        const userQuery = `
            ${projectFragment}
            query($owner: String!, $number: Int!) {
                user(login: $owner) {
                    projectV2(number: $number) {
                        ...ProjectData
                    }
                }
            }
        `

        const repoQuery = `
            ${projectFragment}
            query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    projectV2(number: $number) {
                        ...ProjectData
                    }
                }
            }
        `

        const orgQuery = `
            ${projectFragment}
            query($owner: String!, $number: Int!) {
                organization(login: $owner) {
                    projectV2(number: $number) {
                        ...ProjectData
                    }
                }
            }
        `

        interface ProjectV2Data {
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

        interface UserResponse {
            user: { projectV2: ProjectV2Data | null } | null
        }
        interface RepoResponse {
            repository: { projectV2: ProjectV2Data | null } | null
        }
        interface OrgResponse {
            organization: { projectV2: ProjectV2Data | null } | null
        }

        let project: ProjectV2Data | null = null
        let source = ''

        try {
            const response = await this.client.graphqlWithAuth<UserResponse>(userQuery, {
                owner,
                number: projectNumber,
            })
            if (response.user?.projectV2) {
                project = response.user.projectV2
                source = 'user'
            }
        } catch {
            logger.debug('User project not found, trying repository...', { module: 'GitHub' })
        }

        if (!project && repo) {
            try {
                const response = await this.client.graphqlWithAuth<RepoResponse>(repoQuery, {
                    owner,
                    repo,
                    number: projectNumber,
                })
                if (response.repository?.projectV2) {
                    project = response.repository.projectV2
                    source = 'repository'
                }
            } catch {
                logger.debug('Repository project not found, trying organization...', {
                    module: 'GitHub',
                })
            }
        }

        if (!project) {
            try {
                const response = await this.client.graphqlWithAuth<OrgResponse>(orgQuery, {
                    owner,
                    number: projectNumber,
                })
                if (response.organization?.projectV2) {
                    project = response.organization.projectV2
                    source = 'organization'
                }
            } catch {
                logger.debug('Organization project not found', { module: 'GitHub' })
            }
        }

        if (!project) {
            logger.warning('Project not found', { module: 'GitHub', entityId: projectNumber })
            return null
        }

        const statusField = project.fields.nodes.find(
            (f) => f.name === 'Status' && f.options !== undefined && f.options.length > 0
        )

        if (!statusField?.id || !statusField.options) {
            logger.warning('Status field not found in project', {
                module: 'GitHub',
                entityId: projectNumber,
            })
            return null
        }

        const statusOptions: ProjectV2StatusOption[] = statusField.options.map((opt) => ({
            id: opt.id,
            name: opt.name,
            color: opt.color,
        }))

        const columnMap = new Map<string, ProjectV2Item[]>()

        for (const opt of statusOptions) {
            columnMap.set(opt.name, [])
        }
        columnMap.set('No Status', [])

        for (const item of project.items.nodes) {
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
                labels: content?.labels?.nodes.map((l) => l.name) ?? [],
                assignees: content?.assignees?.nodes.map((a) => a.login) ?? [],
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            }

            const column = columnMap.get(status)
            if (column) {
                column.push(projectItem)
            } else {
                columnMap.get('No Status')?.push(projectItem)
            }
        }

        const columns: KanbanColumn[] = []
        for (const opt of statusOptions) {
            const items = columnMap.get(opt.name) ?? []
            columns.push({
                status: opt.name,
                statusOptionId: opt.id,
                items,
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

        const totalItems = project.items.nodes.length

        logger.info('Fetched Kanban board', {
            module: 'GitHub',
            entityId: projectNumber,
            context: { columns: columns.length, items: totalItems, source },
        })

        return {
            projectId: project.id,
            projectNumber,
            projectTitle: project.title,
            statusFieldId: statusField.id,
            statusOptions,
            columns,
            totalItems,
        }
    }

    async moveProjectItem(
        projectId: string,
        itemId: string,
        statusFieldId: string,
        statusOptionId: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.client.graphqlWithAuth) {
            return { success: false, error: 'GraphQL not available - no token' }
        }

        try {
            const mutation = `
                mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
                    updateProjectV2ItemFieldValue(
                        input: {
                            projectId: $projectId
                            itemId: $itemId
                            fieldId: $fieldId
                            value: { singleSelectOptionId: $optionId }
                        }
                    ) {
                        projectV2Item {
                            id
                        }
                    }
                }
            `

            await this.client.graphqlWithAuth(mutation, {
                projectId,
                itemId,
                fieldId: statusFieldId,
                optionId: statusOptionId,
            })

            logger.info('Moved project item', {
                module: 'GitHub',
                entityId: itemId,
                context: { targetStatus: statusOptionId },
            })

            return { success: true }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to move project item', {
                module: 'GitHub',
                entityId: itemId,
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        } finally {
            this.client.invalidateCache('kanban:')
        }
    }

    async addProjectItem(
        projectId: string,
        contentId: string
    ): Promise<{ success: boolean; itemId?: string; error?: string }> {
        if (!this.client.graphqlWithAuth) {
            return { success: false, error: 'GraphQL not available - no token' }
        }

        try {
            const mutation = `
                mutation($projectId: ID!, $contentId: ID!) {
                    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
                        item {
                            id
                        }
                    }
                }
            `

            const response = await this.client.graphqlWithAuth<{
                addProjectV2ItemById: { item: { id: string } }
            }>(mutation, {
                projectId,
                contentId,
            })

            const itemId = response.addProjectV2ItemById?.item?.id

            logger.info('Added item to project', {
                module: 'GitHub',
                context: { projectId, contentId, itemId },
            })

            return { success: true, itemId }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to add item to project', {
                module: 'GitHub',
                context: { projectId, contentId },
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        } finally {
            this.client.invalidateCache('kanban:')
        }
    }

    async deleteProjectItem(
        projectId: string,
        itemId: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.client.graphqlWithAuth) {
            return { success: false, error: 'GraphQL not available - no token' }
        }

        try {
            const mutation = `
                mutation($projectId: ID!, $itemId: ID!) {
                    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
                        deletedItemId
                    }
                }
            `

            await this.client.graphqlWithAuth(mutation, {
                projectId,
                itemId,
            })

            logger.info('Deleted project item', {
                module: 'GitHub',
                context: { projectId, itemId },
            })

            return { success: true }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to delete item from project', {
                module: 'GitHub',
                context: { projectId, itemId },
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        } finally {
            this.client.invalidateCache('kanban:')
        }
    }
}
