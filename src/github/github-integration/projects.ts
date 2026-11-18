import { logger } from '../../utils/logger.js'
import type { GitHubClient } from './client.js'
import { groupItemsIntoColumns, type ProjectV2Data } from './kanban-columns.js'
import type { KanbanBoard, ProjectV2StatusOption } from '../../types/index.js'

interface UserProjectResponse {
    user: { projectV2: ProjectV2Data | null } | null
}
interface RepoProjectResponse {
    repository: { projectV2: ProjectV2Data | null } | null
}
interface OrgProjectResponse {
    organization: { projectV2: ProjectV2Data | null } | null
}

function projectLookupMiss(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /not found|could not resolve|could not be found/i.test(message)
}

const PROJECT_DATA_FRAGMENT = `
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
        items(first: $itemLimit) {
            pageInfo {
                hasNextPage
            }
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

const USER_PROJECT_QUERY = `
    ${PROJECT_DATA_FRAGMENT}
    query($owner: String!, $number: Int!, $itemLimit: Int!) {
        user(login: $owner) {
            projectV2(number: $number) {
                ...ProjectData
            }
        }
    }
`

const REPO_PROJECT_QUERY = `
    ${PROJECT_DATA_FRAGMENT}
    query($owner: String!, $repo: String!, $number: Int!, $itemLimit: Int!) {
        repository(owner: $owner, name: $repo) {
            projectV2(number: $number) {
                ...ProjectData
            }
        }
    }
`

const ORG_PROJECT_QUERY = `
    ${PROJECT_DATA_FRAGMENT}
    query($owner: String!, $number: Int!, $itemLimit: Int!) {
        organization(login: $owner) {
            projectV2(number: $number) {
                ...ProjectData
            }
        }
    }
