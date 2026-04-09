import { GitLabClient } from './gitlab-client.js';

/**
 * High-level repository operations utilizing GitLabClient.
 */
export class GitLabHelper {
  private client: GitLabClient;
  
  constructor() {
    this.client = new GitLabClient();
  }

  async connect() {
    // Current user request will throw if authentication fails
    return await this.client.getCurrentUser();
  }

  async listProjects(options: { search?: string; owned?: boolean; membership?: boolean; starred?: boolean } = {}) {
    return await this.client.getProjects(options);
  }

  async getProject(projectPath: string) {
    return await this.client.getProject(projectPath);
  }

  async getFileContent(project: string, path: string, ref: string = 'main') {
    const file = await this.client.getFile(project, path, ref);
    if (!file || !file.content) return null;
    return Buffer.from(file.content, 'base64').toString('utf-8');
  }

  async listFiles(project: string, path?: string, ref?: string, recursive: boolean = false) {
    return await this.client.getTree(project, { path, ref, recursive });
  }

  async getCommits(project: string, branch: string = 'main', limit: number = 10) {
    const commits = await this.client.getCommits(project, branch);
    return Array.isArray(commits) ? commits.slice(0, limit) : [];
  }

  async listMergeRequests(projectPath: string, state: string = 'opened') {
    return await this.client.getMergeRequests(projectPath, { state });
  }

  async getMyMergeRequests() {
    const user = await this.client.getCurrentUser();
    // Scope 'created_by_me' requires different endpoint parameters, but using standard API
    return await this.client.api.MergeRequests.all({ authorId: user.id, state: 'opened' });
  }

  async getAssignedMergeRequests() {
    const user = await this.client.getCurrentUser();
    return await this.client.api.MergeRequests.all({ assigneeId: user.id, state: 'opened' });
  }

  async listPipelines(project: string, status?: string, ref?: string) {
    return await this.client.getPipelines(project, { status, ref });
  }

  async getPipelineJobs(project: string, pipelineId: number) {
    return await this.client.getPipelineJobs(project, pipelineId);
  }

  async getJobLog(project: string, jobId: number) {
    return await this.client.getJobLog(project, jobId);
  }

  async getLatestPipeline(project: string, ref: string = 'main') {
    const pipelines = await this.client.getPipelines(project, { ref });
    if (!pipelines || pipelines.length === 0) return null;
    // Pipelines are generally sorted by id desc
    return pipelines[0];
  }

  async searchCode(query: string, project?: string) {
    return await this.client.search(query, 'blobs', project);
  }
}
