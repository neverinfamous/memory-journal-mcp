/**
 * Memory Journal MCP Server - GitHub Integration
 * 
 * GitHub API integration using @octokit/rest for API access,
 * @octokit/graphql for Projects v2, and simple-git for local repository operations.
 */

import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import * as simpleGitImport from 'simple-git';
import { logger } from '../utils/logger.js';
import type {
    GitHubIssue,
    GitHubPullRequest,
    GitHubWorkflowRun,
    ProjectContext,
    KanbanBoard,
    KanbanColumn,
    ProjectV2Item,
    ProjectV2StatusOption,
} from '../types/index.js';

// Handle simpleGit ESM/CJS interop
type SimpleGitType = typeof simpleGitImport.simpleGit;
const simpleGit: SimpleGitType = simpleGitImport.simpleGit;

/**
 * Local repository information
 */
export interface RepoInfo {
    owner: string | null;
    repo: string | null;
    branch: string | null;
    remoteUrl: string | null;
}

/**
 * GitHub issue details (extended)
 */
export interface IssueDetails extends GitHubIssue {
    body: string | null;
    labels: string[];
    assignees: string[];
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    commentsCount: number;
}

/**
 * GitHub PR details (extended)
 */
export interface PullRequestDetails extends GitHubPullRequest {
    body: string | null;
    draft: boolean;
    headBranch: string;
    baseBranch: string;
    author: string;
    createdAt: string;
    updatedAt: string;
    mergedAt: string | null;
    closedAt: string | null;
    additions: number;
    deletions: number;
    changedFiles: number;
}

/**
 * GitHubIntegration - Handles GitHub API and local git operations
 */
export class GitHubIntegration {
    private octokit: Octokit | null = null;
    private graphqlWithAuth: typeof graphql | null = null;
    private git: simpleGitImport.SimpleGit;
    private readonly token: string | undefined;

    constructor(workingDir = '.') {
        this.token = process.env['GITHUB_TOKEN'];

        // Use GITHUB_REPO_PATH env var if set, otherwise fall back to workingDir
        const envRepoPath = process.env['GITHUB_REPO_PATH'];
        const effectiveDir = envRepoPath || workingDir;

        // Resolve and log the actual working directory
        const resolvedDir = effectiveDir === '.' ? process.cwd() : effectiveDir;
        logger.info('GitHub integration using directory', {
            module: 'GitHub',
            workingDir,
            envRepoPath: envRepoPath ?? 'not set',
            effectiveDir,
            resolvedDir,
            cwd: process.cwd()
        });

        this.git = simpleGit(effectiveDir);

        // Initialize Octokit and GraphQL if token is available
        if (this.token) {
            this.octokit = new Octokit({ auth: this.token });
            this.graphqlWithAuth = graphql.defaults({
                headers: { authorization: `token ${this.token}` },
            });
            logger.info('GitHub integration initialized with token', { module: 'GitHub' });
        } else {
            logger.info('GitHub integration initialized without token (limited functionality)', { module: 'GitHub' });
        }
    }

    /**
     * Check if GitHub API is available (token present)
     */
    isApiAvailable(): boolean {
        return this.octokit !== null;
    }

