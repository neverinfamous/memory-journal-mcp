---
name: gitlab
description: |
  Specialized assistant skill for managing repositories and CI/CD in GitLab. 
  Activate when the user asks about GitLab projects or repositories, wants to 
  see merge requests or pipelines, needs to search code or files, asks about 
  CI/CD status or job logs, or wants to browse repository contents. 
  Mentions "GitLab", "MR", "pipeline", or "CI/CD".
---

# GitLab Skill

You are a specialized assistant for managing repositories and CI/CD in GitLab. This skill enables querying projects, merge requests, pipelines, and searching code.

## Prerequisites
Before using this skill, ensure:
- The `~/.claude/.env` file exists with `GITLAB_API_TOKEN` (or it exists in the active workspace's `.env`).
- A recent version of Bun/Node is installed.
- Network access to the GitLab instance.

## Skill Structure
```text
skills/gitlab/
├── SKILL.md                    # This file
├── package.json                # TS dependencies (@gitbeaker/rest)
└── scripts/
    ├── gitlab-client.ts        # Core GitLab REST API client
    └── gitlab-helper.ts        # High-level repository operations
```

## Quick Start 

You can use the helper script via a quick TS sandbox, utilizing `bun` if available, or straight Node via `tsx`.

```typescript
import { GitLabHelper } from './skills/gitlab/scripts/gitlab-helper.js';

const helper = new GitLabHelper();

// Verify connection
const user = await helper.connect();

// List projects
const projects = await helper.listProjects({ membership: true });

// Get a specific project
const project = await helper.getProject("group/project-name");

// List open merge requests
const mrs = await helper.listMergeRequests("group/project", "opened");

// List pipelines
const pipelines = await helper.listPipelines("group/project", "success");
```

## Common Tasks

### 1. Check Pipeline Status
```typescript
const pipeline = await helper.getLatestPipeline("group/project", "main");
console.log(`Pipeline #${pipeline.id}: ${pipeline.status}`);

if (pipeline.status === "failed") {
    const jobs = await helper.getPipelineJobs("group/project", pipeline.id);
    for (const job of jobs) {
        if (job.status === "failed") {
            const log = await helper.getJobLog("group/project", job.id);
            console.log(log.substring(log.length - 1000));
        }
    }
}
```

### 2. Review Merge Requests
```typescript
const mrs = await helper.getAssignedMergeRequests();
for (const mr of mrs) {
    console.log(`!${mr.iid}: ${mr.title}`);
    console.log(`  ${mr.source_branch} -> ${mr.target_branch}`);
    console.log(`  Author: ${mr.author.username}`);
}
```

### 3. Browse Repository & Search Code
```typescript
// List files in a directory
const files = await helper.listFiles("group/project", "src/", "main");
for (const f of files) {
    console.log(`${f.type === 'tree' ? '[D]' : '[F]'} ${f.name}`);
}

// Search code
const results = await helper.searchCode("authenticate_user", "group/project");
```

## Error Handling

| Error | Cause | Solution |
|---|---|---|
| 401 Unauthorized | Invalid token | Check GITLAB_API_TOKEN in .env |
| 403 Forbidden | No project access | Request project permissions |
| 404 Not Found | Project/MR doesn't exist | Verify project path |

## Configuration
The client reads settings from the environment:
- `GITLAB_API_TOKEN` - Personal Access Token (required)
- `GITLAB_URL` - GitLab instance URL (default: https://gitlab.lan.athonet.com)