`

type ProjectSourceKind = 'user' | 'repository' | 'organization'
const MAX_PROJECT_SOURCE_CACHE = 128

export class ProjectsManager {
    private readonly projectSourceCache = new Map<string, ProjectSourceKind>()

    constructor(private client: GitHubClient) {}

    private rememberProjectSource(cacheKey: string, source: ProjectSourceKind): void {
        if (this.projectSourceCache.has(cacheKey)) {
            this.projectSourceCache.delete(cacheKey)
        } else if (this.projectSourceCache.size >= MAX_PROJECT_SOURCE_CACHE) {
            const oldestKey = this.projectSourceCache.keys().next().value
            if (oldestKey !== undefined) this.projectSourceCache.delete(oldestKey)
        }
        this.projectSourceCache.set(cacheKey, source)
    }

    private async probeProjectSource(
        source: ProjectSourceKind,
        owner: string,
        projectNumber: number,
        repo?: string,
        abortSignal?: AbortSignal
    ): Promise<ProjectV2Data | null> {
        const graphql = this.client.graphqlWithAuth
        if (!graphql) return null
        if (source === 'user') {
            const response = await graphql<UserProjectResponse>(USER_PROJECT_QUERY, {
                owner,
                number: projectNumber,
                itemLimit: 100,
                request: { signal: abortSignal },
            })
            return response.user?.projectV2 ?? null
        }
        if (source === 'repository') {
            if (!repo) return null
            const response = await graphql<RepoProjectResponse>(REPO_PROJECT_QUERY, {
                owner,
                repo,
                number: projectNumber,
                itemLimit: 100,
                request: { signal: abortSignal },
            })
            return response.repository?.projectV2 ?? null
        }
        const response = await graphql<OrgProjectResponse>(ORG_PROJECT_QUERY, {
            owner,
            number: projectNumber,
            itemLimit: 100,
            request: { signal: abortSignal },
        })
        return response.organization?.projectV2 ?? null
    }

    private async fetchProjectV2FromSources(
        owner: string,
        projectNumber: number,
        repo?: string,
        abortSignal?: AbortSignal
    ): Promise<{ project: ProjectV2Data | null; source: string }> {
        if (!this.client.graphqlWithAuth) return { project: null, source: '' }

        const cacheKey = `${owner}:${String(projectNumber)}:${repo ?? ''}`
        const defaultOrder: ProjectSourceKind[] = repo
            ? ['user', 'repository', 'organization']
            : ['user', 'organization']
        const cachedSource = this.projectSourceCache.get(cacheKey)
        const probeOrder: ProjectSourceKind[] =
            cachedSource !== undefined && defaultOrder.includes(cachedSource)
                ? [cachedSource, ...defaultOrder.filter((s) => s !== cachedSource)]
                : defaultOrder

        for (const source of probeOrder) {
            try {
                const project = await this.probeProjectSource(
                    source,
                    owner,
                    projectNumber,
                    repo,
                    abortSignal
                )
                if (project) {
                    this.rememberProjectSource(cacheKey, source)
                    return { project, source }
                }
            } catch (error) {
                if (!projectLookupMiss(error)) throw error
                logger.debug(`${source} project not found, trying next source...`, {
                    module: 'GitHub',
                })
            }
        }

        return { project: null, source: '' }
    }

    async getProjectKanban(
        owner: string,
        projectNumber: number,
        repo?: string,
        abortSignal?: AbortSignal
    ): Promise<KanbanBoard | null> {
        if (!this.client.graphqlWithAuth) {
            logger.debug('GraphQL not available - no token', { module: 'GitHub' })
            throw new Error('GitHub API not available')
        }

        const cacheKey = `kanban:${owner}:${String(projectNumber)}:${repo ?? ''}`
        if (typeof this.client.getCached === 'function') {
            const cached = this.client.getCached(cacheKey) as KanbanBoard | undefined
            if (cached !== undefined) return cached
        }

        const { project, source } = await this.fetchProjectV2FromSources(
            owner,
            projectNumber,
            repo,
            abortSignal
        )

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

        const columns = groupItemsIntoColumns(statusOptions, project.items.nodes)

        const totalItems = project.items.nodes.length
        const truncated = project.items.pageInfo?.hasNextPage ?? false

        logger.info('Fetched Kanban board', {
            module: 'GitHub',
            entityId: projectNumber,
            context: { columns: columns.length, items: totalItems, source, truncated },
        })

        const board: KanbanBoard = {
            projectId: project.id,
            projectNumber,
            projectTitle: project.title,
            statusFieldId: statusField.id,
            statusOptions,
            columns,
            totalItems,
            truncated,
        }

        if (typeof this.client.setCache === 'function') {
            this.client.setCache(cacheKey, board)
        }

        return board
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

            if (typeof this.client.invalidateCache === 'function') {
                this.client.invalidateCache('kanban:')
            }

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
            if (typeof this.client.invalidateCache === 'function') {
                this.client.invalidateCache('kanban:')
            }
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

            if (typeof this.client.invalidateCache === 'function') {
                this.client.invalidateCache('kanban:')
            }

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

            if (typeof itemId !== 'string' || itemId.length === 0) {
                return { success: false, error: 'GitHub did not return a project item id' }
            }
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
            if (typeof this.client.invalidateCache === 'function') {
                this.client.invalidateCache('kanban:')
            }
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
            const mutation =
                'mutation($projectId: ID!, $itemId: ID!) { deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId } }'
            if (typeof this.client.invalidateCache === 'function') {
                this.client.invalidateCache('kanban:')
            }
            await this.client.graphqlWithAuth(mutation, { projectId, itemId })
            logger.info('Deleted project item', { module: 'GitHub', context: { projectId, itemId } })
            return { success: true }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to delete item from project', { module: 'GitHub', context: { projectId, itemId }, error: errorMessage })
            return { success: false, error: errorMessage }
        } finally {
            if (typeof this.client.invalidateCache === 'function') this.client.invalidateCache('kanban:')
        }
    }
}
