"""
Memory Journal MCP Server - GitHub Actions Workflow Prompt Handlers
Handlers for GitHub Actions failure analysis and CI/CD workflow insights.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

from mcp.types import GetPromptResult, PromptMessage, TextContent

from database.base import MemoryJournalDB
from database.context import ProjectContextManager
from github.integration import GitHubProjectsIntegration
from vector_search import VectorSearchManager

# Global instances (initialized by main server)
db: Optional[MemoryJournalDB] = None
project_context_manager: Optional[ProjectContextManager] = None
github_projects: Optional[GitHubProjectsIntegration] = None
vector_search: Optional[VectorSearchManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_actions_prompts(
    db_instance: MemoryJournalDB,
    context_manager: ProjectContextManager,
    github_instance: GitHubProjectsIntegration,
    vector_search_instance: Optional[VectorSearchManager],
    pool: ThreadPoolExecutor
) -> None:
    """Initialize GitHub Actions workflow prompt handlers."""
    global db, project_context_manager, github_projects, vector_search, thread_pool
    db = db_instance
    project_context_manager = context_manager
    github_projects = github_instance
    vector_search = vector_search_instance
    thread_pool = pool


async def handle_actions_failure_digest(arguments: Dict[str, str]) -> GetPromptResult:
    """
    Generate a comprehensive digest of GitHub Actions failures.
    
    Args:
        branch: Optional branch filter
        workflow_name: Optional workflow name filter
        pr_number: Optional PR number filter
        days_back: How far back to look (default: 7)
        limit: Maximum failures to analyze (default: 5)
    
    Returns:
        GetPromptResult with formatted failure digest including:
        - Failing jobs summary
        - Linked journal entries
        - Recent code/PR changes
        - Previous similar failures
        - Possible root causes
        - Next steps
    """
    if db is None or project_context_manager is None or github_projects is None or thread_pool is None:
        raise RuntimeError("Actions prompt handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    _pcm = project_context_manager
    _github_projects = github_projects
    
    # Parse arguments
    branch_filter = arguments.get("branch")
    workflow_filter = arguments.get("workflow_name")
    pr_number_str = arguments.get("pr_number")
    days_back = int(arguments.get("days_back", "7"))
    limit = int(arguments.get("limit", "5"))
    
    pr_number: Optional[int] = None
    if pr_number_str:
        try:
            pr_number = int(pr_number_str)
        except ValueError:
            return GetPromptResult(
                messages=[PromptMessage(
                    role="user",
                    content=TextContent(type="text", text="Error: pr_number must be a valid integer")
                )]
            )
    
    # Get project context
    project_context = await _pcm.get_project_context()
    
    # Extract owner/repo from context
    owner: Optional[str] = None
    repo: Optional[str] = None
    
    if 'repo_path' in project_context:
        owner = _github_projects.extract_repo_owner_from_remote(project_context.get('repo_path', ''))
        repo = project_context.get('repo_name')
    
    if not owner or not repo:
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(
                    type="text",
                    text="# GitHub Actions Failure Digest\n\n"
                         "**Error:** Could not determine repository owner/name from current context.\n\n"
                         "Ensure you are in a Git repository with a GitHub remote configured."
                )
            )]
        )
    
    # Import API functions
    from github.api import (
        get_failed_workflow_runs,
        get_workflow_run_jobs,
        get_workflow_runs_for_pr,
        get_pr_details
    )
    
    # Fetch failed workflow runs
    if pr_number:
        # Get runs for specific PR first, then filter for failures
        all_pr_runs = get_workflow_runs_for_pr(github_projects, owner, repo, pr_number, limit=limit * 3)
        failed_runs = [
            run for run in all_pr_runs
            if run.get('conclusion', '').lower() in ('failure', 'timed_out')
        ][:limit]
    else:
        failed_runs = get_failed_workflow_runs(
            github_projects, owner, repo,
            branch=branch_filter,
            workflow_name=workflow_filter,
            limit=limit
        )
    
    # Filter by days_back
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_back)
    failed_runs = [
        run for run in failed_runs
        if _parse_timestamp(run.get('created_at', '')) >= cutoff_date
    ]
    
    # Build the digest
    digest = f"# GitHub Actions Failure Digest\n\n"
    digest += f"**Repository:** {owner}/{repo}  \n"
    digest += f"**Analysis Period:** Last {days_back} days  \n"
    
    if branch_filter:
        digest += f"**Branch Filter:** {branch_filter}  \n"
    if workflow_filter:
        digest += f"**Workflow Filter:** {workflow_filter}  \n"
    if pr_number:
        digest += f"**PR Filter:** #{pr_number}  \n"
    
    digest += f"**Failures Found:** {len(failed_runs)}  \n\n"
    
    if not failed_runs:
        digest += "---\n\n"
        digest += "## No Recent Failures Found\n\n"
        digest += "No failing workflow runs were found matching the specified criteria.\n"
        return GetPromptResult(
            messages=[PromptMessage(
                role="user",
                content=TextContent(type="text", text=digest)
            )]
        )
    
    digest += "---\n\n"
    
    # 1. Failing Jobs Summary
    digest += "## 1. Failing Jobs Summary\n\n"
    
    all_failure_texts: List[str] = []  # For semantic search later
    affected_commits: List[str] = []
    affected_branches: List[str] = []
    
    for run in failed_runs:
        run_id = run.get('id')
        run_name = run.get('name', 'Unknown Workflow')
        run_branch = run.get('head_branch', 'unknown')
        run_sha = run.get('head_sha', '')[:7] if run.get('head_sha') else 'unknown'
        run_created = run.get('created_at', '')[:10] if run.get('created_at') else 'unknown'
        run_url = run.get('html_url', '')
        
        if run.get('head_sha'):
            affected_commits.append(run['head_sha'])
        if run_branch and run_branch not in affected_branches:
            affected_branches.append(run_branch)
        
        digest += f"### {run_name}\n\n"
        digest += f"- **Run ID:** {run_id}  \n"
        digest += f"- **Branch:** `{run_branch}`  \n"
        digest += f"- **Commit:** `{run_sha}`  \n"
        digest += f"- **Date:** {run_created}  \n"
        digest += f"- **Trigger:** {run.get('event', 'unknown')}  \n"
        if run_url:
            digest += f"- **[View on GitHub]({run_url})**  \n"
        digest += "\n"
        
        # Get job details
        if run_id:
            jobs = get_workflow_run_jobs(github_projects, owner, repo, run_id)
            failed_jobs = [j for j in jobs if j.get('conclusion', '').lower() in ('failure', 'timed_out')]
            
            if failed_jobs:
                digest += "**Failed Jobs:**\n\n"
                for job in failed_jobs:
                    job_name = job.get('name', 'Unknown Job')
                    job_url = job.get('html_url', '')
                    
                    digest += f"- **{job_name}**"
                    if job_url:
                        digest += f" ([view]({job_url}))"
                    digest += "\n"
                    
                    # Find failed steps
                    failed_steps = [
                        s for s in job.get('steps', [])
                        if s.get('conclusion', '').lower() in ('failure', 'timed_out')
                    ]
                    
                    if failed_steps:
                        for step in failed_steps:
                            step_name = step.get('name', 'Unknown Step')
                            digest += f"  - Failed step: `{step_name}`\n"
                            all_failure_texts.append(f"CI failure in {run_name}: {job_name} - {step_name}")
                    else:
                        all_failure_texts.append(f"CI failure in {run_name}: {job_name}")
                
                digest += "\n"
        
        digest += "---\n\n"
    
    # 2. Linked Journal Entries
    digest += "## 2. Linked Journal Entries\n\n"
    
    linked_entries = await _get_linked_journal_entries(
        affected_commits, affected_branches, pr_number
    )
    
    if linked_entries:
        for entry in linked_entries[:10]:  # Limit to 10
            entry_id = entry.get('id')
            entry_type = entry.get('entry_type', 'unknown')
            entry_date = entry.get('timestamp', '')[:10]
            content_preview = entry.get('content', '')[:150]
            if len(entry.get('content', '')) > 150:
                content_preview += "..."
            
            digest += f"- **Entry #{entry_id}** ({entry_type}) - {entry_date}  \n"
            digest += f"  {content_preview}\n\n"
    else:
        digest += "*No journal entries linked to the affected commits/branches.*\n\n"
    
    # 3. Recent Code/PR Changes
    digest += "## 3. Recent Code/PR Changes\n\n"
    
    # Include relevant context from project_context
    if project_context.get('branch'):
        digest += f"**Current Branch:** `{project_context['branch']}`  \n"
    if project_context.get('commit'):
        digest += f"**Current Commit:** `{project_context['commit'][:7]}`  \n"
    
    # Get PR info if available
    if pr_number:
        pr_details = get_pr_details(github_projects, owner, repo, pr_number)
        if pr_details:
            digest += f"\n**Pull Request #{pr_number}:**  \n"
            digest += f"- Title: {pr_details.get('title', 'Unknown')}  \n"
            digest += f"- Author: {pr_details.get('author', 'Unknown')}  \n"
            digest += f"- Changes: {pr_details.get('changed_files', 0)} files, "
            digest += f"+{pr_details.get('additions', 0)} / -{pr_details.get('deletions', 0)} lines  \n"
            if pr_details.get('url'):
                digest += f"- [View PR on GitHub]({pr_details['url']})  \n"
    
    # Add GitHub Projects context if available
    github_ctx = project_context.get('github_projects', {})
    if github_ctx.get('user_projects') or github_ctx.get('org_projects'):
        digest += "\n**Active Projects:**  \n"
        all_projects = github_ctx.get('user_projects', []) + github_ctx.get('org_projects', [])
        for proj in all_projects[:3]:
            digest += f"- {proj.get('name', 'Unknown')} (#{proj.get('number', '?')})  \n"
    
    digest += "\n"
    
    # 4. Previous Similar Failures
    digest += "## 4. Previous Similar Failures\n\n"
    
    similar_failures = await _find_similar_failures(all_failure_texts)
    
    if similar_failures:
        digest += "Based on semantic analysis, these past journal entries describe similar failures:\n\n"
        for entry, score in similar_failures[:5]:
            entry_id = entry.get('id')
            entry_type = entry.get('entry_type', 'unknown')
            entry_date = entry.get('timestamp', '')[:10]
            content_preview = entry.get('content', '')[:150]
            if len(entry.get('content', '')) > 150:
                content_preview += "..."
            
            digest += f"- **Entry #{entry_id}** ({entry_type}) - {entry_date} (similarity: {score:.2f})  \n"
            digest += f"  {content_preview}\n\n"
    else:
        digest += "*No similar past failures found in journal entries.*\n\n"
    
    # 5. Possible Root Causes
    digest += "## 5. Possible Root Causes\n\n"
    
    root_causes = _analyze_root_causes(failed_runs, linked_entries, similar_failures)
    if root_causes:
        for i, cause in enumerate(root_causes, 1):
            digest += f"{i}. {cause}\n"
    else:
        digest += "*Unable to determine specific root causes. Review the failing steps above.*\n"
    
    digest += "\n"
    
    # 6. Next Steps
    digest += "## 6. Next Steps\n\n"
    
    next_steps = _generate_next_steps(failed_runs, linked_entries, similar_failures)
    for i, step in enumerate(next_steps, 1):
        digest += f"{i}. {step}\n"
    
    return GetPromptResult(
        messages=[PromptMessage(
            role="user",
            content=TextContent(type="text", text=digest)
        )]
    )


def _parse_timestamp(timestamp_str: str) -> datetime:
    """Parse ISO timestamp string to datetime, with fallback to epoch."""
    if not timestamp_str:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        # Handle ISO format with Z suffix
        if timestamp_str.endswith('Z'):
            timestamp_str = timestamp_str[:-1] + '+00:00'
        return datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)


async def _get_linked_journal_entries(
    commits: List[str],
    branches: List[str],
    pr_number: Optional[int]
) -> List[Dict[str, Any]]:
    """Get journal entries linked to the affected commits, branches, or PR."""
    if db is None or thread_pool is None:
        return []
    
    # Capture for use in nested functions
    _db = db
    
    def query_entries() -> List[Dict[str, Any]]:
        entries: List[Dict[str, Any]] = []
        with _db.get_connection() as conn:
            # Query by PR number
            if pr_number:
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp, project_context
                    FROM memory_journal
                    WHERE pr_number = ? AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 10
                """, (pr_number,))
                entries.extend([dict(row) for row in cursor.fetchall()])
            
            # Query by branch (check project_context JSON)
            for branch in branches:
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp, project_context
                    FROM memory_journal
                    WHERE project_context LIKE ? AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 5
                """, (f'%"branch": "{branch}"%',))
                for row in cursor.fetchall():
                    entry = dict(row)
                    if entry['id'] not in [e['id'] for e in entries]:
                        entries.append(entry)
            
            # Query by commit SHA (check project_context JSON)
            for commit in commits[:5]:  # Limit commit searches
                short_sha = commit[:7]
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp, project_context
                    FROM memory_journal
                    WHERE project_context LIKE ? AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                    LIMIT 3
                """, (f'%{short_sha}%',))
                for row in cursor.fetchall():
                    entry = dict(row)
                    if entry['id'] not in [e['id'] for e in entries]:
                        entries.append(entry)
        
        # Sort by timestamp descending
        entries.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return entries
    
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(thread_pool, query_entries)


