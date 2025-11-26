"""
Memory Journal MCP Server - GitHub GraphQL API Module
GraphQL queries for GitHub Projects v2 API.
"""

from typing import Dict, Any, List, Optional

# GraphQL query for user projects
USER_PROJECTS_QUERY = """
query($login: String!, $first: Int!) {
  user(login: $login) {
    projectsV2(first: $first) {
      nodes {
        id
        number
        title
        shortDescription
        url
        public
        closed
        createdAt
        updatedAt
      }
    }
  }
}
"""

# GraphQL query for organization projects
ORG_PROJECTS_QUERY = """
query($login: String!, $first: Int!) {
  organization(login: $login) {
    projectsV2(first: $first) {
      nodes {
        id
        number
        title
        shortDescription
        url
        public
        closed
        createdAt
        updatedAt
      }
    }
  }
}
"""


def execute_graphql_query(
    integration: Any,
    query: str,
    variables: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Execute a GraphQL query against GitHub's API.
    
    Args:
        integration: GitHubProjectsIntegration instance
        query: GraphQL query string
        variables: Variables for the query
        
    Returns:
        Response data or None on error
    """
    try:
        import requests  # type: ignore[import-not-found]
        
        url = "https://api.github.com/graphql"
        headers = integration.get_headers()
        
        response = requests.post(
            url,
            json={"query": query, "variables": variables},
            headers=headers,
            timeout=integration.api_timeout
        )
        
        if response.status_code == 200:
            data = response.json()
            if 'errors' in data:
                return None
            return data.get('data')
        else:
            return None
            
    except Exception:
        return None


def get_user_projects_v2(
    integration: Any,
    username: str,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Get GitHub Projects v2 for a user using GraphQL.
    
    Args:
        integration: GitHubProjectsIntegration instance
        username: GitHub username
        limit: Maximum number of projects to return
        
    Returns:
        List of project dictionaries
    """
    data = execute_graphql_query(
        integration,
        USER_PROJECTS_QUERY,
        {"login": username, "first": limit}
    )
    
    if not data or 'user' not in data or not data['user']:
        return []
    
    projects: List[Dict[str, Any]] = data['user'].get('projectsV2', {}).get('nodes', [])
    
    # Convert to our standard format
    result: List[Dict[str, Any]] = []
    for proj in projects:
        result.append({
            'number': proj.get('number'),
            'name': proj.get('title'),
            'description': proj.get('shortDescription'),
            'url': proj.get('url'),
            'state': 'closed' if proj.get('closed') else 'open',
            'created_at': proj.get('createdAt'),
            'updated_at': proj.get('updatedAt'),
            'source': 'user',
            'owner': username,
            'public': proj.get('public', False)
        })
    
    return result


def get_org_projects_v2(
    integration: Any,
    org_name: str,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Get GitHub Projects v2 for an organization using GraphQL.
    
    Args:
        integration: GitHubProjectsIntegration instance
        org_name: GitHub organization name
        limit: Maximum number of projects to return
        
    Returns:
        List of project dictionaries
    """
    data = execute_graphql_query(
        integration,
        ORG_PROJECTS_QUERY,
        {"login": org_name, "first": limit}
    )
    
    if not data or 'organization' not in data or not data['organization']:
        return []
    
    projects: List[Dict[str, Any]] = data['organization'].get('projectsV2', {}).get('nodes', [])
    
    # Convert to our standard format
    result: List[Dict[str, Any]] = []
    for proj in projects:
        result.append({
            'number': proj.get('number'),
            'name': proj.get('title'),
            'description': proj.get('shortDescription'),
            'url': proj.get('url'),
            'state': 'closed' if proj.get('closed') else 'open',
            'created_at': proj.get('createdAt'),
            'updated_at': proj.get('updatedAt'),
            'source': 'org',
            'owner': org_name,
            'public': proj.get('public', False)
        })
    
    return result

