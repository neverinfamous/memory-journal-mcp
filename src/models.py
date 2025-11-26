"""
Memory Journal MCP Server - Data Models and Type Definitions
Type definitions and data structures used throughout the application.
"""

from typing import Dict, List, Any, Optional, TypedDict


class EntryDict(TypedDict, total=False):
    """Dictionary representation of a journal entry."""
    id: int
    entry_type: str
    content: str
    timestamp: str
    is_personal: bool
    project_context: Optional[str]
    related_patterns: Optional[str]
    project_number: Optional[int]
    project_item_id: Optional[int]
    github_project_url: Optional[str]
    issue_number: Optional[int]
    issue_url: Optional[str]
    pr_number: Optional[int]
    pr_url: Optional[str]
    pr_status: Optional[str]
    workflow_run_id: Optional[int]
    workflow_name: Optional[str]
    workflow_status: Optional[str]
    deleted_at: Optional[str]
    tags: List[str]
    significance: Optional[Dict[str, Any]]
    relationships_to: Optional[List[Dict[str, Any]]]
    relationships_from: Optional[List[Dict[str, Any]]]


class ContextData(TypedDict, total=False):
    """Project context information."""
    repo_path: str
    repo_name: str
    branch: str
    last_commit: Dict[str, str]
    git_status: str
    git_error: str
    branch_error: str
    commit_error: str
    github_issues: List[Dict[str, Any]]
    github_issues_error: str
    github_projects: Dict[str, Any]
    github_projects_error: str
    current_pr: Optional[Dict[str, Any]]
    github_pull_requests: List[Dict[str, Any]]
    github_prs_error: str
    github_workflow_runs: List[Dict[str, Any]]
    github_workflow_runs_error: str
    ci_status: str  # 'passing', 'failing', 'pending', 'unknown'
    cwd: str
    timestamp: str


class GitHubProjectDict(TypedDict, total=False):
    """GitHub Project information."""
    number: int
    name: str
    description: Optional[str]
    url: str
    state: str
    created_at: str
    updated_at: str
    source: str  # 'user' or 'org'
    owner: str
    creator: Optional[str]


class GitHubProjectItemDict(TypedDict, total=False):
    """GitHub Project item information."""
    id: int
    content_type: str
    content_url: Optional[str]
    title: Optional[str]
    status: Optional[str]
    priority: Optional[str]
    assignees: List[str]
    labels: List[str]
    created_at: str
    updated_at: str


class GitHubIssueDict(TypedDict, total=False):
    """GitHub Issue information."""
    number: int
    title: str
    state: str  # 'open', 'closed'
    labels: List[str]
    assignees: List[str]
    created_at: str
    updated_at: str
    closed_at: Optional[str]
    url: str
    body_preview: Optional[str]
    body: Optional[str]
    comments_count: int
    milestone: Optional[str]
    author: Optional[str]


class GitHubPullRequestDict(TypedDict, total=False):
    """GitHub Pull Request information."""
    number: int
    title: str
    state: str  # 'open', 'closed'
    draft: bool
    merged: bool
    head_branch: str
    base_branch: str
    author: str
    reviewers: List[str]
    created_at: str
    updated_at: str
    merged_at: Optional[str]
    closed_at: Optional[str]
    url: str
    body: Optional[str]
    linked_issues: List[int]
    commits_count: Optional[int]
    changed_files: Optional[int]
    additions: Optional[int]
    deletions: Optional[int]
    comments_count: Optional[int]
    review_comments_count: Optional[int]


class GitHubMilestoneDict(TypedDict, total=False):
    """GitHub milestone information."""
    number: int
    title: str
    description: Optional[str]
    state: str
    open_issues: int
    closed_issues: int
    due_on: Optional[str]
    created_at: str
    updated_at: str
    url: str


class GitHubWorkflowRunDict(TypedDict, total=False):
    """GitHub Actions workflow run information."""
    id: int
    name: str
    head_branch: str
    head_sha: str
    status: str  # 'queued', 'in_progress', 'completed'
    conclusion: Optional[str]  # 'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', None
    event: str  # 'push', 'pull_request', 'workflow_dispatch', 'schedule', etc.
    workflow_id: int
    run_number: int
    run_attempt: int
    created_at: str
    updated_at: str
    url: str
    html_url: str
    jobs_url: str
    logs_url: str
    actor: Optional[str]
    triggering_actor: Optional[str]


class TimelineEventDict(TypedDict, total=False):
    """Timeline event for project activity."""
    type: str  # 'journal_entry' or 'project_item'
    timestamp: str
    id: Optional[int]
    entry_type: Optional[str]
    content: Optional[str]
    title: Optional[str]
    status: Optional[str]
    content_type: Optional[str]


