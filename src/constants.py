"""
Memory Journal MCP Server - Constants and Configuration
All configuration constants, magic values, and settings used throughout the application.
"""

import os

# Database configuration
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "memory_journal.db")

# Team collaboration database (Git-tracked, shared)
TEAM_DB_FILENAME = ".memory-journal-team.db"
TEAM_DB_PATH = os.path.join(os.path.dirname(__file__), "..", TEAM_DB_FILENAME)

# Security constants - Input validation limits
MAX_CONTENT_LENGTH = 50000  # 50KB max for journal entries
MAX_TAG_LENGTH = 100
MAX_ENTRY_TYPE_LENGTH = 50
MAX_SIGNIFICANCE_TYPE_LENGTH = 50

# Database PRAGMA settings
DB_PRAGMA_SETTINGS = {
    'foreign_keys': 'ON',
    'journal_mode': 'WAL',
    'synchronous': 'NORMAL',
    'cache_size': -64000,  # Negative value = KB (64MB cache)
    'mmap_size': 268435456,  # 256MB memory-mapped I/O
    'temp_store': 'MEMORY',
    'busy_timeout': 30000  # 30 seconds
}

# Thread pool configuration
THREAD_POOL_MAX_WORKERS = 10  # Increased for ML model loading and async operations (31+ uses across codebase)

# Git operation timeouts
GIT_TIMEOUT = 2  # 2 seconds max per Git command
ASYNC_GIT_TIMEOUT = 20.0  # 20 seconds total timeout (includes Git + GitHub API calls - can make multiple 5s API requests)

# GitHub API configuration
GITHUB_API_BASE = 'https://api.github.com'
GITHUB_API_TIMEOUT = 5  # 5 seconds timeout per API call

# Cache TTLs (Time To Live in seconds)
CACHE_TTL_OWNER_TYPE = 86400  # 24 hours for owner type (rarely changes)
CACHE_TTL_PROJECT = 3600  # 1 hour for project metadata
CACHE_TTL_ITEMS = 900  # 15 minutes for project items
CACHE_TTL_MILESTONE = 3600  # 1 hour for milestones
CACHE_TTL_ISSUES = 900  # 15 minutes for GitHub issues
CACHE_TTL_PULL_REQUESTS = 900  # 15 minutes for GitHub pull requests

# Vector search configuration
VECTOR_SEARCH_MODEL = 'all-MiniLM-L6-v2'
VECTOR_SEARCH_DIMENSIONS = 384  # Dimensions for all-MiniLM-L6-v2
DEFAULT_SIMILARITY_THRESHOLD = 0.3

# Mermaid diagram relationship symbols
RELATIONSHIP_SYMBOLS = {
    'references': '-->',
    'implements': '==>',
    'clarifies': '-.->',
    'evolves_from': '-->',
    'response_to': '<-->'
}

# Mermaid diagram styling
MERMAID_STYLE_PERSONAL = '#E3F2FD'  # Blue for personal entries
MERMAID_STYLE_PROJECT = '#FFF3E0'  # Orange for project entries

# Server metadata
SERVER_NAME = "memory-journal-mcp"
SERVER_VERSION = "2.0.0"

# Date/time formats
DATE_FORMAT_ISO = '%Y-%m-%d'
DATETIME_FORMAT_ISO = '%Y-%m-%d %H:%M:%S'
DATE_FORMAT_MONTH = '%Y-%m'
DATE_FORMAT_WEEK = '%Y-W%W'

# Export limits and defaults
EXPORT_PREVIEW_LENGTH = 2000  # Characters to show in export preview
CONTENT_PREVIEW_LENGTH = 200  # Default content preview length
CONTENT_SNIPPET_LENGTH = 150  # Shorter snippet length
CONTENT_PREVIEW_SHORT = 100  # Very short preview
CONTENT_PREVIEW_TITLE = 40  # For titles in graphs
CONTENT_PREVIEW_MINI = 60  # For issue titles

# Query and result limits
DEFAULT_SEARCH_LIMIT = 10
DEFAULT_ENTRY_LIMIT = 5
DEFAULT_TAG_LIMIT = 10
DEFAULT_RECENT_GRAPH_LIMIT = 20
DEFAULT_VISUALIZATION_LIMIT = 20
MAX_TIMELINE_EVENTS = 50
MAX_VELOCITY_WEEKS = 12

# Database maintenance thresholds
DB_VACUUM_SIZE_THRESHOLD = 100 * 1024 * 1024  # 100MB

# Inactive project detection
INACTIVE_PROJECT_DAYS = 7  # Consider project inactive after 7 days without entries

