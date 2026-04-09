import { Gitlab } from '@gitbeaker/rest';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs';

// Try loading from .claude/.env as per specific requirements, fallback to regular .env
const homeDir = process.env.USERPROFILE || process.env.HOME || '';
const claudeEnvPath = join(homeDir, '.claude', '.env');

if (fs.existsSync(claudeEnvPath)) {
  dotenv.config({ path: claudeEnvPath });
} else {
  dotenv.config();
}

/**
 * Core GitLab Client wrapping the @gitbeaker/rest API.
 */
export class GitLabClient {
  public api: InstanceType<typeof Gitlab>;

  constructor() {
    const token = process.env.GITLAB_API_TOKEN;
    if (!token) {
      throw new Error('GITLAB_API_TOKEN is missing in environment or ~/.claude/.env');
    }

    const host = process.env.GITLAB_URL || 'https://gitlab.lan.athonet.com';

    this.api = new Gitlab({
      host,
      token,
      // Default to rejectUnauthorized = false equivalent via custom fetch if required, 
      // but gitbeaker handles standard HTTPS well.
    });
  }

  async getCurrentUser() {
    return await this.api.Users.current();
  }

  async getProjects(options: { search?: string; owned?: boolean; membership?: boolean; starred?: boolean; perPage?: number } = {}) {
    return await this.api.Projects.all(options);
  }

  async getProject(projectId: string | number) {
    return await this.api.Projects.show(projectId);
  }

  async getBranches(projectId: string | number, search?: string) {
    return await this.api.Branches.all(projectId, { search });
  }

  async getTags(projectId: string | number, search?: string) {
    return await this.api.Tags.all(projectId, { search });
  }

  async getCommits(projectId: string | number, refName?: string, options: { since?: string; until?: string } = {}) {
    return await this.api.Commits.all(projectId, { refName, ...options });
  }

  async getFile(projectId: string | number, filePath: string, ref: string) {
    return await this.api.RepositoryFiles.show(projectId, filePath, ref);
  }

  async getTree(projectId: string | number, options: { path?: string; ref?: string; recursive?: boolean } = {}) {
    return await this.api.Repositories.tree(projectId, options);
  }

  async getMergeRequests(projectId: string | number, options: { state?: string; scope?: string } = {}) {
    return await this.api.MergeRequests.all({ projectId, ...options });
  }

  async getMergeRequest(projectId: string | number, mrIid: number) {
    return await this.api.MergeRequests.show(projectId, mrIid);
  }

  async getMergeRequestChanges(projectId: string | number, mrIid: number) {
    return await this.api.MergeRequests.changes(projectId, mrIid);
  }

  async getIssues(projectId: string | number, options: { state?: string; labels?: string } = {}) {
    return await this.api.Issues.all({ projectId, ...options });
  }

  async getPipelines(projectId: string | number, options: { status?: string; ref?: string } = {}) {
    return await this.api.Pipelines.all(projectId, options);
  }

  async getPipelineJobs(projectId: string | number, pipelineId: number) {
    return await this.api.Jobs.all(projectId, { pipelineId });
  }

  async getJobLog(projectId: string | number, jobId: number) {
    return await this.api.Jobs.showLog(projectId, jobId);
  }

  async search(query: string, scope: string, projectId?: string | number) {
    if (projectId) {
      return await this.api.Search.all(scope, query, { projectId });
    }
    return await this.api.Search.all(scope, query);
  }
}
