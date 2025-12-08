"""
Memory Journal MCP Server - MCP Resources Module
Resource handlers for MCP protocol (recent entries, significant entries, graphs, timelines).
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

from mcp.types import Resource
from pydantic import AnyUrl
from pydantic_core import Url

from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from database.team_db import TeamDatabaseManager
from github.integration import GitHubProjectsIntegration
from constants import (
    THREAD_POOL_MAX_WORKERS, TEAM_DB_PATH,
    MERMAID_ACTIONS_STYLE_COMMIT, MERMAID_ACTIONS_STYLE_RUN_SUCCESS,
    MERMAID_ACTIONS_STYLE_RUN_FAILURE, MERMAID_ACTIONS_STYLE_RUN_PENDING,
    MERMAID_ACTIONS_STYLE_JOB_FAILURE, MERMAID_ACTIONS_STYLE_ENTRY,
    MERMAID_ACTIONS_STYLE_DEPLOYMENT, MERMAID_ACTIONS_STYLE_PR,
    ACTIONS_GRAPH_MAX_JOBS_PER_RUN, ACTIONS_GRAPH_DEFAULT_LIMIT, CONTENT_PREVIEW_TITLE
)
import sys

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
github_projects: Optional[GitHubProjectsIntegration] = None
project_context_manager: Optional[ProjectContextManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None
team_db: Optional[TeamDatabaseManager] = None


def initialize_resource_handlers(db_instance: MemoryJournalDB,
                                  github_projects_instance: GitHubProjectsIntegration,
                                  project_context_manager_instance: ProjectContextManager):
    """Initialize resource handlers with required dependencies."""
    global db, github_projects, project_context_manager, thread_pool, team_db
    db = db_instance
    github_projects = github_projects_instance
    project_context_manager = project_context_manager_instance
    thread_pool = ThreadPoolExecutor(max_workers=THREAD_POOL_MAX_WORKERS)
    # Initialize team database manager (v2.0.0 Team Collaboration)
    try:
        team_db = TeamDatabaseManager(TEAM_DB_PATH)
        print("[INFO] Team database manager initialized for resources", file=sys.stderr)
    except Exception as e:
        print(f"[WARNING] Team database resource initialization failed: {e}", file=sys.stderr)
        team_db = None


def parse_resource_uri(uri_str: str) -> Dict[str, Any]:
    """
    Parse resource URI and extract parameters.
    
    Supports:
    - memory://issues/{number}/entries
    - memory://prs/{number}/entries
    - memory://prs/{number}/timeline
    - memory://actions/recent (with optional query params: branch, workflow, commit, pr)
    - memory://actions/workflows/{workflow_name}/timeline
    - memory://actions/branches/{branch}/timeline
    - memory://actions/commits/{sha}/timeline
    - memory://graph/actions (with optional query params: branch, workflow, limit)
    
    Returns:
        Dict with 'type' and relevant ID fields, or {'type': 'unknown'}
    """
    import re
    from urllib.parse import urlparse, parse_qs
    
    # memory://graph/actions (with optional query params)
    if uri_str.startswith('memory://graph/actions'):
        result: Dict[str, Any] = {'type': 'graph_actions'}
        # Parse query parameters if present
        if '?' in uri_str:
            parsed = urlparse(uri_str)
            query_params = parse_qs(parsed.query)
            if 'branch' in query_params:
                result['branch'] = query_params['branch'][0]
            if 'workflow' in query_params:
                result['workflow'] = query_params['workflow'][0]
            if 'limit' in query_params:
                result['limit'] = int(query_params['limit'][0])
        return result
    
    # memory://issues/{number}/entries
    if match := re.match(r'memory://issues/(\d+)/entries', uri_str):
        return {'type': 'issue_entries', 'issue_number': int(match.group(1))}
    
    # memory://prs/{number}/entries
    if match := re.match(r'memory://prs/(\d+)/entries', uri_str):
        return {'type': 'pr_entries', 'pr_number': int(match.group(1))}
    
    # memory://prs/{number}/timeline
    if match := re.match(r'memory://prs/(\d+)/timeline', uri_str):
        return {'type': 'pr_timeline', 'pr_number': int(match.group(1))}
    
    # memory://actions/recent (with optional query params)
    if uri_str.startswith('memory://actions/recent'):
        result: Dict[str, Any] = {'type': 'actions_recent'}
        # Parse query parameters if present
        if '?' in uri_str:
            parsed = urlparse(uri_str)
            query_params = parse_qs(parsed.query)
            if 'branch' in query_params:
                result['branch'] = query_params['branch'][0]
            if 'workflow' in query_params:
                result['workflow'] = query_params['workflow'][0]
            if 'commit' in query_params:
                result['commit'] = query_params['commit'][0]
            if 'pr' in query_params:
                result['pr'] = int(query_params['pr'][0])
            if 'limit' in query_params:
                result['limit'] = int(query_params['limit'][0])
        return result
    
    # memory://actions/workflows/{workflow_name}/timeline
    if match := re.match(r'memory://actions/workflows/([^/]+)/timeline', uri_str):
        return {'type': 'actions_workflow_timeline', 'workflow_name': match.group(1)}
    
    # memory://actions/branches/{branch}/timeline
    if match := re.match(r'memory://actions/branches/([^/]+)/timeline', uri_str):
        return {'type': 'actions_branch_timeline', 'branch': match.group(1)}
    
    # memory://actions/commits/{sha}/timeline
    if match := re.match(r'memory://actions/commits/([a-fA-F0-9]+)/timeline', uri_str):
        return {'type': 'actions_commit_timeline', 'sha': match.group(1)}
    
    return {'type': 'unknown'}


def _sanitize_mermaid_label(text: str, max_len: int = 40) -> str:
    """Sanitize text for use in Mermaid diagram labels."""
    text = text.replace('"', "'").replace('\n', ' ').replace('[', '(').replace(']', ')')
    if len(text) > max_len:
        text = text[:max_len-3] + '...'
    return text


async def _generate_actions_graph(
    db_instance: MemoryJournalDB,
    github_projects_instance: GitHubProjectsIntegration,
    pcm: ProjectContextManager,
    thread_pool_instance: ThreadPoolExecutor,
    branch_filter: Optional[str],
    workflow_filter: Optional[str],
    limit: int
) -> str:
    """Generate a Mermaid diagram for the Actions Visual Graph resource."""
    from github.api import (
        get_repo_workflow_runs, get_workflow_runs_by_name,
        get_workflow_run_jobs, get_pr_from_branch, get_pr_details
    )
    
    # Get repo context
    project_context = await pcm.get_project_context()
    owner: Optional[str] = None
    repo: Optional[str] = None
    
    if 'repo_path' in project_context:
        owner = github_projects_instance.extract_repo_owner_from_remote(project_context['repo_path'])
        repo = project_context.get('repo_name')
    
    if not owner or not repo:
        return "```mermaid\ngraph LR\n    ERROR[\"Could not determine repository context\"]\n```"
    
    # Get workflow runs based on filters
    runs: List[Dict[str, Any]]
    if workflow_filter:
        runs = get_workflow_runs_by_name(github_projects_instance, owner, repo, workflow_filter, 
                                          branch=branch_filter, limit=limit)
    else:
        runs = get_repo_workflow_runs(github_projects_instance, owner, repo, 
                                       branch=branch_filter, limit=limit)
    
    if not runs:
        return "```mermaid\ngraph LR\n    EMPTY[\"No workflow runs found\"]\n```"
    
    # Collect unique commits and their associated runs
    commits_map: Dict[str, Dict[str, Any]] = {}  # sha -> commit info
    runs_map: Dict[int, Dict[str, Any]] = {}  # run_id -> run info
    failed_jobs_list: List[Dict[str, Any]] = []
    deployments_list: List[Dict[str, Any]] = []
    prs_map: Dict[int, Dict[str, Any]] = {}  # pr_number -> pr info
    
    # Process runs
    for run in runs:
        run_id = run.get('id')
        head_sha = run.get('head_sha', '')
        short_sha = head_sha[:7] if head_sha else ''
        conclusion = run.get('conclusion', '')
        workflow_name = run.get('name', 'workflow')
        
        if run_id:
            runs_map[run_id] = {
                'id': run_id,
                'name': workflow_name,
                'status': run.get('status', ''),
                'conclusion': conclusion,
                'head_sha': head_sha,
                'short_sha': short_sha,
                'head_branch': run.get('head_branch', ''),
                'event': run.get('event', ''),
                'timestamp': run.get('created_at', ''),
                'html_url': run.get('html_url')
            }
        
        # Track commits
        if short_sha and short_sha not in commits_map:
            commits_map[short_sha] = {
                'sha': head_sha,
                'short_sha': short_sha,
                'branch': run.get('head_branch', ''),
                'timestamp': run.get('created_at', '')
            }
        
        # Check if this is a deployment workflow
        name_lower = workflow_name.lower()
        if any(kw in name_lower for kw in ['deploy', 'release', 'publish']):
            if conclusion == 'success':
                deployments_list.append({
                    'run_id': run_id,
                    'workflow_name': workflow_name,
                    'head_sha': head_sha,
                    'short_sha': short_sha,
                    'timestamp': run.get('created_at', ''),
                    'html_url': run.get('html_url')
                })
        
        # Get failed jobs for failed runs
        if conclusion == 'failure' and run_id:
            jobs = get_workflow_run_jobs(github_projects_instance, owner, repo, run_id)
            job_count = 0
            for job in jobs:
                if job.get('conclusion') == 'failure' and job_count < ACTIONS_GRAPH_MAX_JOBS_PER_RUN:
                    # Find failed step
                    failed_step: Optional[str] = None
                    for step in job.get('steps', []):
                        if step.get('conclusion') == 'failure':
                            failed_step = step.get('name')
                            break
                    
                    failed_jobs_list.append({
                        'job_id': job.get('id'),
                        'name': job.get('name', 'job'),
                        'run_id': run_id,
                        'conclusion': job.get('conclusion', 'failure'),
                        'html_url': job.get('html_url'),
                        'failed_step': failed_step
                    })
                    job_count += 1
        
        # Check for associated PR
        if run.get('event') == 'pull_request' and run.get('head_branch'):
            pr_info = get_pr_from_branch(github_projects_instance, owner, repo, run['head_branch'])
            if pr_info and pr_info.get('number') not in prs_map:
                pr_detail = get_pr_details(github_projects_instance, owner, repo, pr_info['number'])
                if pr_detail:
                    prs_map[pr_info['number']] = {
                        'pr_number': pr_info['number'],
                        'title': pr_detail.get('title', '')[:CONTENT_PREVIEW_TITLE],
                        'state': pr_detail.get('state', 'open'),
                        'merged': pr_detail.get('merged', False),
                        'author': pr_detail.get('author', ''),
                        'head_branch': pr_detail.get('head_branch', ''),
                        'url': pr_detail.get('url')
                    }
    
    # Get journal entries linked to workflow runs
    def get_actions_entries() -> List[Dict[str, Any]]:
        if not runs_map:
            return []
        run_ids = list(runs_map.keys())
        with db_instance.get_connection() as conn:
            placeholders = ','.join(['?' for _ in run_ids])
            cursor = conn.execute(f"""
                SELECT id, entry_type, content, timestamp, workflow_run_id, workflow_name
                FROM memory_journal
                WHERE workflow_run_id IN ({placeholders}) AND deleted_at IS NULL
                ORDER BY timestamp DESC
                LIMIT 20
            """, run_ids)
            return [dict(row) for row in cursor.fetchall()]
    
    loop = asyncio.get_event_loop()
    journal_entries = await loop.run_in_executor(thread_pool_instance, get_actions_entries)
    
    # Build the Mermaid graph
    mermaid = "```mermaid\ngraph LR\n"
    mermaid += "    %% Actions Visual Graph - CI/CD Narrative\n\n"
    
    # Add commit nodes (hexagon shape)
    if commits_map:
        mermaid += "    %% Commits\n"
        for short_sha, commit in commits_map.items():
            node_id = f"C_{short_sha}"
            branch_label = f"<br/>{commit['branch']}" if commit.get('branch') else ''
            mermaid += f"    {node_id}{{{{{short_sha}{branch_label}}}}}\n"
        mermaid += "\n"
    
    # Add PR nodes (stadium shape)
    if prs_map:
        mermaid += "    %% Pull Requests\n"
        for pr_number, pr in prs_map.items():
            node_id = f"PR_{pr_number}"
            title_preview = _sanitize_mermaid_label(pr['title'], 30)
            mermaid += f"    {node_id}([\"PR #{pr_number}: {title_preview}\"])\n"
        mermaid += "\n"
    
    # Add workflow run nodes (rectangles)
    if runs_map:
        mermaid += "    %% Workflow Runs\n"
        for run_id, run in runs_map.items():
            node_id = f"WR_{run_id}"
            name_preview = _sanitize_mermaid_label(run['name'], 25)
            run_conclusion = run.get('conclusion') or 'running'
            status_icon = '✅' if run_conclusion == 'success' else '❌' if run_conclusion == 'failure' else '🔄'
            mermaid += f"    {node_id}[\"{status_icon} {name_preview}\"]\n"
        mermaid += "\n"
    
    # Add failed job nodes
    if failed_jobs_list:
        mermaid += "    %% Failed Jobs\n"
        for job in failed_jobs_list:
            job_id = job['job_id']
            node_id = f"J_{job_id}"
            name_preview = _sanitize_mermaid_label(job['name'], 25)
            step_label = f"<br/>Step: {_sanitize_mermaid_label(job['failed_step'], 20)}" if job.get('failed_step') else ''
            mermaid += f"    {node_id}[/\"{name_preview}{step_label}\"/]\n"
        mermaid += "\n"
    
    # Add journal entry nodes
    if journal_entries:
        mermaid += "    %% Investigation Entries\n"
        for entry in journal_entries:
            entry_id = entry['id']
            node_id = f"E_{entry_id}"
            content_preview = _sanitize_mermaid_label(entry.get('content', ''), 30)
            entry_type = entry.get('entry_type', 'entry')[:15]
            mermaid += f"    {node_id}[\"📝 #{entry_id}: {content_preview}<br/>{entry_type}\"]\n"
        mermaid += "\n"
    
    # Add deployment nodes (stadium shape)
    if deployments_list:
        mermaid += "    %% Deployments\n"
        for deploy in deployments_list:
            node_id = f"D_{deploy['run_id']}"
            name_preview = _sanitize_mermaid_label(deploy['workflow_name'], 25)
            mermaid += f"    {node_id}([\"🚀 {name_preview}\"])\n"
        mermaid += "\n"
    
    # Add edges
    mermaid += "    %% Connections\n"
    
    # Commit -> Workflow Run edges
    for run_id, run in runs_map.items():
        short_sha = run.get('short_sha')
        if short_sha and short_sha in commits_map:
            mermaid += f"    C_{short_sha} --> WR_{run_id}\n"
    
    # PR -> Workflow Run edges (for PR-triggered runs)
    for run_id, run in runs_map.items():
        if run.get('event') == 'pull_request':
            for pr_number, pr in prs_map.items():
                if pr.get('head_branch') == run.get('head_branch'):
                    mermaid += f"    PR_{pr_number} --> WR_{run_id}\n"
                    break
    
    # Workflow Run -> Failed Job edges
    for job in failed_jobs_list:
        job_run_id = job['run_id']
        job_id = job['job_id']
        mermaid += f"    WR_{job_run_id} -->|failure| J_{job_id}\n"
    
    # Workflow Run/Job -> Journal Entry edges
    for entry in journal_entries:
        workflow_run_id = entry.get('workflow_run_id')
        entry_id = entry['id']
        if workflow_run_id and workflow_run_id in runs_map:
            # Check if there are failed jobs for this run
            linked_job: Optional[Dict[str, Any]] = None
            for job in failed_jobs_list:
                if job['run_id'] == workflow_run_id:
                    linked_job = job
                    break
            
            if linked_job:
                mermaid += f"    J_{linked_job['job_id']} -.->|investigates| E_{entry_id}\n"
            else:
                mermaid += f"    WR_{workflow_run_id} -.-> E_{entry_id}\n"
    
    # Workflow Run -> Deployment edges (for successful deployment workflows)
    for deploy in deployments_list:
        deploy_run_id = deploy['run_id']
        mermaid += f"    WR_{deploy_run_id} -->|deploys| D_{deploy_run_id}\n"
    
    # Identify "fix" patterns: failure followed by success on same workflow
    workflow_runs_by_name: Dict[str, List[Dict[str, Any]]] = {}
    for run_id, run in runs_map.items():
        name = run.get('name', '')
        if name not in workflow_runs_by_name:
            workflow_runs_by_name[name] = []
        workflow_runs_by_name[name].append(run)
    
    for name, runs_list in workflow_runs_by_name.items():
        # Sort by timestamp
        sorted_runs = sorted(runs_list, key=lambda r: r.get('timestamp', ''))
        for i in range(len(sorted_runs) - 1):
            current = sorted_runs[i]
            next_run = sorted_runs[i + 1]
            # If current failed and next succeeded, it's a fix
            if current.get('conclusion') == 'failure' and next_run.get('conclusion') == 'success':
                next_sha = next_run.get('short_sha')
                if next_sha and next_sha in commits_map:
                    current_id = current['id']
                    # Find journal entry for the failure if any
                    for entry in journal_entries:
                        if entry.get('workflow_run_id') == current_id:
                            mermaid += f"    E_{entry['id']} ==>|fixes| C_{next_sha}\n"
                            break
    
    mermaid += "\n"
    
    # Add styling using classDef for compact output (dark mode optimized)
    mermaid += "    %% Style classes\n"
    mermaid += f"    classDef commit fill:{MERMAID_ACTIONS_STYLE_COMMIT},color:#000,stroke:#2E7D32\n"
    mermaid += f"    classDef success fill:{MERMAID_ACTIONS_STYLE_RUN_SUCCESS},color:#000,stroke:#2E7D32\n"
    mermaid += f"    classDef failure fill:{MERMAID_ACTIONS_STYLE_RUN_FAILURE},color:#000,stroke:#B71C1C\n"
    mermaid += f"    classDef pending fill:{MERMAID_ACTIONS_STYLE_RUN_PENDING},color:#000,stroke:#F57F17\n"
    mermaid += f"    classDef jobfail fill:{MERMAID_ACTIONS_STYLE_JOB_FAILURE},color:#000,stroke:#B71C1C\n"
    mermaid += f"    classDef entry fill:{MERMAID_ACTIONS_STYLE_ENTRY},color:#000,stroke:#1565C0\n"
    mermaid += f"    classDef deploy fill:{MERMAID_ACTIONS_STYLE_DEPLOYMENT},color:#000,stroke:#00695C\n"
    mermaid += f"    classDef pr fill:{MERMAID_ACTIONS_STYLE_PR},color:#000,stroke:#7B1FA2\n"
    
    # Apply classes to nodes (compact: class node1,node2,node3 className)
    commit_nodes = ','.join([f"C_{sha}" for sha in commits_map.keys()])
    if commit_nodes:
        mermaid += f"    class {commit_nodes} commit\n"
    
    pr_nodes = ','.join([f"PR_{pr}" for pr in prs_map.keys()])
    if pr_nodes:
        mermaid += f"    class {pr_nodes} pr\n"
    
    # Group workflow runs by conclusion
    success_runs = [f"WR_{rid}" for rid, r in runs_map.items() if r.get('conclusion') == 'success']
    failure_runs = [f"WR_{rid}" for rid, r in runs_map.items() if r.get('conclusion') == 'failure']
    pending_runs = [f"WR_{rid}" for rid, r in runs_map.items() if r.get('conclusion') not in ('success', 'failure')]
    
    if success_runs:
        mermaid += f"    class {','.join(success_runs)} success\n"
    if failure_runs:
        mermaid += f"    class {','.join(failure_runs)} failure\n"
    if pending_runs:
        mermaid += f"    class {','.join(pending_runs)} pending\n"
    
    job_nodes = ','.join([f"J_{job['job_id']}" for job in failed_jobs_list])
    if job_nodes:
        mermaid += f"    class {job_nodes} jobfail\n"
    
    entry_nodes = ','.join([f"E_{e['id']}" for e in journal_entries])
    if entry_nodes:
        mermaid += f"    class {entry_nodes} entry\n"
    
    deploy_nodes = ','.join([f"D_{d['run_id']}" for d in deployments_list])
    if deploy_nodes:
        mermaid += f"    class {deploy_nodes} deploy\n"
    
    mermaid += "```\n\n"
    
    # Compact footer: repo info and legend on one line
    mermaid += f"**{owner}/{repo}** | {len(runs_map)} runs"
    if branch_filter:
        mermaid += f" | branch: {branch_filter}"
    if workflow_filter:
        mermaid += f" | workflow: {workflow_filter}"
    mermaid += " | `{{}}` commit `[]` run `([])` PR"
    
    return mermaid


async def list_resources() -> List[Resource]:
    """List available resources."""
    return [
        Resource(
            uri=Url("memory://recent"),  # type: ignore[arg-type]
            name="Recent Journal Entries",
            description="Most recent journal entries",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://significant"),  # type: ignore[arg-type]
            name="Significant Entries",
            description="Entries marked as significant",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://graph/recent"),  # type: ignore[arg-type]
            name="Relationship Graph (Recent)",
            description="Mermaid graph visualization of recent entries with relationships",
            mimeType="text/plain"
        ),
        Resource(
            uri=Url("memory://graph/actions"),  # type: ignore[arg-type]
            name="Actions Visual Graph",
            description="Mermaid graph showing CI/CD narrative: commits, workflow runs, failures, investigation entries, fixes, and deployments. Query params: ?branch=X&workflow=Y&limit=15",
            mimeType="text/plain"
        ),
        Resource(
            uri=Url("memory://team/recent"),  # type: ignore[arg-type]
            name="Team Shared Entries (v2.0.0)",
            description="Most recent team-shared journal entries from .memory-journal-team.db",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://projects/{project_identifier}/timeline"),  # type: ignore[arg-type]
            name="Project Activity Timeline (Phase 2 & 3)",
            description="Chronological timeline of journal entries and GitHub Project activity for a specific project. Supports: memory://projects/{number}/timeline, memory://projects/{name}/timeline, or memory://projects/{owner}/{owner_type}/{number}/timeline",
            mimeType="text/markdown"
        ),
        Resource(
            uri=Url("memory://issues/{issue_number}/entries"),  # type: ignore[arg-type]
            name="Issue Journal Entries (Phase 3)",
            description="All journal entries linked to a specific GitHub Issue",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://prs/{pr_number}/entries"),  # type: ignore[arg-type]
            name="Pull Request Journal Entries (Phase 3)",
            description="All journal entries linked to a specific GitHub Pull Request",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://prs/{pr_number}/timeline"),  # type: ignore[arg-type]
            name="Pull Request Activity Timeline (Phase 3)",
            description="Combined timeline of journal entries and PR events (commits, reviews, status changes)",
            mimeType="text/markdown"
        ),
        # GitHub Actions Resources
        Resource(
            uri=Url("memory://actions/recent"),  # type: ignore[arg-type]
            name="Recent GitHub Actions Runs",
            description="Recent workflow runs with filtering. Query params: ?branch=X&workflow=Y&commit=SHA&pr=N&limit=10",
            mimeType="application/json"
        ),
        Resource(
            uri=Url("memory://actions/workflows/{workflow_name}/timeline"),  # type: ignore[arg-type]
            name="Workflow Activity Timeline",
            description="Timeline of runs, journal entries, and PR events for a specific GitHub Actions workflow",
            mimeType="text/markdown"
        ),
        Resource(
            uri=Url("memory://actions/branches/{branch}/timeline"),  # type: ignore[arg-type]
            name="Branch CI Timeline",
            description="Timeline of workflow runs, journal entries, and PR events for a specific branch",
            mimeType="text/markdown"
        ),
        Resource(
            uri=Url("memory://actions/commits/{sha}/timeline"),  # type: ignore[arg-type]
            name="Commit CI Timeline",
            description="Timeline of workflow runs and journal entries for a specific commit SHA",
            mimeType="text/markdown"
        )
    ]


async def read_resource(uri: AnyUrl) -> str:
    """Read a specific resource."""
    if db is None or github_projects is None or project_context_manager is None or thread_pool is None:
        raise RuntimeError("Resource handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    _github_projects = github_projects
    _pcm = project_context_manager
    _thread_pool = thread_pool
    
    # Convert URI to string (AnyUrl is always a valid URL object)
    uri_str = str(uri).strip()

    if uri_str == "memory://recent":
        try:
            def get_recent_entries():
                with _db.get_connection() as conn:
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, project_context
                        FROM memory_journal
                        ORDER BY timestamp DESC
                        LIMIT 10
                    """)
                    entries = [dict(row) for row in cursor.fetchall()]
                    return entries

            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(_thread_pool, get_recent_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            raise

    elif uri_str == "memory://significant":
        try:
            def get_significant_entries():
                with _db.get_connection() as conn:
                    cursor = conn.execute("""
                        SELECT se.significance_type, se.significance_rating,
                               mj.id, mj.entry_type, mj.content, mj.timestamp
                        FROM significant_entries se
                        JOIN memory_journal mj ON se.entry_id = mj.id
                        ORDER BY se.significance_rating DESC
                        LIMIT 10
                    """)
                    entries = [dict(row) for row in cursor.fetchall()]
                    return entries

            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(_thread_pool, get_significant_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            raise

    elif uri_str == "memory://team/recent":
        # v2.0.0 Team Collaboration: Team-shared entries resource
        try:
            if team_db is None:
                return json.dumps({"error": "Team database not available"}, indent=2)
            
            # Capture for nested function
            _team_db = team_db
            
            def get_team_entries():
                return _team_db.get_team_entries(limit=10)
            
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(_thread_pool, get_team_entries)
            
            # Format entries for better readability
            formatted_entries: List[Dict[str, Any]] = []
            for entry in entries:
                formatted_entry = {
                    'id': entry.get('id'),
                    'entry_type': entry.get('entry_type'),
                    'content': entry.get('content'),
                    'timestamp': entry.get('timestamp'),
                    'tags': entry.get('tags', []),
                    'project_number': entry.get('project_number'),
                    'source': 'team_shared'
                }
                formatted_entries.append(formatted_entry)
            
            return json.dumps({
                'count': len(formatted_entries),
                'entries': formatted_entries
            }, indent=2)
        except Exception as e:
            return json.dumps({"error": f"Failed to retrieve team entries: {str(e)}"}, indent=2)
    
    elif uri_str == "memory://graph/recent":
        try:
            def get_graph():
                with _db.get_connection() as conn:
                    # Get recent entries that have relationships
                    cursor = conn.execute("""
                        SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                        FROM memory_journal mj
                        WHERE mj.deleted_at IS NULL
                          AND mj.id IN (
                              SELECT DISTINCT from_entry_id FROM relationships
                              UNION
                              SELECT DISTINCT to_entry_id FROM relationships
                          )
                        ORDER BY mj.timestamp DESC
                        LIMIT 20
                    """)
                    entries = {row[0]: dict(row) for row in cursor.fetchall()}

                    if not entries:
                        return None, None

                    # Get relationships between these entries
                    entry_ids = list(entries.keys())
                    placeholders = ','.join(['?' for _ in entry_ids])
                    cursor = conn.execute(f"""
                        SELECT from_entry_id, to_entry_id, relationship_type
                        FROM relationships
                        WHERE from_entry_id IN ({placeholders})
                          AND to_entry_id IN ({placeholders})
                    """, entry_ids + entry_ids)
                    relationships = cursor.fetchall()

                    return entries, relationships

            loop = asyncio.get_event_loop()
            entries, relationships = await loop.run_in_executor(_thread_pool, get_graph)

            if not entries:
                return "No entries with relationships found"

            # Generate Mermaid diagram
            mermaid = "```mermaid\ngraph TD\n"
            
            for entry_id, entry in entries.items():
                content_preview = entry['content'][:40].replace('\n', ' ')
                if len(entry['content']) > 40:
                    content_preview += '...'
                content_preview = content_preview.replace('"', "'").replace('[', '(').replace(']', ')')
                
                entry_type_short = entry['entry_type'][:20]
                node_label = f"#{entry_id}: {content_preview}<br/>{entry_type_short}"
                mermaid += f"    E{entry_id}[\"{node_label}\"]\n"

            mermaid += "\n"

            relationship_symbols = {
                'references': '-->',
                'implements': '==>',
                'clarifies': '-.->',
                'evolves_from': '-->',
                'response_to': '<-->'
            }

            if relationships:
                for rel in relationships:
                    from_id, to_id, rel_type = rel
                    arrow = relationship_symbols.get(rel_type, '-->')
                    mermaid += f"    E{from_id} {arrow}|{rel_type}| E{to_id}\n"

            mermaid += "\n"
            for entry_id, entry in entries.items():
                if entry['is_personal']:
                    mermaid += f"    style E{entry_id} fill:#E3F2FD\n"
                else:
                    mermaid += f"    style E{entry_id} fill:#FFF3E0\n"

            mermaid += "```"
            
            return mermaid
        except Exception as e:
            raise

    elif uri_str.startswith("memory://graph/actions"):
        # Actions Visual Graph: Mermaid diagram of CI/CD narrative
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'graph_actions':
                raise ValueError(f"Invalid graph actions URI: {uri_str}")
            
            # Extract filter parameters
            branch_filter: Optional[str] = parsed.get('branch')
            workflow_filter: Optional[str] = parsed.get('workflow')
            limit: int = parsed.get('limit', ACTIONS_GRAPH_DEFAULT_LIMIT)
            
            return await _generate_actions_graph(
                _db, _github_projects, _pcm, _thread_pool,
                branch_filter, workflow_filter, limit
            )
            
        except Exception as e:
            raise ValueError(f"Error generating actions graph: {str(e)}")

    elif uri_str.startswith("memory://projects/") and "/timeline" in uri_str:
        # Phase 2 - Issue #16: Project Timeline Resource (Phase 3: org support + name lookup)
        try:
            # Extract parameters from URI
            # Supports: 
            # - memory://projects/1/timeline (number)
            # - memory://projects/memory-journal-mcp/timeline (name)
            # - memory://projects/my-company/org/1/timeline (owner/type/number)
            parts = uri_str.split("/")
            
            # Determine format
            if len(parts) == 5:  # memory://projects/{number_or_name}/timeline
                identifier = parts[3]
                owner = None
                owner_type = 'user'
                
                # Try to parse as integer (project number)
                try:
                    project_number = int(identifier)
                except ValueError:
                    # It's a project name - look it up from current GitHub context
                    # Note: This uses the CURRENT project name from GitHub, not historical names
                    # stored in old journal entries' project_context fields
                    project_number = None
                    project_name = identifier
                    
                    # Get project context to find the number
                    project_context = await _pcm.get_project_context()
                    if 'github_projects' in project_context:
                        all_projects = project_context['github_projects'].get('user_projects', []) + \
                                     project_context['github_projects'].get('org_projects', [])
                        
                        # Search for project by name (case-insensitive)
                        for proj in all_projects:
                            if proj.get('name', '').lower() == project_name.lower():
                                project_number = proj.get('number')
                                owner = proj.get('owner')
                                break
                        
                        if project_number is None:
                            raise ValueError(f"Project '{project_name}' not found in GitHub context. Available projects: {[p.get('name') for p in all_projects]}")
                
            elif len(parts) == 7:  # memory://projects/{owner}/{owner_type}/{number}/timeline
                owner = parts[3]
                owner_type = parts[4] if parts[4] in ['user', 'org'] else 'user'
                project_number = int(parts[5])
            else:
                raise ValueError(f"Invalid URI format. Expected: memory://projects/{{number_or_name}}/timeline or memory://projects/{{owner}}/{{owner_type}}/{{number}}/timeline")

            def get_timeline_data():
                with _db.get_connection() as conn:
                    # Get journal entries for this project (last 30 days)
                    cutoff_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                    
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp
                        FROM memory_journal
                        WHERE project_number = ? AND deleted_at IS NULL
                          AND DATE(timestamp) >= DATE(?)
                        ORDER BY timestamp DESC
                        LIMIT 50
                    """, (project_number, cutoff_date))
                    entries = [dict(row) for row in cursor.fetchall()]
                    return entries

            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(_thread_pool, get_timeline_data)

            # Get GitHub project timeline if available (Phase 3: use owner param if provided)
            project_context = await _pcm.get_project_context()
            if not owner and 'repo_path' in project_context:
                owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
                if owner:
                    owner_type = _github_projects.detect_owner_type(owner)

            github_timeline: List[Dict[str, Any]] = []
            if owner and _github_projects.api_manager:
                github_timeline = _github_projects.api_manager.get_project_timeline(owner, project_number, days=30, owner_type=owner_type)

            # Combine timelines
            combined: List[Dict[str, Any]] = []
            
            # Add journal entries
            for entry in entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Add GitHub project items
            combined.extend(github_timeline)
            
            # Sort by timestamp
            combined.sort(key=lambda x: x['timestamp'], reverse=True)
            
            # Format as Markdown timeline
            timeline: str = f"# Project #{project_number} Activity Timeline\n\n"
            timeline += f"*Last 30 days of activity - {len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined[:50]:
                event_date = event['timestamp'][:10]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Format event based on type
                if event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"**Time:** {event['timestamp'][11:16]}  \n"
                    timeline += f"{event['content']}\n\n"
                elif event['type'] == 'project_item':
                    timeline += f"### 🎯 Project Item Updated\n"
                    timeline += f"**Title:** {event['title']}  \n"
                    timeline += f"**Status:** {event['status']}  \n"
                    timeline += f"**Type:** {event['content_type']}  \n\n"
            
            if not combined:
                timeline += "*No activity in the last 30 days*\n"
            
            return timeline
            
        except (ValueError, IndexError) as e:
            raise ValueError(f"Invalid project timeline URI: {uri_str}. Expected format: memory://projects/<number>/timeline")
        except Exception as e:
            raise

    elif uri_str.startswith("memory://issues/") and "/entries" in uri_str:
        # Phase 3: Issue Journal Entries Resource
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'issue_entries':
                raise ValueError(f"Invalid issue entries URI: {uri_str}")
            
            issue_number = parsed['issue_number']
            
            def get_issue_entries():
                with _db.get_connection() as conn:
                    # Get all entries for this issue
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, 
                               pr_number, project_number, project_context
                        FROM memory_journal
                        WHERE issue_number = ? AND deleted_at IS NULL
                        ORDER BY timestamp ASC
                    """, (issue_number,))
                    entries = [dict(row) for row in cursor.fetchall()]
                    
                    # Get tags for each entry
                    for entry in entries:
                        cursor = conn.execute("""
                            SELECT t.name FROM tags t
                            JOIN entry_tags et ON t.id = et.tag_id
                            WHERE et.entry_id = ?
                        """, (entry['id'],))
                        entry['tags'] = [row[0] for row in cursor.fetchall()]
                    
                    return entries
            
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(_thread_pool, get_issue_entries)
            
            # Format as JSON
            entries_list: List[Dict[str, Any]] = []
            result: Dict[str, Any] = {
                "issue_number": issue_number,
                "entry_count": len(entries),
                "entries": entries_list
            }
            
            for entry in entries:
                entries_list.append({
                    "id": entry['id'],
                    "entry_type": entry['entry_type'],
                    "content": entry['content'],
                    "timestamp": entry['timestamp'],
                    "is_personal": bool(entry['is_personal']),
                    "tags": entry['tags'],
                    "pr_number": entry.get('pr_number'),
                    "project_number": entry.get('project_number')
                })
            
            return json.dumps(result, indent=2)
            
        except Exception as e:
            raise ValueError(f"Error reading issue entries: {str(e)}")

    elif uri_str.startswith("memory://prs/") and "/entries" in uri_str:
        # Phase 3: PR Journal Entries Resource
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'pr_entries':
                raise ValueError(f"Invalid PR entries URI: {uri_str}")
            
            pr_number = parsed['pr_number']
            
            def get_pr_entries():
                with _db.get_connection() as conn:
                    # Get all entries for this PR
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, 
                               pr_status, issue_number, project_number, project_context
                        FROM memory_journal
                        WHERE pr_number = ? AND deleted_at IS NULL
                        ORDER BY timestamp ASC
                    """, (pr_number,))
                    entries = [dict(row) for row in cursor.fetchall()]
                    
                    # Get tags for each entry
                    for entry in entries:
                        cursor = conn.execute("""
                            SELECT t.name FROM tags t
                            JOIN entry_tags et ON t.id = et.tag_id
                            WHERE et.entry_id = ?
                        """, (entry['id'],))
                        entry['tags'] = [row[0] for row in cursor.fetchall()]
                    
                    return entries
            
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(_thread_pool, get_pr_entries)
            
            # Collect PR status summary and linked issues
            pr_statuses: set[str] = set()
            linked_issues: set[int] = set()
            for entry in entries:
                if entry.get('pr_status'):
                    pr_statuses.add(entry['pr_status'])
                if entry.get('issue_number'):
                    linked_issues.add(entry['issue_number'])
            
            # Format as JSON
            pr_entries_list: List[Dict[str, Any]] = []
            result: Dict[str, Any] = {
                "pr_number": pr_number,
                "entry_count": len(entries),
                "pr_status_summary": list(pr_statuses),
                "linked_issues": sorted(list(linked_issues)),
                "entries": pr_entries_list
            }
            
            for entry in entries:
                pr_entries_list.append({
                    "id": entry['id'],
                    "entry_type": entry['entry_type'],
                    "content": entry['content'],
                    "timestamp": entry['timestamp'],
                    "is_personal": bool(entry['is_personal']),
                    "tags": entry['tags'],
                    "pr_status": entry.get('pr_status'),
                    "issue_number": entry.get('issue_number'),
                    "project_number": entry.get('project_number')
                })
            
            return json.dumps(result, indent=2)
            
        except Exception as e:
            raise ValueError(f"Error reading PR entries: {str(e)}")

    elif uri_str.startswith("memory://prs/") and "/timeline" in uri_str:
        # Phase 3: PR Timeline Resource
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'pr_timeline':
                raise ValueError(f"Invalid PR timeline URI: {uri_str}")
            
            pr_number = parsed['pr_number']
            
            def get_pr_journal_entries():
                with _db.get_connection() as conn:
                    # Get journal entries for this PR
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, project_context
                        FROM memory_journal
                        WHERE pr_number = ? AND deleted_at IS NULL
                        ORDER BY timestamp ASC
                    """, (pr_number,))
                    return [dict(row) for row in cursor.fetchall()]
            
            loop = asyncio.get_event_loop()
            journal_entries = await loop.run_in_executor(_thread_pool, get_pr_journal_entries)
            
            # Get PR details from GitHub
            pr_details = None
            owner = None
            repo = None
            
            # Try to extract owner/repo from first journal entry's context
            if journal_entries and journal_entries[0].get('project_context'):
                from github.api import extract_repo_info_from_context
                owner, repo = extract_repo_info_from_context(journal_entries[0]['project_context'])
            
            # If not found, get from current context
            if not owner or not repo:
                project_context = await _pcm.get_project_context()
                if 'repo_path' in project_context:
                    owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
                    repo = project_context.get('repo_name')
            
            # Fetch PR details if we have owner/repo
            if owner and repo and _github_projects.github_token:
                from github.api import get_pr_details
                try:
                    pr_details = get_pr_details(github_projects, owner, repo, pr_number)
                except Exception as e:
                    print(f"[WARNING] Failed to fetch PR details: {e}", file=sys.stderr)
            
            # Combine timeline events
            combined: List[Dict[str, Any]] = []
            
            # Add journal entries
            for entry in journal_entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Add PR events from GitHub
            if pr_details:
                # PR created event
                if pr_details.get('created_at'):
                    combined.append({
                        'type': 'pr_created',
                        'timestamp': pr_details['created_at'],
                        'author': pr_details.get('author', 'Unknown'),
                        'title': pr_details.get('title', ''),
                        'draft': pr_details.get('draft', False)
                    })
                
                # PR merged event
                if pr_details.get('merged_at'):
                    combined.append({
                        'type': 'pr_merged',
                        'timestamp': pr_details['merged_at'],
                        'base_branch': pr_details.get('base_branch', 'main')
                    })
                
                # PR closed event (if closed but not merged)
                if pr_details.get('closed_at') and not pr_details.get('merged_at'):
                    combined.append({
                        'type': 'pr_closed',
                        'timestamp': pr_details['closed_at']
                    })
            
            # Sort chronologically
            combined.sort(key=lambda x: x['timestamp'])
            
            # Format as Markdown timeline
            timeline: str = f"# Pull Request #{pr_number} Activity Timeline\n\n"
            
            if pr_details:
                timeline += f"**Title:** {pr_details.get('title', 'Unknown')}  \n"
                timeline += f"**Author:** {pr_details.get('author', 'Unknown')}  \n"
                timeline += f"**Status:** {pr_details.get('state', 'unknown')}"
                if pr_details.get('draft'):
                    timeline += " (draft)"
                timeline += "  \n"
                if pr_details.get('url'):
                    timeline += f"**URL:** {pr_details['url']}  \n"
                timeline += "\n"
            
            timeline += f"*{len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined:
                event_timestamp = event['timestamp']
                event_date = event_timestamp[:10] if isinstance(event_timestamp, str) else event_timestamp.split('T')[0]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Extract time
                event_time = event_timestamp[11:16] if len(event_timestamp) > 16 else event_timestamp.split('T')[1][:5] if 'T' in event_timestamp else '00:00'
                
                # Format event based on type
                if event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']} - {event_time}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"{event['content']}\n\n"
                elif event['type'] == 'pr_created':
                    timeline += f"### 🚀 Pull Request Created - {event_time}\n"
                    timeline += f"**Author:** {event['author']}  \n"
                    timeline += f"**Title:** {event['title']}  \n"
                    if event.get('draft'):
                        timeline += f"**Status:** Draft  \n"
                    timeline += "\n"
                elif event['type'] == 'pr_merged':
                    timeline += f"### ✅ Pull Request Merged - {event_time}\n"
                    timeline += f"**Target:** {event['base_branch']}  \n\n"
                elif event['type'] == 'pr_closed':
                    timeline += f"### ❌ Pull Request Closed - {event_time}\n\n"
            
            if not combined:
                timeline += "*No activity found for this PR*\n"
            
            return timeline
            
        except Exception as e:
            raise ValueError(f"Error reading PR timeline: {str(e)}")

    elif uri_str.startswith("memory://actions/recent"):
        # GitHub Actions: Recent workflow runs with filtering
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'actions_recent':
                raise ValueError(f"Invalid actions recent URI: {uri_str}")
            
            # Extract filter parameters
            branch_filter = parsed.get('branch')
            workflow_filter = parsed.get('workflow')
            commit_filter = parsed.get('commit')
            pr_filter = parsed.get('pr')
            limit = parsed.get('limit', 10)
            
            # Get repo context
            project_context = await _pcm.get_project_context()
            owner = None
            repo = None
            
            if 'repo_path' in project_context:
                owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
                repo = project_context.get('repo_name')
            
            if not owner or not repo:
                return json.dumps({
                    "error": "Could not determine repository owner/name from current context",
                    "runs": [],
                    "ci_status": "unknown"
                }, indent=2)
            
            # Fetch workflow runs based on filters
            from github.api import (
                get_repo_workflow_runs, get_workflow_runs_by_name,
                get_workflow_runs_for_commit, get_workflow_runs_for_pr,
                compute_ci_status
            )
            
            runs = []
            if commit_filter:
                # Filter by commit SHA
                runs = get_workflow_runs_for_commit(github_projects, owner, repo, commit_filter, limit=limit)
            elif pr_filter:
                # Filter by PR number
                runs = get_workflow_runs_for_pr(github_projects, owner, repo, pr_filter, limit=limit)
            elif workflow_filter:
                # Filter by workflow name
                runs = get_workflow_runs_by_name(github_projects, owner, repo, workflow_filter, branch=branch_filter, limit=limit)
            else:
                # Default: get recent runs with optional branch filter
                runs = get_repo_workflow_runs(github_projects, owner, repo, branch=branch_filter, limit=limit)
            
            # Compute CI status
            ci_status = compute_ci_status(runs)
            
            # Get related journal entries for these workflow runs
            def get_related_entries() -> List[Dict[str, Any]]:
                if not runs:
                    return []
                workflow_run_ids = [run.get('id') for run in runs if run.get('id')]
                if not workflow_run_ids:
                    return []
                
                with _db.get_connection() as conn:
                    placeholders = ','.join(['?' for _ in workflow_run_ids])
                    cursor = conn.execute(f"""
                        SELECT id, entry_type, content, timestamp, workflow_run_id, workflow_name
                        FROM memory_journal
                        WHERE workflow_run_id IN ({placeholders}) AND deleted_at IS NULL
                        ORDER BY timestamp DESC
                        LIMIT 20
                    """, workflow_run_ids)
                    return [dict(row) for row in cursor.fetchall()]
            
            loop = asyncio.get_event_loop()
            related_entries = await loop.run_in_executor(_thread_pool, get_related_entries)
            
            # Format response
            result = {
                "repository": f"{owner}/{repo}",
                "filters": {
                    "branch": branch_filter,
                    "workflow": workflow_filter,
                    "commit": commit_filter,
                    "pr": pr_filter
                },
                "ci_status": ci_status,
                "run_count": len(runs),
                "runs": [
                    {
                        "id": run.get('id'),
                        "name": run.get('name'),
                        "status": run.get('status'),
                        "conclusion": run.get('conclusion'),
                        "head_branch": run.get('head_branch'),
                        "head_sha": run.get('head_sha', '')[:7] if run.get('head_sha') else None,
                        "event": run.get('event'),
                        "created_at": run.get('created_at'),
                        "updated_at": run.get('updated_at'),
                        "html_url": run.get('html_url'),
                        "actor": run.get('actor')
                    }
                    for run in runs
                ],
                "related_journal_entries": [
                    {
                        "id": entry.get('id'),
                        "entry_type": entry.get('entry_type'),
                        "content_preview": (entry.get('content', '')[:100] + '...' 
                                          if len(entry.get('content', '')) > 100 
                                          else entry.get('content', '')),
                        "timestamp": entry.get('timestamp'),
                        "workflow_run_id": entry.get('workflow_run_id')
                    }
                    for entry in related_entries
                ]
            }
            
            return json.dumps(result, indent=2)
            
        except Exception as e:
            raise ValueError(f"Error reading actions recent: {str(e)}")

    elif uri_str.startswith("memory://actions/workflows/") and "/timeline" in uri_str:
        # GitHub Actions: Workflow-specific timeline
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'actions_workflow_timeline':
                raise ValueError(f"Invalid workflow timeline URI: {uri_str}")
            
            workflow_name = parsed['workflow_name']
            
            # Get repo context
            project_context = await _pcm.get_project_context()
            owner = None
            repo = None
            
            if 'repo_path' in project_context:
                owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
                repo = project_context.get('repo_name')
            
            if not owner or not repo:
                return f"# Workflow Timeline: {workflow_name}\n\n*Error: Could not determine repository context*\n"
            
            # Fetch workflow runs for this workflow
            from github.api import get_workflow_runs_by_name, compute_ci_status
            
            runs = get_workflow_runs_by_name(github_projects, owner, repo, workflow_name, limit=20)
            ci_status = compute_ci_status(runs)
            
            # Get related journal entries
            def get_workflow_entries():
                with _db.get_connection() as conn:
                    # Get entries linked to this workflow by name or by run IDs
                    workflow_run_ids = [run.get('id') for run in runs if run.get('id')]
                    
                    if workflow_run_ids:
                        placeholders = ','.join(['?' for _ in workflow_run_ids])
                        cursor = conn.execute(f"""
                            SELECT id, entry_type, content, timestamp, workflow_run_id, workflow_name, pr_number
                            FROM memory_journal
                            WHERE (workflow_name = ? OR workflow_run_id IN ({placeholders}))
                              AND deleted_at IS NULL
                            ORDER BY timestamp DESC
                            LIMIT 30
                        """, [workflow_name] + workflow_run_ids)
                    else:
                        cursor = conn.execute("""
                            SELECT id, entry_type, content, timestamp, workflow_run_id, workflow_name, pr_number
                            FROM memory_journal
                            WHERE workflow_name = ? AND deleted_at IS NULL
                            ORDER BY timestamp DESC
                            LIMIT 30
                        """, (workflow_name,))
                    
                    return [dict(row) for row in cursor.fetchall()]
            
            loop = asyncio.get_event_loop()
            journal_entries = await loop.run_in_executor(_thread_pool, get_workflow_entries)
            
            # Get PR details for runs triggered by PRs
            from github.api import get_pr_details
            pr_events: List[Dict[str, Any]] = []
            seen_prs: set[int] = set()
            for run in runs:
                if run.get('event') == 'pull_request' and run.get('head_branch'):
                    # Extract PR number from branch or linked entries
                    for entry in journal_entries:
                        if entry.get('pr_number') and entry.get('pr_number') not in seen_prs:
                            try:
                                pr_detail = get_pr_details(github_projects, owner, repo, entry['pr_number'])
                                if pr_detail:
                                    pr_events.append({
                                        'type': 'pr_event',
                                        'timestamp': pr_detail.get('created_at', ''),
                                        'pr_number': entry['pr_number'],
                                        'title': pr_detail.get('title', ''),
                                        'state': pr_detail.get('state', ''),
                                        'author': pr_detail.get('author', '')
                                    })
                                    seen_prs.add(entry['pr_number'])
                            except Exception:
                                pass
            
            # Combine all events
            combined: List[Dict[str, Any]] = []
            
            # Add workflow runs
            for run in runs:
                combined.append({
                    'type': 'workflow_run',
                    'timestamp': run.get('created_at', ''),
                    'id': run.get('id'),
                    'name': run.get('name'),
                    'status': run.get('status'),
                    'conclusion': run.get('conclusion'),
                    'head_branch': run.get('head_branch'),
                    'head_sha': run.get('head_sha', '')[:7] if run.get('head_sha') else '',
                    'event': run.get('event'),
                    'actor': run.get('actor')
                })
            
            # Add journal entries
            for entry in journal_entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Add PR events
            combined.extend(pr_events)
            
            # Sort by timestamp descending
            combined.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            
            # Format as Markdown timeline
            timeline: str = f"# Workflow Timeline: {workflow_name}\n\n"
            timeline += f"**Repository:** {owner}/{repo}  \n"
            timeline += f"**CI Status:** {ci_status}  \n"
            timeline += f"*{len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined[:50]:
                event_timestamp = event.get('timestamp', '')
                if not event_timestamp:
                    continue
                    
                event_date = event_timestamp[:10]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Extract time
                event_time = event_timestamp[11:16] if len(event_timestamp) > 16 else '00:00'
                
                # Format event based on type
                if event['type'] == 'workflow_run':
                    status_icon = '✅' if event.get('conclusion') == 'success' else '❌' if event.get('conclusion') == 'failure' else '🔄'
                    timeline += f"### {status_icon} Workflow Run - {event_time}\n"
                    timeline += f"**Status:** {event.get('status')} ({event.get('conclusion') or 'in progress'})  \n"
                    timeline += f"**Branch:** {event.get('head_branch')}  \n"
                    timeline += f"**Commit:** {event.get('head_sha')}  \n"
                    timeline += f"**Trigger:** {event.get('event')}  \n"
                    if event.get('actor'):
                        timeline += f"**Actor:** {event['actor']}  \n"
                    timeline += "\n"
                elif event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']} - {event_time}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"{event['content']}\n\n"
                elif event['type'] == 'pr_event':
                    timeline += f"### 🔀 Pull Request #{event.get('pr_number')} - {event_time}\n"
                    timeline += f"**Title:** {event.get('title')}  \n"
                    timeline += f"**State:** {event.get('state')}  \n"
                    timeline += f"**Author:** {event.get('author')}  \n\n"
            
            if not combined:
                timeline += "*No activity found for this workflow*\n"
            
            return timeline
            
        except Exception as e:
            raise ValueError(f"Error reading workflow timeline: {str(e)}")

    elif uri_str.startswith("memory://actions/branches/") and "/timeline" in uri_str:
        # GitHub Actions: Branch-specific timeline
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'actions_branch_timeline':
                raise ValueError(f"Invalid branch timeline URI: {uri_str}")
            
            branch = parsed['branch']
            
            # Get repo context
            project_context = await _pcm.get_project_context()
            owner = None
            repo = None
            
            if 'repo_path' in project_context:
                owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
                repo = project_context.get('repo_name')
            
            if not owner or not repo:
                return f"# Branch Timeline: {branch}\n\n*Error: Could not determine repository context*\n"
            
            # Fetch workflow runs for this branch
            from github.api import get_repo_workflow_runs, compute_ci_status, get_pr_from_branch, get_pr_details
            
            runs = get_repo_workflow_runs(github_projects, owner, repo, branch=branch, limit=20)
            ci_status = compute_ci_status(runs)
            
            # Check if there's a PR for this branch
            pr_detail = None
            try:
                pr_info = get_pr_from_branch(github_projects, owner, repo, branch)
                if pr_info:
                    pr_detail = get_pr_details(github_projects, owner, repo, pr_info['number'])
            except Exception:
                pass
            
            # Get journal entries related to this branch (from project_context JSON)
            def get_branch_entries():
                with _db.get_connection() as conn:
                    # Search for entries with this branch in project_context
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, workflow_run_id, workflow_name, pr_number, project_context
                        FROM memory_journal
                        WHERE project_context LIKE ? AND deleted_at IS NULL
                        ORDER BY timestamp DESC
                        LIMIT 30
                    """, (f'%"branch": "{branch}"%',))
                    return [dict(row) for row in cursor.fetchall()]
            
            loop = asyncio.get_event_loop()
            journal_entries = await loop.run_in_executor(_thread_pool, get_branch_entries)
            
            # Combine all events
            combined: List[Dict[str, Any]] = []
            
            # Add workflow runs
            for run in runs:
                combined.append({
                    'type': 'workflow_run',
                    'timestamp': run.get('created_at', ''),
                    'id': run.get('id'),
                    'name': run.get('name'),
                    'status': run.get('status'),
                    'conclusion': run.get('conclusion'),
                    'head_sha': run.get('head_sha', '')[:7] if run.get('head_sha') else '',
                    'event': run.get('event'),
                    'actor': run.get('actor')
                })
            
            # Add journal entries
            for entry in journal_entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Add PR events if available
            if pr_detail:
                if pr_detail.get('created_at'):
                    combined.append({
                        'type': 'pr_created',
                        'timestamp': pr_detail['created_at'],
                        'pr_number': pr_detail.get('number'),
                        'title': pr_detail.get('title', ''),
                        'author': pr_detail.get('author', ''),
                        'draft': pr_detail.get('draft', False)
                    })
                if pr_detail.get('merged_at'):
                    combined.append({
                        'type': 'pr_merged',
                        'timestamp': pr_detail['merged_at'],
                        'pr_number': pr_detail.get('number'),
                        'base_branch': pr_detail.get('base_branch', 'main')
                    })
                if pr_detail.get('closed_at') and not pr_detail.get('merged_at'):
                    combined.append({
                        'type': 'pr_closed',
                        'timestamp': pr_detail['closed_at'],
                        'pr_number': pr_detail.get('number')
                    })
            
            # Sort by timestamp descending
            combined.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            
            # Format as Markdown timeline
            timeline: str = f"# Branch Timeline: {branch}\n\n"
            timeline += f"**Repository:** {owner}/{repo}  \n"
            timeline += f"**CI Status:** {ci_status}  \n"
            if pr_detail:
                timeline += f"**Active PR:** #{pr_detail.get('number')} - {pr_detail.get('title', '')}  \n"
            timeline += f"*{len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined[:50]:
                event_timestamp = event.get('timestamp', '')
                if not event_timestamp:
                    continue
                    
                event_date = event_timestamp[:10]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Extract time
                event_time = event_timestamp[11:16] if len(event_timestamp) > 16 else '00:00'
                
                # Format event based on type
                if event['type'] == 'workflow_run':
                    status_icon = '✅' if event.get('conclusion') == 'success' else '❌' if event.get('conclusion') == 'failure' else '🔄'
                    timeline += f"### {status_icon} {event.get('name', 'Workflow')} - {event_time}\n"
                    timeline += f"**Status:** {event.get('status')} ({event.get('conclusion') or 'in progress'})  \n"
                    timeline += f"**Commit:** {event.get('head_sha')}  \n"
                    timeline += f"**Trigger:** {event.get('event')}  \n"
                    if event.get('actor'):
                        timeline += f"**Actor:** {event['actor']}  \n"
                    timeline += "\n"
                elif event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']} - {event_time}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"{event['content']}\n\n"
                elif event['type'] == 'pr_created':
                    timeline += f"### 🚀 PR #{event.get('pr_number')} Created - {event_time}\n"
                    timeline += f"**Title:** {event.get('title')}  \n"
                    timeline += f"**Author:** {event.get('author')}  \n"
                    if event.get('draft'):
                        timeline += f"**Status:** Draft  \n"
                    timeline += "\n"
                elif event['type'] == 'pr_merged':
                    timeline += f"### ✅ PR #{event.get('pr_number')} Merged - {event_time}\n"
                    timeline += f"**Target:** {event.get('base_branch')}  \n\n"
                elif event['type'] == 'pr_closed':
                    timeline += f"### ❌ PR #{event.get('pr_number')} Closed - {event_time}\n\n"
            
            if not combined:
                timeline += "*No activity found for this branch*\n"
            
            return timeline
            
        except Exception as e:
            raise ValueError(f"Error reading branch timeline: {str(e)}")

    elif uri_str.startswith("memory://actions/commits/") and "/timeline" in uri_str:
        # GitHub Actions: Commit-specific timeline
        try:
            parsed = parse_resource_uri(uri_str)
            if parsed['type'] != 'actions_commit_timeline':
                raise ValueError(f"Invalid commit timeline URI: {uri_str}")
            
            sha = parsed['sha']
            
            # Get repo context
            project_context = await _pcm.get_project_context()
            owner = None
            repo = None
            
            if 'repo_path' in project_context:
                owner = _github_projects.extract_repo_owner_from_remote(project_context['repo_path'])
                repo = project_context.get('repo_name')
            
            if not owner or not repo:
                return f"# Commit Timeline: {sha[:7]}\n\n*Error: Could not determine repository context*\n"
            
            # Fetch workflow runs for this commit
            from github.api import get_workflow_runs_for_commit, compute_ci_status
            
            runs = get_workflow_runs_for_commit(github_projects, owner, repo, sha, limit=20)
            ci_status = compute_ci_status(runs)
            
            # Get journal entries that reference this commit (in project_context)
            def get_commit_entries():
                with _db.get_connection() as conn:
                    # Search for entries with this commit SHA in project_context
                    # We search for both full SHA and short SHA
                    short_sha = sha[:7]
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, workflow_run_id, workflow_name, pr_number, project_context
                        FROM memory_journal
                        WHERE (project_context LIKE ? OR project_context LIKE ?)
                          AND deleted_at IS NULL
                        ORDER BY timestamp DESC
                        LIMIT 20
                    """, (f'%{sha}%', f'%"hash": "{short_sha}"%'))
                    return [dict(row) for row in cursor.fetchall()]
            
            loop = asyncio.get_event_loop()
            journal_entries = await loop.run_in_executor(_thread_pool, get_commit_entries)
            
            # Combine all events
            combined: List[Dict[str, Any]] = []
            
            # Add workflow runs
            for run in runs:
                combined.append({
                    'type': 'workflow_run',
                    'timestamp': run.get('created_at', ''),
                    'id': run.get('id'),
                    'name': run.get('name'),
                    'status': run.get('status'),
                    'conclusion': run.get('conclusion'),
                    'head_branch': run.get('head_branch'),
                    'event': run.get('event'),
                    'actor': run.get('actor')
                })
            
            # Add journal entries
            for entry in journal_entries:
                combined.append({
                    'type': 'journal_entry',
                    'timestamp': entry['timestamp'],
                    'id': entry['id'],
                    'entry_type': entry['entry_type'],
                    'content': entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                })
            
            # Sort by timestamp descending
            combined.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            
            # Format as Markdown timeline
            timeline: str = f"# Commit Timeline: {sha[:7]}\n\n"
            timeline += f"**Repository:** {owner}/{repo}  \n"
            timeline += f"**Full SHA:** {sha}  \n"
            timeline += f"**CI Status:** {ci_status}  \n"
            if runs:
                timeline += f"**Branch:** {runs[0].get('head_branch', 'unknown')}  \n"
            timeline += f"*{len(combined)} events*\n\n"
            timeline += "---\n\n"
            
            current_date = None
            for event in combined[:50]:
                event_timestamp = event.get('timestamp', '')
                if not event_timestamp:
                    continue
                    
                event_date = event_timestamp[:10]
                
                # Add date header when date changes
                if event_date != current_date:
                    timeline += f"\n## {event_date}\n\n"
                    current_date = event_date
                
                # Extract time
                event_time = event_timestamp[11:16] if len(event_timestamp) > 16 else '00:00'
                
                # Format event based on type
                if event['type'] == 'workflow_run':
                    status_icon = '✅' if event.get('conclusion') == 'success' else '❌' if event.get('conclusion') == 'failure' else '🔄'
                    timeline += f"### {status_icon} {event.get('name', 'Workflow')} - {event_time}\n"
                    timeline += f"**Status:** {event.get('status')} ({event.get('conclusion') or 'in progress'})  \n"
                    timeline += f"**Branch:** {event.get('head_branch')}  \n"
                    timeline += f"**Trigger:** {event.get('event')}  \n"
                    if event.get('actor'):
                        timeline += f"**Actor:** {event['actor']}  \n"
                    timeline += "\n"
                elif event['type'] == 'journal_entry':
                    timeline += f"### 📝 Journal Entry #{event['id']} - {event_time}\n"
                    timeline += f"**Type:** {event['entry_type']}  \n"
                    timeline += f"{event['content']}\n\n"
            
            if not combined:
                timeline += "*No activity found for this commit*\n"
            
            return timeline
            
        except Exception as e:
            raise ValueError(f"Error reading commit timeline: {str(e)}")

    else:
        raise ValueError(f"Unknown resource: {uri_str}")