    /**
     * Get local repository information
     */
    async getRepoInfo(): Promise<RepoInfo> {
        try {
            // Get current branch
            const branchResult = await this.git.branch();
            const branch = branchResult.current || null;

            // Get remote URL
            const remotes = await this.git.getRemotes(true);
            const origin = remotes.find(r => r.name === 'origin');
            const remoteUrl = origin?.refs?.fetch || null;

            // Parse owner/repo from remote URL
            const { owner, repo } = this.parseRemoteUrl(remoteUrl);

            return { owner, repo, branch, remoteUrl };
        } catch (error) {
            logger.debug('Failed to get repo info (may not be a git repo)', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error)
            });
            return { owner: null, repo: null, branch: null, remoteUrl: null };
        }
    }

    /**
     * Parse owner and repo from GitHub remote URL
     */
    private parseRemoteUrl(remoteUrl: string | null): { owner: string | null; repo: string | null } {
        if (!remoteUrl) return { owner: null, repo: null };

        // Handle SSH format: git@github.com:owner/repo.git
        if (remoteUrl.startsWith('git@github.com:')) {
            const pathPart = remoteUrl.replace('git@github.com:', '').replace('.git', '');
            const parts = pathPart.split('/');
            if (parts.length >= 2) {
                return { owner: parts[0] ?? null, repo: parts[1] ?? null };
            }
        }

        // Handle HTTPS format: https://github.com/owner/repo.git
        try {
            const url = new URL(remoteUrl);
            if (url.hostname === 'github.com') {
                const path = url.pathname.replace('.git', '').replace(/^\//, '');
                const parts = path.split('/');
                if (parts.length >= 2) {
                    return { owner: parts[0] ?? null, repo: parts[1] ?? null };
                }
            }
        } catch {
            // Not a valid URL
        }

        return { owner: null, repo: null };
    }

    /**
     * Get repository issues
     */
    async getIssues(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubIssue[]> {
        if (!this.octokit) {
            return [];
        }

        try {
            const response = await this.octokit.issues.listForRepo({
                owner,
                repo,
                state,
                per_page: limit,
                sort: 'updated',
                direction: 'desc',
            });

            // Filter out pull requests (GitHub API includes PRs in issues)
            return response.data
                .filter(issue => !issue.pull_request)
                .map(issue => ({
                    number: issue.number,
                    title: issue.title,
                    url: issue.html_url,
                    state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
                }));
        } catch (error) {
            logger.error('Failed to get issues', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Get issue details
     */
    async getIssue(owner: string, repo: string, issueNumber: number): Promise<IssueDetails | null> {
        if (!this.octokit) {
            return null;
        }

        try {
            const response = await this.octokit.issues.get({
                owner,
                repo,
                issue_number: issueNumber,
            });

            const issue = response.data;

            // Verify it's not a PR
            if (issue.pull_request) {
                return null;
            }

            return {
                number: issue.number,
                title: issue.title,
                url: issue.html_url,
                state: issue.state === 'open' ? 'OPEN' : 'CLOSED',
                body: issue.body ?? null,
                labels: issue.labels.map(l => (typeof l === 'string' ? l : l.name ?? '')),
                assignees: issue.assignees?.map(a => a.login) ?? [],
                createdAt: issue.created_at,
                updatedAt: issue.updated_at,
                closedAt: issue.closed_at,
                commentsCount: issue.comments,
            };
        } catch (error) {
            logger.error('Failed to get issue details', {
                module: 'GitHub',
                entityId: issueNumber,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Get repository pull requests
     */
    async getPullRequests(
        owner: string,
        repo: string,
        state: 'open' | 'closed' | 'all' = 'open',
        limit = 20
    ): Promise<GitHubPullRequest[]> {
        if (!this.octokit) {
            return [];
        }

        try {
            const response = await this.octokit.pulls.list({
                owner,
                repo,
                state,
                per_page: limit,
                sort: 'updated',
                direction: 'desc',
            });

            return response.data.map(pr => ({
                number: pr.number,
                title: pr.title,
                url: pr.html_url,
                state: pr.merged_at ? 'MERGED' : (pr.state === 'open' ? 'OPEN' : 'CLOSED'),
            }));
        } catch (error) {
            logger.error('Failed to get pull requests', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Get PR details
     */
    async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequestDetails | null> {
        if (!this.octokit) {
            return null;
        }

        try {
            const response = await this.octokit.pulls.get({
                owner,
                repo,
                pull_number: prNumber,
            });

            const pr = response.data;

            return {
                number: pr.number,
                title: pr.title,
                url: pr.html_url,
                state: pr.merged_at ? 'MERGED' : (pr.state === 'open' ? 'OPEN' : 'CLOSED'),
                body: pr.body,
                draft: pr.draft ?? false,
                headBranch: pr.head.ref,
                baseBranch: pr.base.ref,
                author: pr.user?.login ?? 'unknown',
                createdAt: pr.created_at,
                updatedAt: pr.updated_at,
                mergedAt: pr.merged_at,
                closedAt: pr.closed_at,
                additions: pr.additions,
                deletions: pr.deletions,
                changedFiles: pr.changed_files,
            };
        } catch (error) {
            logger.error('Failed to get PR details', {
                module: 'GitHub',
                entityId: prNumber,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Get workflow runs from GitHub Actions
     */
    async getWorkflowRuns(
        owner: string,
        repo: string,
        limit = 10
    ): Promise<GitHubWorkflowRun[]> {
        if (!this.octokit) {
            logger.debug('GitHub API not available - no token', { module: 'GitHub' });
            return [];
        }

        try {
            const response = await this.octokit.rest.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                per_page: limit,
            });

            return response.data.workflow_runs.map(run => ({
                id: run.id,
                name: run.name ?? 'Unknown Workflow',
                status: run.status as 'queued' | 'in_progress' | 'completed',
                conclusion: run.conclusion as 'success' | 'failure' | 'cancelled' | 'skipped' | null,
                url: run.html_url,
                headBranch: run.head_branch ?? '',
                headSha: run.head_sha,
                createdAt: run.created_at,
                updatedAt: run.updated_at,
            }));
        } catch (error) {
            logger.error('Failed to get workflow runs', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Get full repository context (issues, PRs, branch info)
     */
    async getRepoContext(): Promise<ProjectContext> {
        const repoInfo = await this.getRepoInfo();

        const context: ProjectContext = {
            repoName: repoInfo.repo,
            branch: repoInfo.branch,
            commit: null,
            remoteUrl: repoInfo.remoteUrl,
            projects: [],
            issues: [],
            pullRequests: [],
            workflowRuns: [],
        };

        // Get current commit
        try {
            const log = await this.git.log({ maxCount: 1 });
            context.commit = log.latest?.hash ?? null;
        } catch {
            // Ignore error
        }

        // Get issues, PRs, and workflow runs if we have owner/repo
        if (repoInfo.owner && repoInfo.repo) {
            context.issues = await this.getIssues(repoInfo.owner, repoInfo.repo, 'open', 10);
            context.pullRequests = await this.getPullRequests(repoInfo.owner, repoInfo.repo, 'open', 10);
            context.workflowRuns = await this.getWorkflowRuns(repoInfo.owner, repoInfo.repo, 10);
        }

        return context;
    }

    // ==========================================================================
    // GitHub Projects v2 Kanban Methods
    // ==========================================================================

    /**
     * Get a Kanban board view of a GitHub Project v2
     * Fetches project items grouped by Status field
     */
    async getProjectKanban(
        owner: string,
        projectNumber: number
    ): Promise<KanbanBoard | null> {
        if (!this.graphqlWithAuth) {
            logger.debug('GraphQL not available - no token', { module: 'GitHub' });
            return null;
        }

        try {
            // First, get the project and its Status field
            const projectQuery = `
                query($owner: String!, $number: Int!) {
                    user(login: $owner) {
                        projectV2(number: $number) {
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
                    }
                }
            `;

            interface GraphQLResponse {
                user: {
                    projectV2: {
                        id: string;
                        title: string;
                        fields: {
                            nodes: {
                                id?: string;
                                name?: string;
                                options?: {
                                    id: string;
                                    name: string;
                                    color?: string;
                                }[];
                            }[];
                        };
                        items: {
                            nodes: {
                                id: string;
                                type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
                                createdAt: string;
                                updatedAt: string;
                                fieldValues: {
                                    nodes: {
                                        name?: string;
                                        field?: { name?: string };
                                    }[];
                                };
                                content: {
                                    number?: number;
                                    title?: string;
                                    url?: string;
                                    labels?: { nodes: { name: string }[] };
                                    assignees?: { nodes: { login: string }[] };
                                } | null;
                            }[];
                        };
                    } | null;
                } | null;
            }

            const response = await this.graphqlWithAuth<GraphQLResponse>(projectQuery, {
                owner,
                number: projectNumber,
            });

            const project = response.user?.projectV2;
            if (!project) {
                logger.warning('Project not found', { module: 'GitHub', entityId: projectNumber });
                return null;
            }

            // Find the Status field
            const statusField = project.fields.nodes.find(
                (f) => f.name === 'Status' && f.options !== undefined && f.options.length > 0
            );

            if (!statusField?.id || !statusField.options) {
                logger.warning('Status field not found in project', { module: 'GitHub', entityId: projectNumber });
                return null;
            }

            const statusOptions: ProjectV2StatusOption[] = statusField.options.map((opt) => ({
                id: opt.id,
                name: opt.name,
                color: opt.color,
            }));

            // Group items by status
            const columnMap = new Map<string, ProjectV2Item[]>();

            // Initialize columns for all status options
            for (const opt of statusOptions) {
                columnMap.set(opt.name, []);
            }
            // Add a column for items without status
            columnMap.set('No Status', []);

            for (const item of project.items.nodes) {
                // Find the Status field value
                const statusValue = item.fieldValues.nodes.find(
                    (fv) => fv.field?.name === 'Status'
                );
                const status = statusValue?.name ?? 'No Status';

                const content = item.content;
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
                };

                const column = columnMap.get(status);
                if (column) {
                    column.push(projectItem);
                } else {
                    columnMap.get('No Status')?.push(projectItem);
                }
            }

            // Build columns array
            const columns: KanbanColumn[] = [];
            for (const opt of statusOptions) {
                const items = columnMap.get(opt.name) ?? [];
                columns.push({
                    status: opt.name,
                    statusOptionId: opt.id,
                    items,
                });
            }

            // Add "No Status" column if it has items
            const noStatusItems = columnMap.get('No Status') ?? [];
            if (noStatusItems.length > 0) {
                columns.push({
                    status: 'No Status',
                    statusOptionId: '',
                    items: noStatusItems,
                });
            }

            const totalItems = project.items.nodes.length;

            logger.info('Fetched Kanban board', {
                module: 'GitHub',
                entityId: projectNumber,
                context: { columns: columns.length, items: totalItems },
            });

            return {
                projectId: project.id,
                projectNumber,
                projectTitle: project.title,
                statusFieldId: statusField.id,
                statusOptions,
                columns,
                totalItems,
            };
        } catch (error) {
            logger.error('Failed to get Kanban board', {
                module: 'GitHub',
                entityId: projectNumber,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Move a project item to a different status column
     */
    async moveProjectItem(
        projectId: string,
        itemId: string,
        statusFieldId: string,
        statusOptionId: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.graphqlWithAuth) {
            return { success: false, error: 'GraphQL not available - no token' };
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
            `;

            await this.graphqlWithAuth(mutation, {
                projectId,
                itemId,
                fieldId: statusFieldId,
                optionId: statusOptionId,
            });

            logger.info('Moved project item', {
                module: 'GitHub',
                entityId: itemId,
                context: { targetStatus: statusOptionId },
            });

            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Failed to move project item', {
                module: 'GitHub',
                entityId: itemId,
                error: errorMessage,
            });
            return { success: false, error: errorMessage };
        }
    }
}
