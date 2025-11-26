"""
Memory Journal MCP Server - Project Context Module
Git and GitHub context gathering functionality.
"""

import subprocess
import os
import asyncio
import concurrent.futures
from datetime import datetime
from typing import Dict, Any, Optional, TYPE_CHECKING
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from constants import GIT_TIMEOUT, THREAD_POOL_MAX_WORKERS

if TYPE_CHECKING:
    from github.integration import GitHubProjectsIntegration

# Thread pool for context gathering
thread_pool = ThreadPoolExecutor(max_workers=THREAD_POOL_MAX_WORKERS)


class ProjectContextManager:
    """Manages project context gathering including Git and GitHub information."""
    
    def __init__(self, github_projects_integration: Optional['GitHubProjectsIntegration'] = None):
        """
        Initialize the project context manager.
        
        Args:
            github_projects_integration: Optional GitHubProjectsIntegration instance
        """
        self.github_projects: Optional['GitHubProjectsIntegration'] = github_projects_integration
    
    def extract_repo_owner_from_remote(self, repo_path: str) -> Optional[str]:
        """
        Extract repository owner from Git remote URL.
        
        Args:
            repo_path: Path to the Git repository
            
        Returns:
            Repository owner name or None if not found
        """
        process: subprocess.Popen[str] | None = None
        try:
            # Use Popen to avoid stdin conflicts
            process = subprocess.Popen(
                ['git', '-C', repo_path, 'remote', 'get-url', 'origin'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                text=True
            )
            
            stdout, _stderr = process.communicate(timeout=GIT_TIMEOUT)
            
            if process.returncode == 0:
                remote_url = stdout.strip()
                
                # Handle SSH URLs: git@github.com:owner/repo.git (exact prefix check for security)
                if remote_url.startswith('git@github.com:'):
                    parts = remote_url.replace('git@github.com:', '').replace('.git', '').split('/')
                    if len(parts) >= 2:
                        return parts[0]
                
                # Handle HTTPS URLs: https://github.com/owner/repo.git (proper URL validation for security)
                else:
                    parsed = urlparse(remote_url)
                    # Exact hostname match to prevent URL spoofing (security fix from v1.2.2)
                    if parsed.hostname == 'github.com' and parsed.path:
                        path_parts = parsed.path.strip('/').replace('.git', '').split('/')
                        if len(path_parts) >= 2:
                            return path_parts[0]
            
            return None
        
        except subprocess.TimeoutExpired:
            if process is not None:
                process.kill()
                process.communicate()
            return None
        except Exception:
            return None
    
    def _find_git_repo(self, start_path: Optional[str] = None) -> Optional[str]:
        """
        Find a Git repository starting from the given path or current directory.
        Searches upward in directory tree.
        
        Args:
            start_path: Path to start searching from (defaults to cwd)
            
        Returns:
            Path to Git repository root, or None if not found
        """
        if start_path is None:
            start_path = os.getcwd()
        
        process: subprocess.Popen[str] | None = None
        try:
            # Use Popen with explicit pipe configuration to avoid stdio conflicts
            process = subprocess.Popen(
                ['git', '-C', start_path, 'rev-parse', '--show-toplevel'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,  # Don't inherit stdin
                text=True
            )
            
            stdout, _stderr = process.communicate(timeout=0.5)
            
            if process.returncode == 0:
                return stdout.strip()
        except subprocess.TimeoutExpired:
            if process is not None:
                process.kill()
                process.communicate()  # Clean up
        except Exception:
            pass
        
        return None
    
    def get_project_context_sync(self) -> Dict[str, Any]:
        """
        Get current project context (git repo, branch, etc.) - synchronous version for thread pool.
        
        Returns:
            Dictionary containing project context information
        """
        import sys
        
        context: Dict[str, Any] = {}
        
        cwd = os.getcwd()
        context['cwd'] = cwd
        context['timestamp'] = datetime.now().isoformat()
        
        # Try to find a Git repository
        repo_path = self._find_git_repo(cwd)
        
        # If not in a Git repo, try parent directory only (fast check)
        if repo_path is None:
            parent = os.path.dirname(cwd)
            if parent != cwd:  # Not at filesystem root
                repo_path = self._find_git_repo(parent)
        
        # If still no repo found, return early with error
        if repo_path is None:
            context['git_error'] = 'Not a Git repository and no Git repo found in parent directories'
            return context
        
        # Now we have a valid repo_path, gather Git info
        try:
            # Verify we can access the repo
            process = subprocess.Popen(
                ['git', '-C', repo_path, 'rev-parse', '--show-toplevel'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                text=True
            )
            stdout, _stderr = process.communicate(timeout=GIT_TIMEOUT)
            
            if process.returncode == 0:
                repo_path = stdout.strip()
                context['repo_path'] = repo_path
                
                # Get repository name
                repo_name = os.path.basename(repo_path)
                context['repo_name'] = repo_name
                
                # Get current branch
                try:
                    process = subprocess.Popen(
                        ['git', '-C', repo_path, 'rev-parse', '--abbrev-ref', 'HEAD'],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        stdin=subprocess.DEVNULL,
                        text=True
                    )
                    stdout, _stderr = process.communicate(timeout=GIT_TIMEOUT)
                    if process.returncode == 0:
                        context['branch'] = stdout.strip()
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    context['branch_error'] = 'Timeout'
                except Exception as e:
                    context['branch_error'] = str(e)
                
                # Get last commit info
                try:
                    process = subprocess.Popen(
                        ['git', '-C', repo_path, 'log', '-1', '--pretty=format:%H|%s|%an|%ae|%ad'],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        stdin=subprocess.DEVNULL,
                        text=True
                    )
                    stdout, _stderr = process.communicate(timeout=GIT_TIMEOUT)
                    if process.returncode == 0 and stdout:
                        parts = stdout.split('|')
                        if len(parts) >= 5:
                            context['last_commit'] = {
                                'hash': parts[0][:7],
                                'message': parts[1],
                                'author': parts[2],
                                'email': parts[3],
                                'date': parts[4]
                            }
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    context['commit_error'] = 'Timeout'
                except Exception as e:
                    context['commit_error'] = str(e)
                
                # Get Git status
                try:
                    process = subprocess.Popen(
                        ['git', '-C', repo_path, 'status', '--porcelain'],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        stdin=subprocess.DEVNULL,
                        text=True
                    )
                    stdout, _stderr = process.communicate(timeout=GIT_TIMEOUT)
                    if process.returncode == 0:
                        status_lines = stdout.strip().split('\n') if stdout.strip() else []
                        context['git_status'] = f"{len(status_lines)} files changed" if status_lines else "clean"
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    context['git_status'] = 'Timeout'
                except Exception as e:
                    context['git_status'] = f"Error: {e}"
                
                # Get GitHub Projects context if available
                # Note: This makes API calls - we'll skip if it takes too long
                if self.github_projects is not None:
                    github_projects = self.github_projects  # Local reference for closures
                    try:
                        def get_github_context() -> Optional[Dict[str, Any]]:
                            try:
                                return github_projects.get_projects_context(repo_path)
                            except Exception:
                                return None
                        
                        # Run in a thread with 8 second timeout (allows up to 2 API calls @ 5s each)
                        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                            future = executor.submit(get_github_context)
                            try:
                                projects_context = future.result(timeout=8.0)
                                if projects_context:
                                    context.update(projects_context)
                            except concurrent.futures.TimeoutError:
                                context['github_projects_error'] = 'Timed out (8s limit)'
                    except Exception as e:
                        context['github_projects_error'] = str(e)
                    
                    # Get GitHub Issues and PRs context
                    try:
                        owner = self.extract_repo_owner_from_remote(repo_path)
                        if owner and repo_name:
                            # Fetch issues with 3 second timeout
                            def get_issues_context() -> Optional[list[Dict[str, Any]]]:
                                try:
                                    from github.api import get_repo_issues
                                    return get_repo_issues(github_projects, owner, repo_name, state='open', limit=10)
                                except Exception:
                                    return None
                            
                            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                                future = executor.submit(get_issues_context)
                                try:
                                    issues = future.result(timeout=3.0)
                                    if issues:
                                        context['github_issues'] = issues
                                except concurrent.futures.TimeoutError:
                                    context['github_issues_error'] = 'Timed out (3s limit)'
                            
                            # Fetch PRs and current PR with 3 second timeout
                            def get_prs_context() -> Optional[Dict[str, Any]]:
                                try:
                                    from github.api import get_repo_pull_requests, get_pr_from_branch
                                    prs = get_repo_pull_requests(github_projects, owner, repo_name, state='open', limit=5)
                                    current_pr = None
                                    if context.get('branch'):
                                        current_pr = get_pr_from_branch(github_projects, owner, repo_name, context['branch'])
                                    return {'prs': prs, 'current_pr': current_pr}
                                except Exception:
                                    return None
                            
                            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                                future = executor.submit(get_prs_context)
                                try:
                                    prs_data = future.result(timeout=3.0)
                                    if prs_data:
                                        context['github_pull_requests'] = prs_data.get('prs', [])
                                        if prs_data.get('current_pr'):
                                            context['current_pr'] = prs_data['current_pr']
                                except concurrent.futures.TimeoutError:
                                    context['github_prs_error'] = 'Timed out (3s limit)'
                            
                            # Fetch GitHub Actions workflow runs with 3 second timeout
                            def get_workflow_runs_context() -> Optional[Dict[str, Any]]:
                                try:
                                    from github.api import get_repo_workflow_runs, compute_ci_status
                                    # Get workflow runs for current branch
                                    branch = context.get('branch')
                                    runs = get_repo_workflow_runs(
                                        github_projects, owner, repo_name,
                                        branch=branch, limit=5
                                    )
                                    ci_status = compute_ci_status(runs)
                                    return {'runs': runs, 'ci_status': ci_status}
                                except Exception:
                                    return None
                            
                            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                                future = executor.submit(get_workflow_runs_context)
                                try:
                                    workflow_data = future.result(timeout=3.0)
                                    if workflow_data:
                                        context['github_workflow_runs'] = workflow_data.get('runs', [])
                                        context['ci_status'] = workflow_data.get('ci_status', 'unknown')
                                except concurrent.futures.TimeoutError:
                                    context['github_workflow_runs_error'] = 'Timed out (3s limit)'
                                    context['ci_status'] = 'unknown'
                    except Exception as e:
                        context['github_issues_error'] = str(e)
                        context['github_prs_error'] = str(e)
                        context['github_workflow_runs_error'] = str(e)
            else:
                context['git_error'] = 'Not a Git repository'
                
        except subprocess.TimeoutExpired:
            context['git_error'] = f'Git operation timed out after {GIT_TIMEOUT}s'
        except FileNotFoundError:
            context['git_error'] = 'Git not found in PATH'
        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            context['git_error'] = str(e)
        
        return context
    
    async def get_project_context(self) -> Dict[str, Any]:
        """
        Get current project context (git repo, branch, etc.) - async version.
        
        Returns:
            Dictionary containing project context information
        """
        import sys
        
        # OPTIMIZATION: Do a very quick check first without thread pool
        # to avoid thread pool contention for the common case of "no git repo"
        cwd = os.getcwd()
        
        # Ultra-fast check: is there a .git directory here?
        git_dir = os.path.join(cwd, '.git')
        parent_git_dir = os.path.join(os.path.dirname(cwd), '.git')
        
        has_git_nearby = os.path.isdir(git_dir) or os.path.isdir(parent_git_dir)
        
        if not has_git_nearby:
            # No .git directory found - return immediately without any Git operations
            return {
                'git_error': 'Not a Git repository',
                'cwd': cwd,
                'timestamp': datetime.now().isoformat()
            }
        
        # We found a .git directory, now gather full context
        try:
            # Run synchronously in a thread to avoid event loop blocking
            # but with a wrapper that can be awaited
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, self.get_project_context_sync)
            return result
            
        except Exception as e:
            print(f"[ERROR] Context gathering failed: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {
                'git_error': f'Error gathering context: {str(e)}',
                'cwd': cwd,
                'timestamp': datetime.now().isoformat()
            }
