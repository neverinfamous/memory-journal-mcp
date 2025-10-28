"""
Memory Journal MCP Server - GitHub API Module
GitHub API operations for projects, milestones, and items.
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, TYPE_CHECKING

from github.cache import get_cache, set_cache
from utils import normalize_owner_type

if TYPE_CHECKING:
    from github.integration import GitHubProjectsIntegration


def get_projects(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    owner_type: str = 'user'
) -> List[Dict[str, Any]]:
    """
    Get GitHub Projects for a user or org with Phase 2 caching (Phase 3 - Issue #17).
    
    Args:
        integration: GitHubProjectsIntegration instance
        owner: GitHub username or organization name
        owner_type: 'user' or 'org'
        
    Returns:
        List of project dictionaries with 'source' field indicating 'user' or 'org'
    """
    # Normalize owner_type
    owner_type = normalize_owner_type(owner_type)
    
    # Check cache first (Phase 2 infrastructure)
    cache_key = f"projects:{owner_type}:{owner}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        return []
    
    # Use GraphQL API for Projects v2 (REST API returns 410 Gone)
    try:
        from github.graphql import get_user_projects_v2, get_org_projects_v2
        
        if owner_type == 'org':
            result = get_org_projects_v2(integration, owner, limit=10)
        else:
            result = get_user_projects_v2(integration, owner, limit=10)
        
        # Cache for 1 hour
        if result:
            set_cache(integration.db_connection, cache_key, result, integration.project_ttl)
        
        return result
        
    except Exception as e:
        print(f"[ERROR] Error fetching GitHub projects: {e}", file=sys.stderr)
        return []


def _get_projects_via_gh_cli(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    owner_type: str = 'user'
) -> List[Dict[str, Any]]:
    """Fallback: Get projects using gh CLI (Phase 3: supports user and org)."""
    try:
        result = subprocess.run(
            ['gh', 'project', 'list', '--owner', owner, '--format', 'json'],
            capture_output=True, text=True,
            timeout=integration.api_timeout, shell=False
        )
        if result.returncode == 0 and result.stdout.strip():
            projects = json.loads(result.stdout.strip())
            return [{
                'number': proj.get('number'),
                'name': proj.get('title'),
                'description': proj.get('body'),
                'url': proj.get('url'),
                'state': proj.get('state', 'OPEN'),
                'created_at': proj.get('createdAt'),
                'updated_at': proj.get('updatedAt'),
                'source': owner_type,  # Phase 3: Mark source
                'owner': owner  # Phase 3: Store owner name
            } for proj in projects.get('projects', [])]
    except Exception:
        pass
    return []


def get_project_items(
    integration: 'GitHubProjectsIntegration',
    username: str,
    project_number: int,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """Get items from a GitHub Project."""
    if not integration.github_token:
        return []
    
    try:
        import requests  # type: ignore[import-not-found]
        url = f"{integration.api_base}/users/{username}/projects/{project_number}/items"
        response = requests.get(
            url,
            headers=integration._get_headers(),
            params={'per_page': limit},
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            items = response.json()
            return [{
                'id': item.get('id'),
                'content_type': item.get('content_type'),
                'content_url': item.get('content_url'),
                'created_at': item.get('created_at'),
                'updated_at': item.get('updated_at')
            } for item in items]
    except ImportError:
        return _get_project_items_via_gh_cli(integration, username, project_number, limit)
    except Exception:
        pass
    
    return []


def _get_project_items_via_gh_cli(
    integration: 'GitHubProjectsIntegration',
    username: str,
    project_number: int,
    limit: int
) -> List[Dict[str, Any]]:
    """Fallback: Get project items using gh CLI."""
    try:
        result = subprocess.run(
            ['gh', 'project', 'item-list', str(project_number), '--owner', username, '--format', 'json', '--limit', str(limit)],
            capture_output=True, text=True,
            timeout=integration.api_timeout, shell=False
        )
        if result.returncode == 0 and result.stdout.strip():
            items = json.loads(result.stdout.strip())
            return [{
                'id': item.get('id'),
                'content_type': item.get('type'),
                'title': item.get('title'),
                'status': item.get('status'),
                'created_at': item.get('createdAt'),
                'updated_at': item.get('updatedAt')
            } for item in items.get('items', [])]
    except Exception:
        pass
    return []


def get_projects_context(
    integration: 'GitHubProjectsIntegration',
    repo_path: str
) -> Dict[str, Any]:
    """Get GitHub Projects context for the current repository (Phase 3: user + org support)."""
    import sys
    
    context: Dict[str, Any] = {
        'github_projects': {
            'user_projects': [],
            'org_projects': []
        },
        'active_items': []
    }
    
    # Check if requests library is available
    try:
        import requests  # type: ignore[import-not-found]
    except ImportError:
        return context
    
    # Extract repo owner from Git remote
    owner = integration._extract_repo_owner_from_remote(repo_path)
    if not owner:
        return context
    
    # Phase 3: Detect owner type (user or org)
    owner_type = integration.detect_owner_type(owner)
    
    # Query user projects
    user_projects = get_projects(integration, owner, 'user')
    if user_projects:
        context['github_projects']['user_projects'] = user_projects
    
    # Query org projects if owner is an org
    if owner_type == 'org':
        org_projects = get_projects(integration, owner, 'org')
        if org_projects:
            context['github_projects']['org_projects'] = org_projects
    
    # Get active items from first project (prioritize org projects for org repos)
    all_projects = []
    if owner_type == 'org' and context['github_projects']['org_projects']:
        all_projects = context['github_projects']['org_projects']
    elif context['github_projects']['user_projects']:
        all_projects = context['github_projects']['user_projects']
    
    if len(all_projects) > 0:
        first_project = all_projects[0]
        project_number = first_project.get('number')
        project_owner = first_project.get('owner', owner)
        if project_number:
            items = get_project_items(integration, project_owner, project_number, limit=5)
            context['active_items'] = items
    
    return context


def get_project_details(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    project_number: int,
    owner_type: str = 'user'
) -> Optional[Dict[str, Any]]:
    """Get detailed information about a specific GitHub Project with caching (Phase 3: org support)."""
    # Normalize owner_type
    owner_type = normalize_owner_type(owner_type)
    
    cache_key = f"project_details:{owner_type}:{owner}:{project_number}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        return None
    
    # Use org token for org projects if available
    use_org_token = (owner_type == 'org')
    
    try:
        import requests  # type: ignore[import-not-found]
        # Select endpoint based on owner type
        endpoint = f'/users/{owner}/projects/{project_number}' if owner_type == 'user' else f'/orgs/{owner}/projects/{project_number}'
        url = f"{integration.api_base}{endpoint}"
        response = requests.get(
            url,
            headers=integration._get_headers(use_org_token=use_org_token),
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            project = response.json()
            result = {
                'number': project.get('number'),
                'name': project.get('name'),
                'description': project.get('body'),
                'url': project.get('html_url'),
                'state': project.get('state'),
                'created_at': project.get('created_at'),
                'updated_at': project.get('updated_at'),
                'creator': project.get('creator', {}).get('login'),
                'source': owner_type,  # Phase 3
                'owner': owner  # Phase 3
            }
            set_cache(integration.db_connection, cache_key, result, integration.project_ttl)
            return result
    except Exception:
        pass
    
    return None


def get_repo_milestones(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str
) -> List[Dict[str, Any]]:
    """Get milestones for a GitHub repository with caching."""
    cache_key = f"milestones:{owner}:{repo}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        return []
    
    try:
        import requests  # type: ignore[import-not-found]
        url = f"{integration.api_base}/repos/{owner}/{repo}/milestones"
        response = requests.get(
            url,
            headers=integration._get_headers(),
            params={'state': 'all', 'per_page': 100},
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            milestones = response.json()
            result = [{
                'number': m.get('number'),
                'title': m.get('title'),
                'description': m.get('description'),
                'state': m.get('state'),
                'open_issues': m.get('open_issues'),
                'closed_issues': m.get('closed_issues'),
                'due_on': m.get('due_on'),
                'created_at': m.get('created_at'),
                'updated_at': m.get('updated_at'),
                'url': m.get('html_url')
            } for m in milestones]
            set_cache(integration.db_connection, cache_key, result, integration.milestone_ttl)
            return result
    except Exception:
        pass
    
    return []


def get_project_items_with_fields(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    project_number: int,
    limit: int = 100,
    owner_type: str = 'user'
) -> List[Dict[str, Any]]:
    """Get project items with full field data (status, priority, etc.) with caching (Phase 3: org support)."""
    # Normalize owner_type
    owner_type = normalize_owner_type(owner_type)
    
    cache_key = f"project_items_full:{owner_type}:{owner}:{project_number}:{limit}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    # Try gh CLI for detailed field information (works for both user and org projects)
    try:
        result = subprocess.run(
            ['gh', 'project', 'item-list', str(project_number), '--owner', owner, '--format', 'json', '--limit', str(limit)],
            capture_output=True, text=True,
            timeout=integration.api_timeout, shell=False
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            items = [{
                'id': item.get('id'),
                'content_type': item.get('type'),
                'title': item.get('title'),
                'status': item.get('status'),
                'priority': item.get('priority'),
                'assignees': item.get('assignees', []),
                'labels': item.get('labels', []),
                'created_at': item.get('createdAt'),
                'updated_at': item.get('updatedAt')
            } for item in data.get('items', [])]
            set_cache(integration.db_connection, cache_key, items, integration.items_ttl)
            return items
    except Exception:
        pass
    
    # Fallback to basic items
    basic_items = get_project_items(integration, owner, project_number, limit)
    set_cache(integration.db_connection, cache_key, basic_items, integration.items_ttl)
    return basic_items


def get_project_timeline(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    project_number: int,
    days: int = 30,
    owner_type: str = 'user'
) -> List[Dict[str, Any]]:
    """Generate timeline of project activity combining items and updates (Phase 3: org support)."""
    timeline = []
    
    # Get project items
    items = get_project_items_with_fields(integration, owner, project_number, limit=100, owner_type=owner_type)
    
    # Add items to timeline
    cutoff_time = datetime.now() - timedelta(days=days)
    
    for item in items:
        try:
            updated_str = item.get('updated_at', '')
            if updated_str:
                # Handle ISO format timestamp
                if 'T' in updated_str:
                    updated_time = datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
                else:
                    updated_time = datetime.fromisoformat(updated_str)
                
                if updated_time >= cutoff_time:
                    timeline.append({
                        'type': 'project_item',
                        'timestamp': updated_str,
                        'title': item.get('title', 'Untitled'),
                        'status': item.get('status', 'unknown'),
                        'content_type': item.get('content_type', 'unknown')
                    })
        except Exception:
            continue
    
    # Sort by timestamp descending
    timeline.sort(key=lambda x: x['timestamp'], reverse=True)
    
    return timeline[:50]  # Limit to 50 events


def get_repo_issues(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    state: str = 'all',
    limit: int = 20
) -> List[Dict[str, Any]]:
    """
    Get GitHub Issues for a repository with caching.
    
    Args:
        integration: GitHubProjectsIntegration instance
        owner: Repository owner (username or org)
        repo: Repository name
        state: Issue state ('open', 'closed', 'all')
        limit: Maximum number of issues to return
        
    Returns:
        List of issue dictionaries (filters out PRs)
    """
    from constants import CACHE_TTL_ISSUES
    
    cache_key = f"issues:{owner}:{repo}:{state}:{limit}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        # Try gh CLI fallback
        return _get_issues_via_gh_cli(integration, owner, repo, state, limit)
    
    try:
        import requests  # type: ignore[import-not-found]
        url = f"{integration.api_base}/repos/{owner}/{repo}/issues"
        response = requests.get(
            url,
            headers=integration._get_headers(),
            params={
                'state': state,
                'per_page': limit,
                'sort': 'updated',
                'direction': 'desc'
            },
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            issues_data = response.json()
            # Filter out pull requests (GitHub API includes PRs in issues endpoint)
            issues = []
            for issue in issues_data:
                if 'pull_request' not in issue:  # Not a PR
                    issues.append({
                        'number': issue.get('number'),
                        'title': issue.get('title'),
                        'state': issue.get('state'),
                        'labels': [label.get('name') for label in issue.get('labels', [])],
                        'assignees': [assignee.get('login') for assignee in issue.get('assignees', [])],
                        'created_at': issue.get('created_at'),
                        'updated_at': issue.get('updated_at'),
                        'url': issue.get('html_url'),
                        'body_preview': (issue.get('body') or '')[:200] if issue.get('body') else None,
                        'comments_count': issue.get('comments', 0),
                        'milestone': issue.get('milestone', {}).get('title') if issue.get('milestone') else None
                    })
            
            set_cache(integration.db_connection, cache_key, issues, CACHE_TTL_ISSUES)
            return issues
    except ImportError:
        return _get_issues_via_gh_cli(integration, owner, repo, state, limit)
    except Exception as e:
        print(f"[ERROR] Error fetching GitHub issues: {e}", file=sys.stderr)
    
    return []


def _get_issues_via_gh_cli(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    state: str = 'all',
    limit: int = 20
) -> List[Dict[str, Any]]:
    """Fallback: Get issues using gh CLI."""
    try:
        args = ['gh', 'issue', 'list', '--repo', f"{owner}/{repo}", '--limit', str(limit)]
        if state != 'all':
            args.extend(['--state', state])
        
        result = subprocess.run(
            args + ['--json', 'number,title,state,labels,assignees,createdAt,updatedAt,url,body'],
            capture_output=True, text=True,
            timeout=integration.api_timeout, shell=False
        )
        if result.returncode == 0 and result.stdout.strip():
            issues_data = json.loads(result.stdout.strip())
            return [{
                'number': issue.get('number'),
                'title': issue.get('title'),
                'state': issue.get('state'),
                'labels': [label.get('name') for label in issue.get('labels', [])],
                'assignees': [assignee.get('login') for assignee in issue.get('assignees', [])],
                'created_at': issue.get('createdAt'),
                'updated_at': issue.get('updatedAt'),
                'url': issue.get('url'),
                'body_preview': (issue.get('body') or '')[:200] if issue.get('body') else None
            } for issue in issues_data]
    except Exception as e:
        print(f"[ERROR] gh CLI fallback failed for issues: {e}", file=sys.stderr)
    return []


def get_issue_details(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    issue_number: int
) -> Optional[Dict[str, Any]]:
    """
    Get detailed information about a specific GitHub Issue.
    
    Args:
        integration: GitHubProjectsIntegration instance
        owner: Repository owner
        repo: Repository name
        issue_number: Issue number
        
    Returns:
        Issue dictionary with full details or None
    """
    from constants import CACHE_TTL_ISSUES
    
    cache_key = f"issue_details:{owner}:{repo}:{issue_number}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        return None
    
    try:
        import requests  # type: ignore[import-not-found]
        url = f"{integration.api_base}/repos/{owner}/{repo}/issues/{issue_number}"
        response = requests.get(
            url,
            headers=integration._get_headers(),
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            issue = response.json()
            # Verify it's not a PR
            if 'pull_request' in issue:
                return None
            
            result = {
                'number': issue.get('number'),
                'title': issue.get('title'),
                'state': issue.get('state'),
                'labels': [label.get('name') for label in issue.get('labels', [])],
                'assignees': [assignee.get('login') for assignee in issue.get('assignees', [])],
                'created_at': issue.get('created_at'),
                'updated_at': issue.get('updated_at'),
                'closed_at': issue.get('closed_at'),
                'url': issue.get('html_url'),
                'body': issue.get('body'),
                'body_preview': (issue.get('body') or '')[:200] if issue.get('body') else None,
                'comments_count': issue.get('comments', 0),
                'milestone': issue.get('milestone', {}).get('title') if issue.get('milestone') else None,
                'author': issue.get('user', {}).get('login')
            }
            set_cache(integration.db_connection, cache_key, result, CACHE_TTL_ISSUES)
            return result
    except Exception as e:
        print(f"[ERROR] Error fetching issue details: {e}", file=sys.stderr)
    
    return None


def get_repo_pull_requests(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    state: str = 'all',
    limit: int = 20
) -> List[Dict[str, Any]]:
    """
    Get GitHub Pull Requests for a repository with caching.
    
    Args:
        integration: GitHubProjectsIntegration instance
        owner: Repository owner
        repo: Repository name
        state: PR state ('open', 'closed', 'all')
        limit: Maximum number of PRs to return
        
    Returns:
        List of PR dictionaries
    """
    from constants import CACHE_TTL_PULL_REQUESTS
    
    cache_key = f"prs:{owner}:{repo}:{state}:{limit}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        return _get_prs_via_gh_cli(integration, owner, repo, state, limit)
    
    try:
        import requests  # type: ignore[import-not-found]
        url = f"{integration.api_base}/repos/{owner}/{repo}/pulls"
        response = requests.get(
            url,
            headers=integration._get_headers(),
            params={
                'state': state,
                'per_page': limit,
                'sort': 'updated',
                'direction': 'desc'
            },
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            prs_data = response.json()
            prs = []
            for pr in prs_data:
                # Parse linked issues from body
                linked_issues = _parse_linked_issues(pr.get('body', ''))
                
                prs.append({
                    'number': pr.get('number'),
                    'title': pr.get('title'),
                    'state': pr.get('state'),
                    'draft': pr.get('draft', False),
                    'merged': pr.get('merged', False),
                    'head_branch': pr.get('head', {}).get('ref'),
                    'base_branch': pr.get('base', {}).get('ref'),
                    'author': pr.get('user', {}).get('login'),
                    'reviewers': [rev.get('login') for rev in pr.get('requested_reviewers', [])],
                    'created_at': pr.get('created_at'),
                    'updated_at': pr.get('updated_at'),
                    'merged_at': pr.get('merged_at'),
                    'url': pr.get('html_url'),
                    'linked_issues': linked_issues
                })
            
            set_cache(integration.db_connection, cache_key, prs, CACHE_TTL_PULL_REQUESTS)
            return prs
    except ImportError:
        return _get_prs_via_gh_cli(integration, owner, repo, state, limit)
    except Exception as e:
        print(f"[ERROR] Error fetching GitHub PRs: {e}", file=sys.stderr)
    
    return []


def _get_prs_via_gh_cli(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    state: str = 'all',
    limit: int = 20
) -> List[Dict[str, Any]]:
    """Fallback: Get PRs using gh CLI."""
    try:
        args = ['gh', 'pr', 'list', '--repo', f"{owner}/{repo}", '--limit', str(limit)]
        if state != 'all':
            args.extend(['--state', state])
        
        result = subprocess.run(
            args + ['--json', 'number,title,state,isDraft,headRefName,baseRefName,author,createdAt,updatedAt,mergedAt,url,body'],
            capture_output=True, text=True,
            timeout=integration.api_timeout, shell=False
        )
        if result.returncode == 0 and result.stdout.strip():
            prs_data = json.loads(result.stdout.strip())
            return [{
                'number': pr.get('number'),
                'title': pr.get('title'),
                'state': pr.get('state'),
                'draft': pr.get('isDraft', False),
                'merged': pr.get('state') == 'MERGED',
                'head_branch': pr.get('headRefName'),
                'base_branch': pr.get('baseRefName'),
                'author': pr.get('author', {}).get('login'),
                'reviewers': [],
                'created_at': pr.get('createdAt'),
                'updated_at': pr.get('updatedAt'),
                'merged_at': pr.get('mergedAt'),
                'url': pr.get('url'),
                'linked_issues': _parse_linked_issues(pr.get('body', ''))
            } for pr in prs_data]
    except Exception as e:
        print(f"[ERROR] gh CLI fallback failed for PRs: {e}", file=sys.stderr)
    return []


def get_pr_details(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    pr_number: int
) -> Optional[Dict[str, Any]]:
    """
    Get detailed information about a specific GitHub Pull Request.
    
    Args:
        integration: GitHubProjectsIntegration instance
        owner: Repository owner
        repo: Repository name
        pr_number: PR number
        
    Returns:
        PR dictionary with full details or None
    """
    from constants import CACHE_TTL_PULL_REQUESTS
    
    cache_key = f"pr_details:{owner}:{repo}:{pr_number}"
    cached = get_cache(integration.db_connection, cache_key)
    if cached:
        return cached
    
    if not integration.github_token:
        return None
    
    try:
        import requests  # type: ignore[import-not-found]
        url = f"{integration.api_base}/repos/{owner}/{repo}/pulls/{pr_number}"
        response = requests.get(
            url,
            headers=integration._get_headers(),
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            pr = response.json()
            linked_issues = _parse_linked_issues(pr.get('body', ''))
            
            result = {
                'number': pr.get('number'),
                'title': pr.get('title'),
                'state': pr.get('state'),
                'draft': pr.get('draft', False),
                'merged': pr.get('merged', False),
                'head_branch': pr.get('head', {}).get('ref'),
                'base_branch': pr.get('base', {}).get('ref'),
                'author': pr.get('user', {}).get('login'),
                'reviewers': [rev.get('login') for rev in pr.get('requested_reviewers', [])],
                'created_at': pr.get('created_at'),
                'updated_at': pr.get('updated_at'),
                'merged_at': pr.get('merged_at'),
                'closed_at': pr.get('closed_at'),
                'url': pr.get('html_url'),
                'body': pr.get('body'),
                'linked_issues': linked_issues,
                'commits_count': pr.get('commits', 0),
                'changed_files': pr.get('changed_files', 0),
                'additions': pr.get('additions', 0),
                'deletions': pr.get('deletions', 0),
                'comments_count': pr.get('comments', 0),
                'review_comments_count': pr.get('review_comments', 0)
            }
            set_cache(integration.db_connection, cache_key, result, CACHE_TTL_PULL_REQUESTS)
            return result
    except Exception as e:
        print(f"[ERROR] Error fetching PR details: {e}", file=sys.stderr)
    
    return None


def get_pr_from_branch(
    integration: 'GitHubProjectsIntegration',
    owner: str,
    repo: str,
    branch: str
) -> Optional[Dict[str, Any]]:
    """
    Find PR for a specific branch (head branch).
    
    Args:
        integration: GitHubProjectsIntegration instance
        owner: Repository owner
        repo: Repository name
        branch: Branch name to search for
        
    Returns:
        PR dictionary or None if not found
    """
    # Get recent PRs and filter by head branch
    prs = get_repo_pull_requests(integration, owner, repo, state='open', limit=50)
    
    for pr in prs:
        if pr.get('head_branch') == branch:
            return pr
    
    return None


def _parse_linked_issues(body: str) -> List[int]:
    """
    Parse issue references from PR body.
    Looks for patterns like: Fixes #123, Closes #456, Resolves #789
    
    Args:
        body: PR body text
        
    Returns:
        List of issue numbers
    """
    import re
    
    if not body:
        return []
    
    # Match patterns: Fixes #123, Closes #456, Resolves #789, etc.
    pattern = r'(?:fix(?:es|ed)?|close(?:s|d)?|resolve(?:s|d)?)\s+#(\d+)'
    matches = re.findall(pattern, body, re.IGNORECASE)
    
    return [int(num) for num in matches]


def extract_repo_info_from_context(project_context: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """
    Extract owner and repo name from project context JSON.
    
    Args:
        project_context: JSON string containing project context
        
    Returns:
        Tuple of (owner, repo_name). Owner may be None if not in context.
    """
    if not project_context:
        return None, None
    
    try:
        ctx = json.loads(project_context)
        repo_name = ctx.get('repo_name')
        
        # Try to extract owner from git_remote if available
        # git_remote format: git@github.com:owner/repo.git or https://github.com/owner/repo.git
        git_remote = ctx.get('git_remote', '')
        if git_remote and 'github.com' in git_remote:
            import re
            # Match SSH format: git@github.com:owner/repo
            ssh_match = re.search(r'github\.com:([^/]+)/([^/\s]+?)(?:\.git)?$', git_remote)
            if ssh_match:
                return ssh_match.group(1), ssh_match.group(2)
            
            # Match HTTPS format: https://github.com/owner/repo
            https_match = re.search(r'github\.com/([^/]+)/([^/\s]+?)(?:\.git)?$', git_remote)
            if https_match:
                return https_match.group(1), https_match.group(2)
        
        return None, repo_name
    except Exception:
        return None, None