async def _find_similar_failures(
    failure_texts: List[str]
) -> List[tuple[Dict[str, Any], float]]:
    """Find journal entries semantically similar to the current failure descriptions."""
    if not vector_search or not vector_search.initialized or not failure_texts:
        return []
    
    if db is None or thread_pool is None:
        return []
    
    # Capture for use in nested functions
    _db = db
    
    # Combine failure texts into a search query
    combined_query = " ".join(failure_texts[:5])  # Limit query length
    
    try:
        # Perform semantic search
        semantic_results = await vector_search.semantic_search(
            combined_query,
            limit=10,
            similarity_threshold=0.25  # Lower threshold for CI failures
        )
        
        if not semantic_results:
            return []
        
        # Fetch entry details
        def get_entry_details() -> List[tuple[Dict[str, Any], float]]:
            results: List[tuple[Dict[str, Any], float]] = []
            with _db.get_connection() as conn:
                for entry_id, score in semantic_results:
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp
                        FROM memory_journal
                        WHERE id = ? AND deleted_at IS NULL
                    """, (entry_id,))
                    row = cursor.fetchone()
                    if row:
                        results.append((dict(row), score))
            return results
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(thread_pool, get_entry_details)
        
    except Exception:
        return []


def _analyze_root_causes(
    failed_runs: List[Dict[str, Any]],
    linked_entries: List[Dict[str, Any]],
    similar_failures: List[tuple[Dict[str, Any], float]]
) -> List[str]:
    """Analyze failure patterns to suggest possible root causes."""
    causes: List[str] = []
    
    # Analyze failure patterns
    workflow_names: List[str] = []
    branches: List[str] = []
    triggers: List[str] = []
    
    for run in failed_runs:
        if run.get('name'):
            workflow_names.append(run['name'])
        if run.get('head_branch'):
            branches.append(run['head_branch'])
        if run.get('event'):
            triggers.append(run['event'])
    
    # Check for patterns
    if len(set(workflow_names)) == 1 and len(workflow_names) > 1:
        causes.append(f"Recurring failures in '{workflow_names[0]}' workflow - may indicate a persistent configuration or dependency issue")
    
    if len(set(branches)) == 1 and len(branches) > 1:
        causes.append(f"Multiple failures on branch '{branches[0]}' - changes on this branch may have introduced a regression")
    
    if 'pull_request' in triggers and len(failed_runs) > 0:
        causes.append("Failures triggered by pull request events - PR changes may conflict with existing CI configuration")
    
    # Check linked entries for clues
    for entry in linked_entries[:5]:
        content_lower = entry.get('content', '').lower()
        if any(word in content_lower for word in ['dependency', 'package', 'npm', 'pip', 'version']):
            causes.append("Recent work mentions dependency changes - version conflicts may cause CI failures")
            break
    
    for entry in linked_entries[:5]:
        content_lower = entry.get('content', '').lower()
        if any(word in content_lower for word in ['config', 'configuration', 'yaml', 'workflow']):
            causes.append("Recent work mentions configuration changes - CI workflow configuration may need updates")
            break
    
    # Check similar failures
    if similar_failures:
        causes.append(f"Similar failures have occurred before ({len(similar_failures)} related entries found) - this may be a recurring issue")
    
    if not causes:
        causes.append("Insufficient data to determine specific root causes - examine the failing steps directly")
    
    return causes[:5]  # Limit to 5 causes


def _generate_next_steps(
    failed_runs: List[Dict[str, Any]],
    linked_entries: List[Dict[str, Any]],
    similar_failures: List[tuple[Dict[str, Any], float]]
) -> List[str]:
    """Generate recommended next steps based on the failure analysis."""
    steps: List[str] = []
    
    # Always start with examining logs
    if failed_runs:
        run = failed_runs[0]
        if run.get('html_url'):
            steps.append(f"Review the detailed logs for the most recent failure: {run['html_url']}")
        else:
            steps.append("Review the detailed workflow run logs on GitHub Actions")
    
    # Check for similar failures first
    if similar_failures:
        entry, _ = similar_failures[0]
        steps.append(f"Review Entry #{entry['id']} which describes a similar past failure and may contain a solution")
    
    # Suggest creating a journal entry
    steps.append("Create a journal entry documenting this failure and any investigation findings")
    
    # Workflow-specific suggestions
    workflows = set(run.get('name', '') for run in failed_runs if run.get('name'))
    if len(workflows) == 1:
        steps.append(f"Check the '{list(workflows)[0]}' workflow configuration for recent changes")
    
    # Branch-specific suggestions
    branches = set(run.get('head_branch', '') for run in failed_runs if run.get('head_branch'))
    if branches:
        branch_list = ', '.join(f'`{b}`' for b in list(branches)[:3])
        steps.append(f"Compare recent commits on {branch_list} to identify potential breaking changes")
    
    # If no linked entries, suggest linking
    if not linked_entries:
        steps.append("Link future journal entries to this PR/branch to maintain context for debugging")
    
    # Suggest re-run if transient
    steps.append("Consider re-running the workflow to rule out transient infrastructure issues")
    
    return steps[:7]  # Limit to 7 steps

