"""
Memory Journal MCP Server - GitHub Integration Base Module
Core GitHub Projects integration, URL parsing, and owner detection.
"""

import os
import subprocess
from urllib.parse import urlparse
from typing import Optional, Dict, TYPE_CHECKING

from constants import (
    GITHUB_API_BASE, GITHUB_API_TIMEOUT,
    CACHE_TTL_OWNER_TYPE, CACHE_TTL_PROJECT, CACHE_TTL_ITEMS, CACHE_TTL_MILESTONE
)

if TYPE_CHECKING:
    from database.base import MemoryJournalDB


class GitHubProjectsIntegration:
    """GitHub Projects API integration for context awareness (Phase 1, 2 & 3)."""
    
    def __init__(self, db_connection: Optional['MemoryJournalDB'] = None):
        """Initialize GitHub Projects integration."""
        self.github_token = os.environ.get('GITHUB_TOKEN')
        self.github_org_token = os.environ.get('GITHUB_ORG_TOKEN')  # Phase 3: Optional separate org token
        self.default_org = os.environ.get('DEFAULT_ORG')  # Phase 3: Default org for ambiguous contexts
        self.api_base = GITHUB_API_BASE
        self.api_timeout = GITHUB_API_TIMEOUT
        self.db_connection = db_connection
        
        # Cache TTLs (Phase 2 - Issue #16)
        self.project_ttl = CACHE_TTL_PROJECT
        self.items_ttl = CACHE_TTL_ITEMS
        self.milestone_ttl = CACHE_TTL_MILESTONE
        self.owner_type_ttl = CACHE_TTL_OWNER_TYPE
        
        # API manager (will be set by server.py)
        self.api_manager = None  # type: ignore
        
    def get_headers(self, use_org_token: bool = False) -> Dict[str, str]:
        """
        Get GitHub API headers.
        
        Args:
            use_org_token: If True and GITHUB_ORG_TOKEN is set, use org token instead
            
        Returns:
            Dictionary of HTTP headers for GitHub API requests
        """
        headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
        # Phase 3: Use org token if requested and available, otherwise fall back to user token
        token = self.github_org_token if (use_org_token and self.github_org_token) else self.github_token
        if token:
            headers['Authorization'] = f'token {token}'
        return headers
    
    def extract_repo_owner_from_remote(self, repo_path: str) -> Optional[str]:
        """
        Extract repository owner from Git remote URL.
        
        Security: Uses proper URL parsing to prevent URL substring sanitization bypasses.
        Validates that the hostname is exactly 'github.com' (not a subdomain or malicious domain).
        
        Args:
            repo_path: Path to the Git repository
            
        Returns:
            Repository owner name or None if not found/invalid
        """
        process: subprocess.Popen[str] | None = None
        try:
            # Use Popen to avoid stdin inheritance issues with MCP stdio
            process = subprocess.Popen(
                ['git', 'config', '--get', 'remote.origin.url'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                cwd=repo_path,
                text=True
            )
            stdout, _stderr = process.communicate(timeout=2)
            if process.returncode == 0:
                remote_url = stdout.strip()
                
                # Parse GitHub URL formats:
                # https://github.com/owner/repo.git
                # git@github.com:owner/repo.git
                
                # Handle SSH format: git@github.com:owner/repo.git
                if remote_url.startswith('git@github.com:'):
                    # SSH URLs don't have a scheme, so handle specially
                    # Format: git@github.com:owner/repo.git
                    path_part = remote_url.split('git@github.com:', 1)[1]
                    path_part = path_part.replace('.git', '').strip('/')
                    parts = path_part.split('/')
                    if len(parts) >= 1 and parts[0]:
                        return parts[0]
                    return None
                
                # Handle HTTPS/HTTP format: https://github.com/owner/repo.git
                try:
                    parsed = urlparse(remote_url)
                    # Security: Verify the hostname is exactly 'github.com'
                    # This prevents bypasses like:
                    # - http://evil.com/github.com/fake/repo
                    # - http://github.com.evil.com/fake/repo
                    if parsed.hostname == 'github.com':
                        # Extract owner from path: /owner/repo.git
                        path = parsed.path.strip('/').replace('.git', '')
                        parts = path.split('/')
                        if len(parts) >= 1 and parts[0]:
                            return parts[0]
                except ValueError:
                    # urlparse failed, not a valid URL
                    pass
        
        except subprocess.TimeoutExpired:
            if process is not None:
                process.kill()
                process.communicate()
        except Exception:
            pass
        
        return None
    
    def detect_owner_type(self, owner: str) -> str:
        """
        Determine if owner is a user or organization (Phase 3 - Issue #17).
        
        Args:
            owner: GitHub username or organization name
            
        Returns:
            'user', 'org', or 'unknown'
            
        Uses caching (Phase 2) with 24hr TTL since owner type rarely changes.
        """
        # Import cache methods (will be defined in cache.py)
        from github.cache import get_cache, set_cache
        
        # Check cache first (Phase 2 infrastructure)
        cache_key = f"owner_type:{owner}"
        cached = get_cache(self.db_connection, cache_key)
        if cached:
            return cached
        
        if not self.github_token:
            return 'unknown'
        
        try:
            import requests  # type: ignore[import-not-found]
            # Query GitHub API: GET /users/{owner}
            url = f"{self.api_base}/users/{owner}"
            response = requests.get(
                url,
                headers=self.get_headers(),
                timeout=self.api_timeout
            )
            
            if response.status_code == 200:
                user_data = response.json()
                # Check response 'type' field ('User' or 'Organization')
                owner_type_raw = user_data.get('type', 'unknown')
                # Normalize to lowercase
                if owner_type_raw == 'User':
                    owner_type = 'user'
                elif owner_type_raw == 'Organization':
                    owner_type = 'org'
                else:
                    owner_type = 'unknown'
                
                # Cache result for 24 hours
                set_cache(self.db_connection, cache_key, owner_type, self.owner_type_ttl)
                return owner_type
        except ImportError:
            pass
        except Exception:
            pass
        
        return 'unknown'
    
    # Methods that delegate to api.py
    def get_projects(self, owner: str, owner_type: str = 'user'):
        """Get GitHub Projects for a user or org."""
        from github.api import get_projects
        return get_projects(self, owner, owner_type)
    
    def get_user_projects(self, username: str):
        """Get GitHub Projects for a user (backward compatibility wrapper)."""
        return self.get_projects(username, 'user')
    
    def get_project_details(self, owner: str, project_number: int, owner_type: str = 'user'):
        """Get detailed information about a specific GitHub Project."""
        from github.api import get_project_details
        return get_project_details(self, owner, project_number, owner_type)
    
    def get_project_items(self, username: str, project_number: int, limit: int = 10):
        """Get items from a GitHub Project."""
        from github.api import get_project_items
        return get_project_items(self, username, project_number, limit)
    
    def get_project_items_with_fields(self, owner: str, project_number: int, limit: int = 100, owner_type: str = 'user'):
        """Get project items with full field data."""
        from github.api import get_project_items_with_fields
        return get_project_items_with_fields(self, owner, project_number, limit, owner_type)
    
    def get_repo_milestones(self, owner: str, repo: str):
        """Get milestones for a GitHub repository."""
        from github.api import get_repo_milestones
        return get_repo_milestones(self, owner, repo)
    
    def get_project_timeline(self, owner: str, project_number: int, days: int = 30, owner_type: str = 'user'):
        """Generate timeline of project activity."""
        from github.api import get_project_timeline
        return get_project_timeline(self, owner, project_number, days, owner_type)
    
    def get_projects_context(self, repo_path: str):
        """Get GitHub Projects context for the current repository."""
        from github.api import get_projects_context
        return get_projects_context(self, repo_path)