class StatisticsDict(TypedDict, total=False):
    """Statistics data structure."""
    total_entries: int
    personal_entries: int
    project_entries: int
    by_type: Dict[str, int]
    top_tags: Dict[str, int]
    significant_entries: Dict[str, int]
    activity_by_period: Dict[str, int]
    by_project: Dict[str, int]
    project_active_days: Dict[str, int]


class SearchResultDict(TypedDict, total=False):
    """Search result entry."""
    id: int
    entry_type: str
    content: str
    timestamp: str
    is_personal: bool
    project_number: Optional[int]
    snippet: str
    similarity_score: Optional[float]


class RelationshipDict(TypedDict, total=False):
    """Relationship between entries."""
    id: int
    from_entry_id: int
    to_entry_id: int
    relationship_type: str
    description: Optional[str]
    created_at: str


class TagDict(TypedDict):
    """Tag information."""
    id: int
    name: str
    category: Optional[str]
    usage_count: int


class SignificanceDict(TypedDict):
    """Significance information for an entry."""
    entry_id: int
    significance_type: str
    significance_rating: float


class ProjectInsightsDict(TypedDict, total=False):
    """Cross-project insights data."""
    projects: List[Dict[str, Any]]
    productivity: Dict[int, Dict[str, Any]]
    project_tags: Dict[int, List[Dict[str, Any]]]
    inactive_projects: List[Dict[str, Any]]


class CacheEntryDict(TypedDict):
    """Cache entry structure."""
    cache_key: str
    cache_value: str
    cached_at: int
    ttl_seconds: int


# =============================================================================
# Actions Graph Types (memory://graph/actions)
# =============================================================================

# Literal type for node types in the Actions graph
ActionsGraphNodeType = str  # 'commit', 'workflow_run', 'failed_job', 'journal_entry', 'deployment', 'pr'


class ActionsGraphCommitNode(TypedDict, total=False):
    """Commit node in the Actions graph."""
    node_type: str  # Always 'commit'
    sha: str
    short_sha: str
    message: Optional[str]
    author: Optional[str]
    timestamp: str
    branch: Optional[str]


class ActionsGraphWorkflowRunNode(TypedDict, total=False):
    """Workflow run node in the Actions graph."""
    node_type: str  # Always 'workflow_run'
    run_id: int
    name: str
    status: str  # 'queued', 'in_progress', 'completed'
    conclusion: Optional[str]  # 'success', 'failure', 'cancelled', etc.
    head_sha: str
    head_branch: Optional[str]
    event: str  # 'push', 'pull_request', etc.
    timestamp: str
    html_url: Optional[str]


class ActionsGraphJobNode(TypedDict, total=False):
    """Failed job node in the Actions graph."""
    node_type: str  # Always 'failed_job'
    job_id: int
    name: str
    conclusion: str  # 'failure', 'timed_out', etc.
    run_id: int
    html_url: Optional[str]
    failed_step: Optional[str]


class ActionsGraphEntryNode(TypedDict, total=False):
    """Journal entry node in the Actions graph (linked to workflow runs/failures)."""
    node_type: str  # Always 'journal_entry'
    entry_id: int
    entry_type: str
    content_preview: str
    timestamp: str
    workflow_run_id: Optional[int]


class ActionsGraphDeploymentNode(TypedDict, total=False):
    """Deployment node in the Actions graph."""
    node_type: str  # Always 'deployment'
    run_id: int
    workflow_name: str
    environment: Optional[str]
    status: str
    timestamp: str
    head_sha: str
    html_url: Optional[str]


class ActionsGraphPRNode(TypedDict, total=False):
    """Pull Request node in the Actions graph."""
    node_type: str  # Always 'pr'
    pr_number: int
    title: str
    state: str  # 'open', 'closed', 'merged'
    author: Optional[str]
    head_branch: str
    url: Optional[str]


class ActionsGraphEdge(TypedDict):
    """Edge connecting nodes in the Actions graph."""
    from_node: str  # Node ID
    to_node: str  # Node ID
    edge_type: str  # 'triggers', 'contains', 'investigates', 'fixes', 'deploys'
    label: Optional[str]


class ActionsGraphData(TypedDict, total=False):
    """Complete Actions graph data structure."""
    commits: List[ActionsGraphCommitNode]
    workflow_runs: List[ActionsGraphWorkflowRunNode]
    failed_jobs: List[ActionsGraphJobNode]
    journal_entries: List[ActionsGraphEntryNode]
    deployments: List[ActionsGraphDeploymentNode]
    pull_requests: List[ActionsGraphPRNode]
    edges: List[ActionsGraphEdge]


# Type aliases for common patterns
EntryID = int
TagID = int
ProjectNumber = int
OwnerType = str  # 'user' or 'org'
RelationshipType = str  # 'references', 'implements', 'clarifies', 'evolves_from', 'response_to'

