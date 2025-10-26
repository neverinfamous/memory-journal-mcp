#!/usr/bin/env python3
"""
Memory Journal MCP Server
A Model Context Protocol server for personal journaling with context awareness.
"""

import asyncio
import json
import sqlite3
import os
import subprocess
import sys
from datetime import datetime
from typing import Dict, List, Any, Tuple, Optional
from concurrent.futures import ThreadPoolExecutor
import pickle

# Import numpy only when needed for vector operations
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    np = None

try:
    from mcp.server import Server, NotificationOptions, InitializationOptions
    from mcp.types import Resource, Tool, Prompt, PromptMessage, PromptArgument
    from pydantic import AnyUrl
    import mcp.server.stdio
    import mcp.types as types
except ImportError:
    print("MCP library not found. Install with: pip install mcp")
    exit(1)

# Vector search availability check (defer actual imports for faster startup)
VECTOR_SEARCH_AVAILABLE = False
try:
    import importlib.util
    if importlib.util.find_spec("sentence_transformers") and importlib.util.find_spec("faiss"):
        VECTOR_SEARCH_AVAILABLE = True
        print("[INFO] Vector search capabilities available (will load on first use)", file=sys.stderr)
except Exception:
    print("Vector search dependencies not found. Install with: pip install sentence-transformers faiss-cpu", file=sys.stderr)
    print("Continuing without semantic search capabilities...", file=sys.stderr)

# Lazy imports for vector search (loaded on first use)
SentenceTransformer = None
faiss = None

# Try importing at module level if available
if VECTOR_SEARCH_AVAILABLE:
    try:
        from sentence_transformers import SentenceTransformer as ST
        import faiss as faiss_module
        SentenceTransformer = ST
        faiss = faiss_module
        print("[INFO] Vector search dependencies pre-loaded at startup", file=sys.stderr)
    except Exception as e:
        print(f"[WARNING] Could not pre-load vector search dependencies: {e}", file=sys.stderr)
        VECTOR_SEARCH_AVAILABLE = False

# Thread pool for non-blocking database operations and ML model loading
thread_pool = ThreadPoolExecutor(max_workers=4)  # Increased for ML model loading

# Initialize the MCP server
server = Server("memory-journal")

# Database path - relative to server location
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "memory_journal.db")


class MemoryJournalDB:
    """Database operations for the Memory Journal system."""

    # Security constants
    MAX_CONTENT_LENGTH = 50000  # 50KB max for journal entries
    MAX_TAG_LENGTH = 100
    MAX_ENTRY_TYPE_LENGTH = 50
    MAX_SIGNIFICANCE_TYPE_LENGTH = 50

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._validate_db_path()
        self.init_database()

    def _validate_db_path(self):
        """Validate database path for security."""
        # Ensure the database path is within allowed directories
        abs_db_path = os.path.abspath(self.db_path)

        # Get the directory containing the database
        db_dir = os.path.dirname(abs_db_path)

        # Ensure directory exists and create if it doesn't
        if not os.path.exists(db_dir):
            os.makedirs(db_dir, mode=0o700)  # Restrictive permissions

        # Set restrictive permissions on database file if it exists
        if os.path.exists(abs_db_path):
            os.chmod(abs_db_path, 0o600)  # Read/write for owner only

    def init_database(self):
        """Initialize database with schema and optimal settings."""
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")

        with sqlite3.connect(self.db_path) as conn:
            # Enable foreign key constraints
            conn.execute("PRAGMA foreign_keys = ON")

            # Enable WAL mode for better performance and concurrency
            conn.execute("PRAGMA journal_mode = WAL")

            # Set synchronous mode to NORMAL for good balance of safety and performance
            conn.execute("PRAGMA synchronous = NORMAL")

            # Increase cache size for better performance (default is usually too small)
            # 64MB cache (64 * 1024 * 1024 / page_size), assuming 4KB pages = ~16384 pages
            conn.execute("PRAGMA cache_size = -64000")  # Negative value = KB

            # Enable memory-mapped I/O for better performance (256MB)
            conn.execute("PRAGMA mmap_size = 268435456")

            # Set temp store to memory for better performance
            conn.execute("PRAGMA temp_store = MEMORY")

            # Security: Set a reasonable timeout for busy database
            conn.execute("PRAGMA busy_timeout = 30000")  # 30 seconds

            # Run migrations BEFORE applying schema (for existing databases)
            self._run_migrations(conn)

            if os.path.exists(schema_path):
                with open(schema_path, 'r') as f:
                    conn.executescript(f.read())

            # Note: PRAGMA optimize and ANALYZE are expensive and only run during maintenance
            # They don't need to run on every startup

    def _run_migrations(self, conn):
        """Run database migrations for schema updates."""
        # Check if memory_journal table exists first
        cursor = conn.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='memory_journal'
        """)
        if not cursor.fetchone():
            # Table doesn't exist yet, skip migrations (schema will create it)
            return
        
        # Check if deleted_at column exists
        cursor = conn.execute("PRAGMA table_info(memory_journal)")
        columns = {row[1] for row in cursor.fetchall()}
        
        if 'deleted_at' not in columns:
            print("Running migration: Adding deleted_at column to memory_journal table", file=sys.stderr)
            conn.execute("ALTER TABLE memory_journal ADD COLUMN deleted_at TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_deleted ON memory_journal(deleted_at)")
            conn.commit()
            print("Migration completed: deleted_at column added", file=sys.stderr)
        
        # Check if relationships table exists
        cursor = conn.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='relationships'
        """)
        if not cursor.fetchone():
            print("Running migration: Creating relationships table", file=sys.stderr)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS relationships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_entry_id INTEGER NOT NULL,
                    to_entry_id INTEGER NOT NULL,
                    relationship_type TEXT NOT NULL DEFAULT 'references',
                    description TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (from_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
                    FOREIGN KEY (to_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entry_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entry_id)")
            conn.commit()
            print("Migration completed: relationships table created", file=sys.stderr)
        
        # Migration: Add GitHub Projects columns (Phase 1 - Issue #15)
        cursor = conn.execute("PRAGMA table_info(memory_journal)")
        columns = {row[1] for row in cursor.fetchall()}
        
        if 'project_number' not in columns:
            print("Running migration: Adding GitHub Projects columns to memory_journal table", file=sys.stderr)
            conn.execute("ALTER TABLE memory_journal ADD COLUMN project_number INTEGER")
            conn.execute("ALTER TABLE memory_journal ADD COLUMN project_item_id INTEGER")
            conn.execute("ALTER TABLE memory_journal ADD COLUMN github_project_url TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_project_number ON memory_journal(project_number)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_project_item_id ON memory_journal(project_item_id)")
            conn.commit()
            print("Migration completed: GitHub Projects columns added", file=sys.stderr)

    def maintenance(self):
        """Perform database maintenance operations."""
        with self.get_connection() as conn:
            # Update query planner statistics
            conn.execute("ANALYZE")

            # Optimize database
            conn.execute("PRAGMA optimize")

            # Clean up unused space (VACUUM is expensive but thorough)
            # Only run if database is not too large
            db_size = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0
            if db_size < 100 * 1024 * 1024:  # Less than 100MB
                conn.execute("VACUUM")

            # Verify database integrity
            integrity_check = conn.execute("PRAGMA integrity_check").fetchone()
            if integrity_check[0] != "ok":
                print(f"WARNING: Database integrity issue: {integrity_check[0]}")

            print("Database maintenance completed successfully")

    def get_connection(self):
        """Get database connection with proper settings."""
        conn = sqlite3.connect(self.db_path)

        # Apply consistent PRAGMA settings for all connections
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA cache_size = -64000")
        conn.execute("PRAGMA temp_store = MEMORY")
        conn.execute("PRAGMA busy_timeout = 30000")

        conn.row_factory = sqlite3.Row
        return conn

    def _validate_input(self, content: str, entry_type: str, tags: List[str], significance_type: Optional[str] = None):
        """Validate input parameters for security."""
        # Validate content length
        if len(content) > self.MAX_CONTENT_LENGTH:
            raise ValueError(f"Content exceeds maximum length of {self.MAX_CONTENT_LENGTH} characters")

        # Validate entry type
        if len(entry_type) > self.MAX_ENTRY_TYPE_LENGTH:
            raise ValueError(f"Entry type exceeds maximum length of {self.MAX_ENTRY_TYPE_LENGTH} characters")

        # Validate tags
        for tag in tags:
            if len(tag) > self.MAX_TAG_LENGTH:
                raise ValueError(f"Tag '{tag}' exceeds maximum length of {self.MAX_TAG_LENGTH} characters")
            # Check for potentially dangerous characters
            if any(char in tag for char in ['<', '>', '"', "'", '&', '\x00']):
                raise ValueError(f"Tag contains invalid characters: {tag}")

        # Validate significance type if provided
        if significance_type and len(significance_type) > self.MAX_SIGNIFICANCE_TYPE_LENGTH:
            raise ValueError(f"Significance type exceeds maximum length of {self.MAX_SIGNIFICANCE_TYPE_LENGTH} characters")

        # Note: We rely on parameterized queries for SQL injection prevention
        # No need for content warnings since we never execute user content as SQL

    def auto_create_tags(self, tag_names: List[str]) -> List[int]:
        """Auto-create tags if they don't exist, return tag IDs. Thread-safe with INSERT OR IGNORE."""
        tag_ids = []

        with self.get_connection() as conn:
            for tag_name in tag_names:
                # Use INSERT OR IGNORE to handle race conditions
                conn.execute(
                    "INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 1)",
                    (tag_name,)
                )
                
                # Now fetch the tag ID (whether we just created it or it already existed)
                cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                row = cursor.fetchone()
                if row:
                    tag_ids.append(row['id'])

        return tag_ids

    def get_project_context_sync(self) -> Dict[str, Any]:
        """Get current project context (git repo, branch, etc.) - synchronous version for thread pool."""
        context = {}

        # AGGRESSIVE TIMEOUT: Use much shorter timeouts and fail fast
        git_timeout = 2  # 2 seconds max per Git command

        try:
            # Get git repository root with aggressive timeout
            result = subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                                     capture_output=True, text=True, cwd=os.getcwd(),
                                     timeout=git_timeout, shell=False)
            if result.returncode == 0:
                repo_path = result.stdout.strip()
                context['repo_path'] = repo_path
                context['repo_name'] = os.path.basename(repo_path)
                context['git_status'] = 'repo_found'

                # Get current branch with aggressive timeout
                try:
                    result = subprocess.run(['git', 'branch', '--show-current'],
                                           capture_output=True, text=True, cwd=repo_path,
                                           timeout=git_timeout, shell=False)
                    if result.returncode == 0:
                        context['branch'] = result.stdout.strip()
                except subprocess.TimeoutExpired:
                    context['branch_error'] = 'Branch query timed out'

                # Get last commit info with aggressive timeout
                try:
                    result = subprocess.run(['git', 'log', '-1', '--format=%H:%s'],
                                           capture_output=True, text=True, cwd=repo_path,
                                           timeout=git_timeout, shell=False)
                    if result.returncode == 0:
                        commit_info = result.stdout.strip()
                        if ':' in commit_info:
                            commit_hash, commit_msg = commit_info.split(':', 1)
                            context['last_commit'] = {
                                'hash': commit_hash[:8],  # Short hash
                                'message': commit_msg.strip()
                            }
                except subprocess.TimeoutExpired:
                    context['commit_error'] = 'Commit query timed out'
            else:
                context['git_status'] = 'not_a_repo'

        except subprocess.TimeoutExpired:
            context['git_error'] = f'Git operations timed out after {git_timeout}s'
        except FileNotFoundError:
            context['git_error'] = 'Git not found in PATH'
        except Exception as e:
            context['git_error'] = f'Git error: {str(e)}'

        # Get GitHub issue context if we have a valid repo
        if 'repo_path' in context and context.get('git_status') == 'repo_found':
            try:
                # Check if GitHub CLI is available and authenticated
                result = subprocess.run(['gh', 'auth', 'status'],
                                       capture_output=True, text=True,
                                       timeout=git_timeout, shell=False)
                if result.returncode == 0:
                    # Get current open issues (limit to 3 most recent)
                    try:
                        result = subprocess.run([
                            'gh', 'issue', 'list', '--limit', '3', '--json',
                            'number,title,state,createdAt'
                        ], capture_output=True, text=True, cwd=context['repo_path'],
                           timeout=git_timeout, shell=False)
                        if result.returncode == 0 and result.stdout.strip():
                            import json
                            issues = json.loads(result.stdout.strip())
                            if issues:
                                context['github_issues'] = {
                                    'count': len(issues),
                                    'recent_issues': [
                                        {
                                            'number': issue['number'],
                                            'title': issue['title'][:60] + ('...' if len(issue['title']) > 60 else ''),
                                            'state': issue['state'],
                                            'created': issue['createdAt'][:10]  # Just the date
                                        }
                                        for issue in issues
                                    ]
                                }
                            else:
                                context['github_issues'] = {'count': 0, 'message': 'No open issues'}
                    except subprocess.TimeoutExpired:
                        context['github_issues_error'] = 'GitHub issues query timed out'
                    except json.JSONDecodeError:
                        context['github_issues_error'] = 'Failed to parse GitHub issues JSON'
                else:
                    context['github_issues_error'] = 'GitHub CLI not authenticated'
            except FileNotFoundError:
                context['github_issues_error'] = 'GitHub CLI (gh) not found in PATH'
            except subprocess.TimeoutExpired:
                context['github_issues_error'] = 'GitHub auth check timed out'
            except Exception as e:
                context['github_issues_error'] = f'GitHub error: {str(e)}'
        
        # Get GitHub Projects context (Phase 1 - Issue #15)
        if 'repo_path' in context and context.get('git_status') == 'repo_found':
            try:
                github_projects_context = github_projects.get_projects_context(context['repo_path'])
                if github_projects_context:
                    context['github_projects'] = github_projects_context
            except Exception as e:
                context['github_projects_error'] = f'GitHub Projects error: {str(e)}'

        context['cwd'] = os.getcwd()
        context['timestamp'] = datetime.now().isoformat()

        return context

    async def get_project_context(self) -> Dict[str, Any]:
        """Get current project context (git repo, branch, etc.) - async version."""
        loop = asyncio.get_event_loop()
        try:
            # Add overall timeout to the async operation itself
            return await asyncio.wait_for(
                loop.run_in_executor(thread_pool, self.get_project_context_sync),
                timeout=10.0  # 10 seconds total timeout
            )
        except asyncio.TimeoutError:
            return {
                'git_error': 'Async Git operations timed out after 10s',
                'cwd': os.getcwd(),
                'timestamp': datetime.now().isoformat()
            }


# Initialize database
db = MemoryJournalDB(DB_PATH)


class VectorSearchManager:
    """Manages vector embeddings and semantic search functionality."""

    def __init__(self, db_path: str, model_name: str = 'all-MiniLM-L6-v2'):
        self.db_path = db_path
        self.model_name = model_name
        self.model = None
        self.faiss_index = None
        self.entry_id_map = {}  # Maps FAISS index positions to entry IDs
        self.initialized = False
        self._initialization_lock = asyncio.Lock()
        self._initialization_task = None

        # Don't initialize immediately - do it lazily on first use for faster startup

    async def _ensure_initialized(self):
        """Lazy initialization - only initialize on first use (async to avoid blocking)."""
        # If already initialized, return immediately
        if self.initialized:
            return
        
        # If initialization is in progress, wait for it to complete
        async with self._initialization_lock:
            # Double-check after acquiring lock (another task might have completed it)
            if self.initialized:
                return
            
            if not VECTOR_SEARCH_AVAILABLE:
                return

            try:
                # Dependencies should already be imported at module level
                if SentenceTransformer is None or faiss is None:
                    print("[ERROR] Vector search dependencies not available", file=sys.stderr)
                    self.initialized = False
                    return

                # Use stderr for initialization messages to avoid MCP JSON parsing errors
                print(f"[INFO] Step 1/3: Loading ML model ({self.model_name})...", file=sys.stderr)
                
                # Run model loading in thread pool to avoid blocking the event loop
                loop = asyncio.get_event_loop()
                assert SentenceTransformer is not None, "SentenceTransformer should be imported"
                
                # Add explicit flush to ensure message appears
                sys.stderr.flush()
                
                self.model = await loop.run_in_executor(
                    thread_pool,
                    lambda: SentenceTransformer(self.model_name)  # type: ignore[misc]
                )
                print("[INFO] Step 1/3: ✅ Model loaded", file=sys.stderr)

                # Create FAISS index (384 dimensions for all-MiniLM-L6-v2)
                print("[INFO] Step 2/3: Creating FAISS index...", file=sys.stderr)
                self.faiss_index = faiss.IndexFlatIP(384)  # Inner product for cosine similarity
                print("[INFO] Step 2/3: ✅ FAISS index created", file=sys.stderr)

                # Load existing embeddings from database
                print("[INFO] Step 3/3: Loading existing embeddings from database...", file=sys.stderr)
                self._load_existing_embeddings()
                print(f"[INFO] Step 3/3: ✅ Loaded {self.faiss_index.ntotal} embeddings", file=sys.stderr)

                self.initialized = True
                print(f"[INFO] 🎉 Semantic search ready! ({self.faiss_index.ntotal} entries indexed)", file=sys.stderr)
                sys.stderr.flush()
            except Exception as e:
                print(f"[ERROR] Vector search initialization failed: {e}", file=sys.stderr)
                import traceback
                traceback.print_exc(file=sys.stderr)
                self.initialized = False

    def _load_existing_embeddings(self):
        """Load existing embeddings from database into FAISS index."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT entry_id, embedding_vector
                FROM memory_journal_embeddings
                WHERE embedding_model = ?
                ORDER BY entry_id
            """, (self.model_name,))

            vectors = []
            entry_ids = []

            for entry_id, embedding_blob in cursor.fetchall():
                # Deserialize the embedding vector
                embedding = pickle.loads(embedding_blob)
                vectors.append(embedding)
                entry_ids.append(entry_id)

            if vectors:
                # Normalize vectors for cosine similarity
                if not HAS_NUMPY:
                    raise RuntimeError("numpy is required for vector operations but not installed")
                vectors = np.array(vectors, dtype=np.float32)
                faiss.normalize_L2(vectors)  # type: ignore[call-arg]

                # Add to FAISS index
                self.faiss_index.add(vectors)  # type: ignore[call-arg]

                # Update entry ID mapping
                for i, entry_id in enumerate(entry_ids):
                    self.entry_id_map[i] = entry_id

    async def generate_embedding(self, text: str):
        """Generate embedding for text using sentence transformer."""
        await self._ensure_initialized()
        
        if not self.initialized:
            raise RuntimeError("Vector search not initialized")

        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        embedding = await loop.run_in_executor(
            thread_pool,
            lambda: self.model.encode([text], convert_to_tensor=False)[0]
        )

        if not HAS_NUMPY:
            raise RuntimeError("numpy is required for vector operations but not installed")
        return embedding.astype(np.float32)

    async def add_entry_embedding(self, entry_id: int, content: str) -> bool:
        """Generate and store embedding for a journal entry."""
        await self._ensure_initialized()
        
        if not self.initialized:
            return False

        try:
            # Generate embedding
            embedding = await self.generate_embedding(content)

            # Normalize for cosine similarity
            embedding_norm = embedding.copy()
            faiss.normalize_L2(embedding_norm.reshape(1, -1))

            # Store in database
            def store_embedding():
                with sqlite3.connect(self.db_path) as conn:
                    conn.execute("""
                        INSERT OR REPLACE INTO memory_journal_embeddings
                        (entry_id, embedding_model, embedding_vector, embedding_dimension)
                        VALUES (?, ?, ?, ?)
                    """, (entry_id, self.model_name, pickle.dumps(embedding), len(embedding)))

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(thread_pool, store_embedding)

            # Add to FAISS index
            self.faiss_index.add(embedding_norm.reshape(1, -1))  # type: ignore[call-arg]

            # Update entry ID mapping
            new_index = self.faiss_index.ntotal - 1
            self.entry_id_map[new_index] = entry_id

            return True

        except Exception as e:
            print(f"Error adding embedding for entry {entry_id}: {e}")
            return False

    async def semantic_search(self, query: str, limit: int = 10, similarity_threshold: float = 0.3) -> List[Tuple[int, float]]:
        """Perform semantic search and return entry IDs with similarity scores."""
        await self._ensure_initialized()
        
        if not self.initialized or self.faiss_index.ntotal == 0:
            return []

        try:
            # Generate query embedding
            query_embedding = await self.generate_embedding(query)

            # Normalize for cosine similarity
            query_norm = query_embedding.copy()
            faiss.normalize_L2(query_norm.reshape(1, -1))  # type: ignore[call-arg]

            # Search FAISS index
            scores, indices = self.faiss_index.search(query_norm.reshape(1, -1), min(limit * 2, self.faiss_index.ntotal))  # type: ignore[call-arg]

            # Convert to entry IDs and filter by threshold
            results = []
            for score, idx in zip(scores[0], indices[0]):
                if idx != -1 and score >= similarity_threshold:  # -1 means no more results
                    entry_id = self.entry_id_map.get(idx)
                    if entry_id:
                        results.append((entry_id, float(score)))

            # Sort by similarity score (descending) and limit results
            results.sort(key=lambda x: x[1], reverse=True)
            return results[:limit]

        except Exception as e:
            print(f"Error in semantic search: {e}")
            return []


# Initialize vector search manager
vector_search = VectorSearchManager(DB_PATH) if VECTOR_SEARCH_AVAILABLE else None


class GitHubProjectsIntegration:
    """GitHub Projects API integration for context awareness (Phase 1, 2 & 3)."""
    
    def __init__(self, db_connection: Optional['MemoryJournalDB'] = None):
        """Initialize GitHub Projects integration."""
        self.github_token = os.environ.get('GITHUB_TOKEN')
        self.github_org_token = os.environ.get('GITHUB_ORG_TOKEN')  # Phase 3: Optional separate org token
        self.default_org = os.environ.get('DEFAULT_ORG')  # Phase 3: Default org for ambiguous contexts
        self.api_base = 'https://api.github.com'
        self.api_timeout = 5  # 5 seconds timeout per API call
        self.db_connection = db_connection
        
        # Cache TTLs (Phase 2 - Issue #16)
        self.project_ttl = 3600  # 1 hour for project metadata
        self.items_ttl = 900  # 15 minutes for project items
        self.milestone_ttl = 3600  # 1 hour for milestones
        self.owner_type_ttl = 86400  # Phase 3: 24 hours for owner type (rarely changes)
        
    def _get_headers(self, use_org_token: bool = False) -> Dict[str, str]:
        """Get GitHub API headers.
        
        Args:
            use_org_token: If True and GITHUB_ORG_TOKEN is set, use org token instead
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
    
    def _extract_repo_owner_from_remote(self, repo_path: str) -> Optional[str]:
        """Extract repository owner from Git remote URL."""
        try:
            result = subprocess.run(
                ['git', 'config', '--get', 'remote.origin.url'],
                capture_output=True, text=True, cwd=repo_path,
                timeout=2, shell=False
            )
            if result.returncode == 0:
                remote_url = result.stdout.strip()
                # Parse GitHub URL formats:
                # https://github.com/owner/repo.git
                # git@github.com:owner/repo.git
                if 'github.com' in remote_url:
                    if remote_url.startswith('git@github.com:'):
                        parts = remote_url.replace('git@github.com:', '').replace('.git', '').split('/')
                    elif 'github.com/' in remote_url:
                        parts = remote_url.split('github.com/')[1].replace('.git', '').split('/')
                    else:
                        return None
                    
                    if len(parts) >= 1:
                        return parts[0]
        except Exception as e:
            print(f"Error extracting repo owner: {e}", file=sys.stderr)
        return None
    
    def detect_owner_type(self, owner: str) -> str:
        """Determine if owner is a user or organization (Phase 3 - Issue #17).
        
        Args:
            owner: GitHub username or organization name
            
        Returns:
            'user', 'org', or 'unknown'
            
        Uses caching (Phase 2) with 24hr TTL since owner type rarely changes.
        """
        # Check cache first (Phase 2 infrastructure)
        cache_key = f"owner_type:{owner}"
        cached = self._get_cache(cache_key)
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
                headers=self._get_headers(),
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
                self._set_cache(cache_key, owner_type, self.owner_type_ttl)
                return owner_type
            else:
                print(f"GitHub API error detecting owner type: {response.status_code}", file=sys.stderr)
        except ImportError:
            print("requests library not available for owner type detection", file=sys.stderr)
        except Exception as e:
            print(f"Error detecting owner type: {e}", file=sys.stderr)
        
        return 'unknown'
    
    def get_projects(self, owner: str, owner_type: str = 'user') -> List[Dict[str, Any]]:
        """Get GitHub Projects for a user or org with Phase 2 caching (Phase 3 - Issue #17).
        
        Args:
            owner: GitHub username or organization name
            owner_type: 'user' or 'org'
            
        Returns:
            List of project dictionaries with 'source' field indicating 'user' or 'org'
        """
        # Normalize owner_type
        if owner_type not in ['user', 'org']:
            owner_type = 'user'
        
        # Check cache first (Phase 2 infrastructure)
        cache_key = f"projects:{owner_type}:{owner}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached
        
        if not self.github_token:
            return []
        
        # Use org token for org projects if available
        use_org_token = (owner_type == 'org')
        
        try:
            import requests  # type: ignore[import-not-found]
            # Select endpoint based on owner type
            endpoint = f'/users/{owner}/projects' if owner_type == 'user' else f'/orgs/{owner}/projects'
            url = f"{self.api_base}{endpoint}"
            response = requests.get(
                url,
                headers=self._get_headers(use_org_token=use_org_token),
                timeout=self.api_timeout
            )
            
            if response.status_code == 200:
                projects = response.json()
                result = [{
                    'number': proj.get('number'),
                    'name': proj.get('name'),
                    'description': proj.get('body'),
                    'url': proj.get('html_url'),
                    'state': proj.get('state'),
                    'created_at': proj.get('created_at'),
                    'updated_at': proj.get('updated_at'),
                    'source': owner_type,  # Phase 3: Mark source (user vs org)
                    'owner': owner  # Phase 3: Store owner name
                } for proj in projects]
                # Cache for 1 hour (existing Phase 2 TTL)
                self._set_cache(cache_key, result, self.project_ttl)
                return result
            elif response.status_code == 403:
                print(f"GitHub API permission error for {owner_type} projects: 403 Forbidden", file=sys.stderr)
                return []
            else:
                print(f"GitHub API error: {response.status_code}", file=sys.stderr)
        except ImportError:
            print("requests library not available, using gh CLI fallback", file=sys.stderr)
            return self._get_projects_via_gh_cli(owner, owner_type)
        except Exception as e:
            print(f"Error fetching projects: {e}", file=sys.stderr)
        
        return []
    
    def get_user_projects(self, username: str) -> List[Dict[str, Any]]:
        """Get GitHub Projects for a user (backward compatibility wrapper)."""
        return self.get_projects(username, 'user')
    
    def _get_projects_via_gh_cli(self, owner: str, owner_type: str = 'user') -> List[Dict[str, Any]]:
        """Fallback: Get projects using gh CLI (Phase 3: supports user and org)."""
        try:
            result = subprocess.run(
                ['gh', 'project', 'list', '--owner', owner, '--format', 'json'],
                capture_output=True, text=True,
                timeout=self.api_timeout, shell=False
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
        except Exception as e:
            print(f"Error with gh CLI fallback: {e}", file=sys.stderr)
        return []
    
    def get_project_items(self, username: str, project_number: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Get items from a GitHub Project."""
        if not self.github_token:
            return []
        
        try:
            import requests  # type: ignore[import-not-found]
            url = f"{self.api_base}/users/{username}/projects/{project_number}/items"
            response = requests.get(
                url,
                headers=self._get_headers(),
                params={'per_page': limit},
                timeout=self.api_timeout
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
            print("requests library not available, using gh CLI fallback", file=sys.stderr)
            return self._get_project_items_via_gh_cli(username, project_number, limit)
        except Exception as e:
            print(f"Error fetching project items: {e}", file=sys.stderr)
        
        return []
    
    def _get_project_items_via_gh_cli(self, username: str, project_number: int, limit: int) -> List[Dict[str, Any]]:
        """Fallback: Get project items using gh CLI."""
        try:
            result = subprocess.run(
                ['gh', 'project', 'item-list', str(project_number), '--owner', username, '--format', 'json', '--limit', str(limit)],
                capture_output=True, text=True,
                timeout=self.api_timeout, shell=False
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
        except Exception as e:
            print(f"Error with gh CLI fallback for items: {e}", file=sys.stderr)
        return []
    
    def get_projects_context(self, repo_path: str) -> Dict[str, Any]:
        """Get GitHub Projects context for the current repository (Phase 3: user + org support)."""
        context: Dict[str, Any] = {
            'github_projects': {
                'user_projects': [],
                'org_projects': []
            },
            'active_items': []
        }
        
        # Extract repo owner from Git remote
        owner = self._extract_repo_owner_from_remote(repo_path)
        if not owner:
            return context
        
        # Phase 3: Detect owner type (user or org)
        owner_type = self.detect_owner_type(owner)
        
        # Query user projects
        user_projects = self.get_projects(owner, 'user')
        if user_projects:
            context['github_projects']['user_projects'] = user_projects
        
        # Query org projects if owner is an org
        if owner_type == 'org':
            org_projects = self.get_projects(owner, 'org')
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
                items = self.get_project_items(project_owner, project_number, limit=5)
                context['active_items'] = items
        
        return context
    
    # Phase 2 - Issue #16: Advanced Features
    
    def _get_cache(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired."""
        if not self.db_connection:
            return None
        
        try:
            with self.db_connection.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT cache_value, cached_at, ttl_seconds
                    FROM github_project_cache
                    WHERE cache_key = ?
                """, (key,))
                row = cursor.fetchone()
                
                if row:
                    cache_value, cached_at, ttl_seconds = row
                    import time
                    current_time = int(time.time())
                    
                    # Check if cache is still valid
                    if current_time - cached_at < ttl_seconds:
                        return json.loads(cache_value)
                    else:
                        # Cache expired, delete it
                        conn.execute("DELETE FROM github_project_cache WHERE cache_key = ?", (key,))
        except Exception as e:
            print(f"Cache read error: {e}", file=sys.stderr)
        
        return None
    
    def _set_cache(self, key: str, value: Any, ttl: int) -> None:
        """Set value in cache with TTL."""
        if not self.db_connection:
            return
        
        try:
            import time
            with self.db_connection.get_connection() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO github_project_cache (cache_key, cache_value, cached_at, ttl_seconds)
                    VALUES (?, ?, ?, ?)
                """, (key, json.dumps(value), int(time.time()), ttl))
        except Exception as e:
            print(f"Cache write error: {e}", file=sys.stderr)
    
    def get_project_details(self, owner: str, project_number: int, owner_type: str = 'user') -> Optional[Dict[str, Any]]:
        """Get detailed information about a specific GitHub Project with caching (Phase 3: org support)."""
        # Normalize owner_type
        if owner_type not in ['user', 'org']:
            owner_type = 'user'
        
        cache_key = f"project_details:{owner_type}:{owner}:{project_number}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached
        
        if not self.github_token:
            return None
        
        # Use org token for org projects if available
        use_org_token = (owner_type == 'org')
        
        try:
            import requests  # type: ignore[import-not-found]
            # Select endpoint based on owner type
            endpoint = f'/users/{owner}/projects/{project_number}' if owner_type == 'user' else f'/orgs/{owner}/projects/{project_number}'
            url = f"{self.api_base}{endpoint}"
            response = requests.get(
                url,
                headers=self._get_headers(use_org_token=use_org_token),
                timeout=self.api_timeout
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
                self._set_cache(cache_key, result, self.project_ttl)
                return result
        except Exception as e:
            print(f"Error fetching project details: {e}", file=sys.stderr)
        
        return None
    
    def get_repo_milestones(self, owner: str, repo: str) -> List[Dict[str, Any]]:
        """Get milestones for a GitHub repository with caching."""
        cache_key = f"milestones:{owner}:{repo}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached
        
        if not self.github_token:
            return []
        
        try:
            import requests  # type: ignore[import-not-found]
            url = f"{self.api_base}/repos/{owner}/{repo}/milestones"
            response = requests.get(
                url,
                headers=self._get_headers(),
                params={'state': 'all', 'per_page': 100},
                timeout=self.api_timeout
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
                self._set_cache(cache_key, result, self.milestone_ttl)
                return result
        except Exception as e:
            print(f"Error fetching milestones: {e}", file=sys.stderr)
        
        return []
    
    def get_project_items_with_fields(self, owner: str, project_number: int, limit: int = 100, owner_type: str = 'user') -> List[Dict[str, Any]]:
        """Get project items with full field data (status, priority, etc.) with caching (Phase 3: org support)."""
        # Normalize owner_type
        if owner_type not in ['user', 'org']:
            owner_type = 'user'
        
        cache_key = f"project_items_full:{owner_type}:{owner}:{project_number}:{limit}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached
        
        # Try gh CLI for detailed field information (works for both user and org projects)
        try:
            result = subprocess.run(
                ['gh', 'project', 'item-list', str(project_number), '--owner', owner, '--format', 'json', '--limit', str(limit)],
                capture_output=True, text=True,
                timeout=self.api_timeout, shell=False
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
                self._set_cache(cache_key, items, self.items_ttl)
                return items
        except Exception as e:
            print(f"Error fetching project items via gh CLI: {e}", file=sys.stderr)
        
        # Fallback to basic items
        basic_items = self.get_project_items(owner, project_number, limit)
        self._set_cache(cache_key, basic_items, self.items_ttl)
        return basic_items
    
    def get_project_timeline(self, owner: str, project_number: int, days: int = 30, owner_type: str = 'user') -> List[Dict[str, Any]]:
        """Generate timeline of project activity combining items and updates (Phase 3: org support)."""
        timeline = []
        
        # Get project items
        items = self.get_project_items_with_fields(owner, project_number, limit=100, owner_type=owner_type)
        
        # Add items to timeline
        import time
        from datetime import datetime, timedelta
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
            except Exception as e:
                print(f"Error parsing item timestamp: {e}", file=sys.stderr)
                continue
        
        # Sort by timestamp descending
        timeline.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return timeline[:50]  # Limit to 50 events


# Initialize GitHub Projects integration (will be set after db init)
github_projects: Optional[GitHubProjectsIntegration] = None


@server.list_resources()
async def list_resources() -> List[Resource]:
    """List available resources."""
    from pydantic_core import Url
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
            uri=Url("memory://projects/{project_number}/timeline"),  # type: ignore[arg-type]
            name="Project Activity Timeline (Phase 2 & 3)",
            description="Chronological timeline of journal entries and GitHub Project activity for a specific project. Supports: memory://projects/{number}/timeline or memory://projects/{owner}/{owner_type}/{number}/timeline",
            mimeType="text/markdown"
        )
    ]


@server.read_resource()
async def read_resource(uri: AnyUrl) -> str:
    """Read a specific resource."""
    # Convert URI to string (AnyUrl is always a valid URL object)
    uri_str = str(uri).strip()

    if uri_str == "memory://recent":
        try:
            def get_recent_entries():
                with db.get_connection() as conn:
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
            entries = await loop.run_in_executor(thread_pool, get_recent_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            raise

    elif uri_str == "memory://significant":
        try:
            def get_significant_entries():
                with db.get_connection() as conn:
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
            entries = await loop.run_in_executor(thread_pool, get_significant_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            raise

    elif uri_str == "memory://graph/recent":
        try:
            def get_graph():
                with db.get_connection() as conn:
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
            entries, relationships = await loop.run_in_executor(thread_pool, get_graph)

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

    elif uri_str.startswith("memory://projects/") and "/timeline" in uri_str:
        # Phase 2 - Issue #16: Project Timeline Resource (Phase 3: org support)
        try:
            # Extract parameters from URI
            # Supports: memory://projects/1/timeline or memory://projects/my-company/org/1/timeline
            parts = uri_str.split("/")
            
            # Determine format
            if len(parts) == 5:  # memory://projects/{number}/timeline
                project_number = int(parts[3])
                owner = None
                owner_type = 'user'
            elif len(parts) == 7:  # memory://projects/{owner}/{owner_type}/{number}/timeline
                owner = parts[3]
                owner_type = parts[4] if parts[4] in ['user', 'org'] else 'user'
                project_number = int(parts[5])
            else:
                raise ValueError(f"Invalid URI format. Expected: memory://projects/{{number}}/timeline or memory://projects/{{owner}}/{{owner_type}}/{{number}}/timeline")

            def get_timeline_data():
                with db.get_connection() as conn:
                    # Get journal entries for this project (last 30 days)
                    from datetime import datetime, timedelta
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
            entries = await loop.run_in_executor(thread_pool, get_timeline_data)

            # Get GitHub project timeline if available (Phase 3: use owner param if provided)
            project_context = await db.get_project_context()
            if not owner and 'repo_path' in project_context:
                owner = github_projects._extract_repo_owner_from_remote(project_context['repo_path'])
                if owner:
                    owner_type = github_projects.detect_owner_type(owner)

            github_timeline = []
            if owner:
                github_timeline = github_projects.get_project_timeline(owner, project_number, days=30, owner_type=owner_type)

            # Combine timelines
            combined = []
            
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
            timeline = f"# Project #{project_number} Activity Timeline\n\n"
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

    else:
        raise ValueError(f"Unknown resource: {uri_str}")


@server.list_tools()
async def list_tools() -> List[Tool]:
    """List available tools."""
    return [
        Tool(
            name="create_entry",
            description="Create a new journal entry with context and tags (Phase 3: org project support)",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"},
                    "is_personal": {"type": "boolean", "default": True},
                    "entry_type": {"type": "string", "default": "personal_reflection"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "significance_type": {"type": "string"},
                    "auto_context": {"type": "boolean", "default": True},
                    "project_number": {"type": "integer", "description": "GitHub Project number (optional)"},
                    "project_item_id": {"type": "integer", "description": "GitHub Project item ID (optional)"},
                    "github_project_url": {"type": "string", "description": "GitHub Project URL (optional)"},
                    "project_owner": {"type": "string", "description": "GitHub Project owner (username or org name) - optional, auto-detected from context"},
                    "project_owner_type": {"type": "string", "enum": ["user", "org"], "description": "Project owner type (user or org) - optional, auto-detected"}
                },
                "required": ["content"]
            }
        ),
        Tool(
            name="search_entries",
            description="Search journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "is_personal": {"type": "boolean"},
                    "limit": {"type": "integer", "default": 10},
                    "project_number": {"type": "integer", "description": "Filter by GitHub Project number (optional)"}
                }
            }
        ),
        Tool(
            name="get_recent_entries",
            description="Get recent journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 5},
                    "is_personal": {"type": "boolean"}
                }
            }
        ),
        Tool(
            name="list_tags",
            description="List all available tags",
            inputSchema={"type": "object", "properties": {}}
        ),
        Tool(
            name="test_simple",
            description="Simple test tool that just returns a message",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "default": "Hello"}
                }
            }
        ),
        Tool(
            name="create_entry_minimal",
            description="Minimal entry creation without context or tags",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"},
                    "project_number": {"type": "integer", "description": "GitHub Project number (optional)"},
                    "project_item_id": {"type": "integer", "description": "GitHub Project item ID (optional)"},
                    "github_project_url": {"type": "string", "description": "GitHub Project URL (optional)"}
                },
                "required": ["content"]
            }
        ),
        Tool(
            name="semantic_search",
            description="Perform semantic/vector search on journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query for semantic similarity"},
                    "limit": {"type": "integer", "default": 10, "description": "Maximum number of results"},
                    "similarity_threshold": {
                        "type": "number", "default": 0.3,
                        "description": "Minimum similarity score (0.0-1.0)"
                    },
                    "is_personal": {"type": "boolean", "description": "Filter by personal entries"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="update_entry",
            description="Update an existing journal entry",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "ID of the entry to update"},
                    "content": {"type": "string", "description": "New content for the entry"},
                    "entry_type": {"type": "string", "description": "Update entry type"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Replace tags"},
                    "is_personal": {"type": "boolean", "description": "Update personal flag"}
                },
                "required": ["entry_id"]
            }
        ),
        Tool(
            name="delete_entry",
            description="Delete a journal entry (soft delete with timestamp)",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "ID of the entry to delete"},
                    "permanent": {"type": "boolean", "default": False, "description": "Permanently delete (true) or soft delete (false)"}
                },
                "required": ["entry_id"]
            }
        ),
        Tool(
            name="get_entry_by_id",
            description="Get a specific journal entry by ID with full details",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "ID of the entry to retrieve"},
                    "include_relationships": {"type": "boolean", "default": True, "description": "Include related entries"}
                },
                "required": ["entry_id"]
            }
        ),
        Tool(
            name="link_entries",
            description="Create a relationship between two journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "from_entry_id": {"type": "integer", "description": "Source entry ID"},
                    "to_entry_id": {"type": "integer", "description": "Target entry ID"},
                    "relationship_type": {
                        "type": "string", 
                        "description": "Type of relationship (evolves_from, references, implements, clarifies, response_to)",
                        "default": "references"
                    },
                    "description": {"type": "string", "description": "Optional description of the relationship"}
                },
                "required": ["from_entry_id", "to_entry_id"]
            }
        ),
        Tool(
            name="search_by_date_range",
            description="Search journal entries within a date range",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "is_personal": {"type": "boolean", "description": "Filter by personal entries"},
                    "entry_type": {"type": "string", "description": "Filter by entry type"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter by tags"},
                    "project_number": {"type": "integer", "description": "Filter by GitHub Project number (optional)"}
                },
                "required": ["start_date", "end_date"]
            }
        ),
        Tool(
            name="get_statistics",
            description="Get journal statistics and analytics (Phase 2: includes project breakdown)",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "group_by": {
                        "type": "string", 
                        "description": "Group statistics by period (day, week, month)",
                        "default": "week"
                    },
                    "project_breakdown": {
                        "type": "boolean",
                        "description": "Include breakdown by GitHub Project number (Phase 2)",
                        "default": False
                    }
                }
            }
        ),
        Tool(
            name="export_entries",
            description="Export journal entries to JSON or Markdown format",
            inputSchema={
                "type": "object",
                "properties": {
                    "format": {
                        "type": "string", 
                        "description": "Export format (json or markdown)",
                        "default": "json"
                    },
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter by tags"},
                    "entry_types": {"type": "array", "items": {"type": "string"}, "description": "Filter by entry types"}
                }
            }
        ),
        Tool(
            name="visualize_relationships",
            description="Generate a Mermaid diagram visualization of entry relationships",
            inputSchema={
                "type": "object",
                "properties": {
                    "entry_id": {"type": "integer", "description": "Specific entry ID to visualize (shows connected entries)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter entries by tags"},
                    "depth": {
                        "type": "integer", 
                        "description": "Relationship traversal depth (1-3)",
                        "default": 2,
                        "minimum": 1,
                        "maximum": 3
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of entries to include",
                        "default": 20
                    }
                }
            }
        ),
        Tool(
            name="get_cross_project_insights",
            description="Analyze patterns across all GitHub Projects tracked in journal entries (Phase 2)",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "min_entries": {
                        "type": "integer",
                        "description": "Minimum entries to include project",
                        "default": 3
                    }
                }
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle tool calls."""

    if name == "create_entry":
        content = arguments["content"]
        is_personal = arguments.get("is_personal", True)
        entry_type = arguments.get("entry_type", "personal_reflection")
        tags = arguments.get("tags", [])
        significance_type: Optional[str] = arguments.get("significance_type")
        auto_context = arguments.get("auto_context", True)
        
        # GitHub Projects parameters (Phase 1 - Issue #15, Phase 3 - Issue #17)
        project_number = arguments.get("project_number")
        project_item_id = arguments.get("project_item_id")
        github_project_url = arguments.get("github_project_url")
        project_owner = arguments.get("project_owner")  # Phase 3
        project_owner_type = arguments.get("project_owner_type")  # Phase 3

        # Validate input for security
        try:
            db._validate_input(content, entry_type, tags, significance_type)
        except ValueError as e:
            return [types.TextContent(
                type="text",
                text=f"❌ Input validation failed: {str(e)}"
            )]

        project_context = None
        context_data = None
        if auto_context:
            context_data = await db.get_project_context()
            project_context = json.dumps(context_data)
            
            # Auto-populate project info from context if not explicitly set (Phase 3: org support)
            if not project_number and context_data and 'github_projects' in context_data:
                github_projects_data = context_data['github_projects']
                # Phase 3: Handle new structure with user_projects and org_projects
                if isinstance(github_projects_data, dict):
                    # Try org_projects first (prioritize for org repos)
                    projects_list = None
                    if 'org_projects' in github_projects_data and github_projects_data['org_projects']:
                        projects_list = github_projects_data['org_projects']
                        if not project_owner_type:
                            project_owner_type = 'org'
                    elif 'user_projects' in github_projects_data and github_projects_data['user_projects']:
                        projects_list = github_projects_data['user_projects']
                        if not project_owner_type:
                            project_owner_type = 'user'
                    # Backward compatibility: old Phase 1 structure
                    elif 'github_projects' in github_projects_data:
                        projects_list = github_projects_data['github_projects']
                    
                    if projects_list and len(projects_list) > 0:
                        # Use the first (most recent) project
                        first_project = projects_list[0]
                        if not project_number and 'number' in first_project:
                            project_number = first_project['number']
                        if not github_project_url and 'url' in first_project:
                            github_project_url = first_project['url']
                        if not project_owner and 'owner' in first_project:
                            project_owner = first_project['owner']
                        # Detect owner_type from project if not set
                        if not project_owner_type and 'source' in first_project:
                            project_owner_type = first_project['source']

        tag_ids = []
        if tags:
            # Run tag creation in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            tag_ids = await loop.run_in_executor(thread_pool, db.auto_create_tags, tags)

        # Run database operations in thread pool to avoid blocking event loop
        def create_entry_in_db():
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, is_personal, project_context, related_patterns,
                        project_number, project_item_id, github_project_url
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (entry_type, content, is_personal, project_context, ','.join(tags),
                      project_number, project_item_id, github_project_url))

                entry_id = cursor.lastrowid
                if entry_id is None:
                    raise RuntimeError("Failed to get entry ID after insert")

                for tag_id in tag_ids:
                    conn.execute(
                        "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                        (entry_id, tag_id)
                    )
                    conn.execute(
                        "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?",
                        (tag_id,)
                    )

                if significance_type:
                    conn.execute("""
                        INSERT INTO significant_entries (
                            entry_id, significance_type, significance_rating
                        ) VALUES (?, ?, 0.8)
                    """, (entry_id, significance_type))

                conn.commit()  # CRITICAL FIX: Missing commit was causing hangs!
                return entry_id

        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        result_entry_id: int = await loop.run_in_executor(thread_pool, create_entry_in_db)

        # Generate and store embedding for semantic search (if available)
        if vector_search and vector_search.initialized:
            try:
                await vector_search.add_entry_embedding(result_entry_id, content)
            except Exception:
                pass  # Silently fail if embedding generation fails

        result = [types.TextContent(
            type="text",
            text=f"✅ Created journal entry #{result_entry_id}\n"
                 f"Type: {entry_type}\n"
                 f"Personal: {is_personal}\n"
                 f"Tags: {', '.join(tags) if tags else 'None'}"
        )]
        return result

    elif name == "search_entries":
        query = arguments.get("query")
        is_personal = arguments.get("is_personal")
        limit = arguments.get("limit", 10)
        project_number = arguments.get("project_number")

        if query:
            # Escape special FTS5 characters and properly quote the query
            # FTS5 special chars: + - " * ( ) : . AND OR NOT
            # If query contains special chars, wrap individual terms in quotes
            def escape_fts5_query(q: str) -> str:
                """Escape FTS5 special characters for safe querying."""
                # Check if query contains FTS5 operators or special chars
                special_chars = ['-', '+', '*', '(', ')', '"', '.', ':']
                has_special = any(char in q for char in special_chars)
                
                if has_special:
                    # For queries with special chars, we need to escape them within quotes
                    # Replace double quotes with escaped quotes
                    escaped = q.replace('"', '""')
                    # Wrap the entire query in quotes for literal matching
                    return f'"{escaped}"'
                else:
                    # No special chars, return as-is for natural FTS5 matching
                    return q
            
            escaped_query = escape_fts5_query(query)
            
            sql = """
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal, m.project_number,
                       snippet(memory_journal_fts, 0, '**', '**', '...', 20) AS snippet
                FROM memory_journal_fts
                JOIN memory_journal m ON memory_journal_fts.rowid = m.id
                WHERE memory_journal_fts MATCH ?
                AND m.deleted_at IS NULL
            """
            params = [escaped_query]
            
            if is_personal is not None:
                sql += " AND m.is_personal = ?"
                params.append(is_personal)
            
            if project_number is not None:
                sql += " AND m.project_number = ?"
                params.append(project_number)
        else:
            sql = """
                SELECT id, entry_type, content, timestamp, is_personal, project_number,
                       substr(content, 1, 100) || '...' AS snippet
                FROM memory_journal
                WHERE deleted_at IS NULL
            """
            params = []
            
            if is_personal is not None:
                sql += " AND is_personal = ?"
                params.append(is_personal)
            
            if project_number is not None:
                sql += " AND project_number = ?"
                params.append(project_number)

        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        with db.get_connection() as conn:
            cursor = conn.execute(sql, params)
            entries = [dict(row) for row in cursor.fetchall()]

        result = f"Found {len(entries)} entries:\n\n"
        for entry in entries:
            result += f"#{entry['id']} ({entry['entry_type']}) - {entry['timestamp']}\n"
            result += f"Personal: {bool(entry['is_personal'])}\n"
            result += f"Snippet: {entry['snippet']}\n\n"

        return [types.TextContent(type="text", text=result)]

    elif name == "get_recent_entries":
        limit = arguments.get("limit", 5)
        is_personal = arguments.get("is_personal")

        sql = "SELECT id, entry_type, content, timestamp, is_personal, project_context FROM memory_journal"
        params = []

        if is_personal is not None:
            sql += " WHERE is_personal = ?"
            params.append(is_personal)

        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        with db.get_connection() as conn:
            cursor = conn.execute(sql, params)
            entries = [dict(row) for row in cursor.fetchall()]

        result = f"Recent {len(entries)} entries:\n\n"
        for entry in entries:
            result += f"#{entry['id']} ({entry['entry_type']}) - {entry['timestamp']}\n"
            result += f"Personal: {bool(entry['is_personal'])}\n"
            content_preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
            result += f"Content: {content_preview}\n"

            # Add context if available
            if entry.get('project_context'):
                try:
                    context = json.loads(entry['project_context'])
                    if context.get('repo_name'):
                        result += f"Context: {context['repo_name']} ({context.get('branch', 'unknown branch')})\n"
                except Exception:
                    pass
            result += "\n"

        return [types.TextContent(type="text", text=result)]

    elif name == "list_tags":
        with db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT name, category, usage_count FROM tags ORDER BY usage_count DESC, name"
            )
            tags = [dict(row) for row in cursor.fetchall()]

        result = f"Available tags ({len(tags)}):\n\n"
        for tag in tags:
            result += f"• {tag['name']}"
            if tag['category']:
                result += f" ({tag['category']})"
            result += f" - used {tag['usage_count']} times\n"

        return [types.TextContent(type="text", text=result)]

    elif name == "test_simple":
        message = arguments.get("message", "Hello")
        return [types.TextContent(
            type="text",
            text=f"✅ Simple test successful! Message: {message}"
        )]

    elif name == "create_entry_minimal":
        content = arguments["content"]
        
        # GitHub Projects parameters (Phase 1 - Issue #15)
        project_number = arguments.get("project_number")
        project_item_id = arguments.get("project_item_id")
        github_project_url = arguments.get("github_project_url")

        # Just a simple database insert without any context or tag operations
        def minimal_db_insert():
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, is_personal,
                        project_number, project_item_id, github_project_url
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, ("test_entry", content, True, project_number, project_item_id, github_project_url))
                entry_id = cursor.lastrowid
                if entry_id is None:
                    raise RuntimeError("Failed to get entry ID after insert")
                conn.commit()
                return entry_id

        # Run in thread pool
        loop = asyncio.get_event_loop()
        entry_id: int = await loop.run_in_executor(thread_pool, minimal_db_insert)

        return [types.TextContent(
            type="text",
            text=f"✅ Minimal entry created #{entry_id}"
        )]

    elif name == "semantic_search":
        query = arguments.get("query")
        limit = arguments.get("limit", 10)
        similarity_threshold = arguments.get("similarity_threshold", 0.3)
        is_personal = arguments.get("is_personal")

        if not query:
            return [types.TextContent(
                type="text",
                text="❌ Query parameter is required for semantic search"
            )]

        if not vector_search:
            return [types.TextContent(
                type="text",
                text="❌ Vector search not available. Install dependencies: pip install sentence-transformers faiss-cpu"
            )]
        
        # Trigger lazy initialization on first use (await since it's now async)
        await vector_search._ensure_initialized()
        
        if not vector_search.initialized:
            return [types.TextContent(
                type="text",
                text="❌ Vector search initialization failed. Check server logs for details."
            )]

        try:
            # Perform semantic search
            search_results = await vector_search.semantic_search(query, limit, similarity_threshold)

            if not search_results:
                return [types.TextContent(
                    type="text",
                    text=f"🔍 No semantically similar entries found for: '{query}'"
                )]

            # Fetch entry details from database
            def get_semantic_entry_details():
                entry_ids = [result[0] for result in search_results]
                with sqlite3.connect(DB_PATH) as conn:
                    placeholders = ','.join(['?'] * len(entry_ids))
                    sql = f"""
                        SELECT id, entry_type, content, timestamp, is_personal
                        FROM memory_journal
                        WHERE id IN ({placeholders})
                    """
                    if is_personal is not None:
                        sql += " AND is_personal = ?"
                        entry_ids.append(is_personal)

                    cursor = conn.execute(sql, entry_ids)
                    entries = {}
                    for row in cursor.fetchall():
                        entries[row[0]] = {
                            'id': row[0],
                            'entry_type': row[1],
                            'content': row[2],
                            'timestamp': row[3],
                            'is_personal': bool(row[4])
                        }
                    return entries

            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_semantic_entry_details)

            # Format results
            result_text = f"🔍 **Semantic Search Results** for: '{query}'\n"
            result_text += f"Found {len(search_results)} semantically similar entries:\n\n"

            for entry_id, similarity_score in search_results:
                if entry_id in entries:
                    entry = entries[entry_id]
                    result_text += f"**Entry #{entry['id']}** (similarity: {similarity_score:.3f})\n"
                    result_text += f"Type: {entry['entry_type']} | Personal: {entry['is_personal']} | {entry['timestamp']}\n"

                    # Show content preview
                    content_preview = entry['content'][:200]
                    if len(entry['content']) > 200:
                        content_preview += "..."
                    result_text += f"Content: {content_preview}\n\n"

            return [types.TextContent(
                type="text",
                text=result_text
            )]

        except Exception as e:
            return [types.TextContent(
                type="text",
                text=f"❌ Error in semantic search: {str(e)}"
            )]

    elif name == "update_entry":
        entry_id = arguments.get("entry_id")  # type: ignore
        content = arguments.get("content")
        entry_type = arguments.get("entry_type")
        tags = arguments.get("tags")
        is_personal = arguments.get("is_personal")

        if not entry_id:
            return [types.TextContent(type="text", text="❌ Entry ID is required")]

        def update_entry_in_db():
            with db.get_connection() as conn:
                # Check if entry exists
                cursor = conn.execute("SELECT id FROM memory_journal WHERE id = ?", (entry_id,))
                if not cursor.fetchone():
                    return None

                # Build dynamic update query
                updates = []
                params = []
                
                if content is not None:
                    updates.append("content = ?")
                    params.append(content)
                
                if entry_type is not None:
                    updates.append("entry_type = ?")
                    params.append(entry_type)
                
                if is_personal is not None:
                    updates.append("is_personal = ?")
                    params.append(is_personal)

                if updates:
                    params.append(entry_id)
                    conn.execute(
                        f"UPDATE memory_journal SET {', '.join(updates)} WHERE id = ?",
                        params
                    )

                # Update tags if provided
                if tags is not None:
                    # Remove old tags
                    conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", (entry_id,))
                    
                    # Add new tags (using same connection to avoid locks)
                    for tag_name in tags:
                        tag_cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                        tag_row = tag_cursor.fetchone()
                        
                        if tag_row:
                            tag_id = tag_row[0]
                        else:
                            tag_cursor = conn.execute(
                                "INSERT INTO tags (name, usage_count) VALUES (?, 1)",
                                (tag_name,)
                            )
                            tag_id = tag_cursor.lastrowid
                        
                        conn.execute(
                            "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                            (entry_id, tag_id)
                        )
                        conn.execute(
                            "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?",
                            (tag_id,)
                        )

                conn.commit()
                return entry_id

        loop = asyncio.get_event_loop()
        result_id = await loop.run_in_executor(thread_pool, update_entry_in_db)

        if result_id is None:
            return [types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")]

        # Update embedding if content changed and vector search is available
        if content and vector_search and vector_search.initialized:
            try:
                await vector_search.add_entry_embedding(entry_id, content)
            except Exception as e:
                print(f"Warning: Failed to update embedding: {e}")

        return [types.TextContent(
            type="text",
            text=f"✅ Updated entry #{entry_id}\n"
                 f"Updated fields: {', '.join(k for k, v in [('content', content), ('entry_type', entry_type), ('is_personal', is_personal), ('tags', tags)] if v is not None)}"
        )]

    elif name == "delete_entry":
        entry_id = arguments.get("entry_id")  # type: ignore
        permanent = arguments.get("permanent", False)

        if not entry_id:
            return [types.TextContent(type="text", text="❌ Entry ID is required")]

        def delete_entry_in_db():
            with db.get_connection() as conn:
                # Check if entry exists
                cursor = conn.execute("SELECT id FROM memory_journal WHERE id = ?", (entry_id,))
                if not cursor.fetchone():
                    return None

                if permanent:
                    # Permanent delete - remove from all tables
                    conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", (entry_id,))
                    conn.execute("DELETE FROM significant_entries WHERE entry_id = ?", (entry_id,))
                    conn.execute("DELETE FROM relationships WHERE from_entry_id = ? OR to_entry_id = ?", 
                               (entry_id, entry_id))
                    conn.execute("DELETE FROM memory_journal WHERE id = ?", (entry_id,))
                else:
                    # Soft delete - add deleted_at timestamp
                    conn.execute(
                        "UPDATE memory_journal SET deleted_at = ? WHERE id = ?",
                        (datetime.now().isoformat(), entry_id)
                    )

                conn.commit()
                return entry_id

        loop = asyncio.get_event_loop()
        result_id = await loop.run_in_executor(thread_pool, delete_entry_in_db)

        if result_id is None:
            return [types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")]

        delete_type = "permanently deleted" if permanent else "soft deleted"
        return [types.TextContent(
            type="text",
            text=f"✅ Entry #{entry_id} {delete_type}"
        )]

    elif name == "get_entry_by_id":
        entry_id = arguments.get("entry_id")  # type: ignore
        include_relationships = arguments.get("include_relationships", True)

        if not entry_id:
            return [types.TextContent(type="text", text="❌ Entry ID is required")]

        def get_entry_details():
            with db.get_connection() as conn:
                # Get main entry (including GitHub Projects columns - Phase 1 Issue #15)
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp, is_personal, project_context, related_patterns,
                           project_number, project_item_id, github_project_url
                    FROM memory_journal
                    WHERE id = ? AND deleted_at IS NULL
                """, (entry_id,))
                entry = cursor.fetchone()
                
                if not entry:
                    return None

                result = dict(entry)
                
                # Get tags
                cursor = conn.execute("""
                    SELECT t.name FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    WHERE et.entry_id = ?
                """, (entry_id,))
                result['tags'] = [row[0] for row in cursor.fetchall()]

                # Get significance
                cursor = conn.execute("""
                    SELECT significance_type, significance_rating
                    FROM significant_entries
                    WHERE entry_id = ?
                """, (entry_id,))
                sig = cursor.fetchone()
                if sig:
                    result['significance'] = dict(sig)

                # Get relationships if requested
                if include_relationships:
                    cursor = conn.execute("""
                        SELECT r.to_entry_id, r.relationship_type, r.description,
                               m.content, m.entry_type
                        FROM relationships r
                        JOIN memory_journal m ON r.to_entry_id = m.id
                        WHERE r.from_entry_id = ? AND m.deleted_at IS NULL
                    """, (entry_id,))
                    result['relationships_to'] = [dict(row) for row in cursor.fetchall()]

                    cursor = conn.execute("""
                        SELECT r.from_entry_id, r.relationship_type, r.description,
                               m.content, m.entry_type
                        FROM relationships r
                        JOIN memory_journal m ON r.from_entry_id = m.id
                        WHERE r.to_entry_id = ? AND m.deleted_at IS NULL
                    """, (entry_id,))
                    result['relationships_from'] = [dict(row) for row in cursor.fetchall()]

                return result

        loop = asyncio.get_event_loop()
        entry = await loop.run_in_executor(thread_pool, get_entry_details)

        if entry is None:
            return [types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")]

        # Format output
        output = f"**Entry #{entry['id']}** ({entry['entry_type']})\n"
        output += f"Timestamp: {entry['timestamp']}\n"
        output += f"Personal: {bool(entry['is_personal'])}\n\n"
        output += f"**Content:**\n{entry['content']}\n\n"
        
        if entry['tags']:
            output += f"**Tags:** {', '.join(entry['tags'])}\n\n"

        if entry.get('significance'):
            output += f"**Significance:** {entry['significance']['significance_type']} (rating: {entry['significance']['significance_rating']})\n\n"

        if entry.get('project_context'):
            try:
                ctx = json.loads(entry['project_context'])
                if ctx.get('repo_name'):
                    output += f"**Context:** {ctx['repo_name']} ({ctx.get('branch', 'unknown')})\n\n"
            except:
                pass

        if include_relationships and (entry.get('relationships_to') or entry.get('relationships_from')):
            output += "**Relationships:**\n"
            for rel in entry.get('relationships_to', []):
                output += f"  → {rel['relationship_type']}: Entry #{rel['to_entry_id']} ({rel['entry_type'][:50]}...)\n"
            for rel in entry.get('relationships_from', []):
                output += f"  ← {rel['relationship_type']}: Entry #{rel['from_entry_id']} ({rel['entry_type'][:50]}...)\n"

        return [types.TextContent(type="text", text=output)]

    elif name == "link_entries":
        from_entry_id = arguments.get("from_entry_id")
        to_entry_id = arguments.get("to_entry_id")
        relationship_type = arguments.get("relationship_type", "references")
        description = arguments.get("description")

        if not from_entry_id or not to_entry_id:
            return [types.TextContent(type="text", text="❌ Both from_entry_id and to_entry_id are required")]

        if from_entry_id == to_entry_id:
            return [types.TextContent(type="text", text="❌ Cannot link an entry to itself")]

        def create_relationship():
            with db.get_connection() as conn:
                # Verify both entries exist
                cursor = conn.execute(
                    "SELECT COUNT(*) FROM memory_journal WHERE id IN (?, ?) AND deleted_at IS NULL",
                    (from_entry_id, to_entry_id)
                )
                if cursor.fetchone()[0] != 2:
                    return None

                # Check if relationship already exists
                cursor = conn.execute("""
                    SELECT id FROM relationships 
                    WHERE from_entry_id = ? AND to_entry_id = ? AND relationship_type = ?
                """, (from_entry_id, to_entry_id, relationship_type))
                
                if cursor.fetchone():
                    return "exists"

                # Create relationship
                conn.execute("""
                    INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type, description)
                    VALUES (?, ?, ?, ?)
                """, (from_entry_id, to_entry_id, relationship_type, description))
                
                conn.commit()
                return "created"

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(thread_pool, create_relationship)

        if result is None:
            return [types.TextContent(type="text", text="❌ One or both entries not found")]
        elif result == "exists":
            return [types.TextContent(
                type="text",
                text=f"ℹ️  Relationship already exists: Entry #{from_entry_id} -{relationship_type}-> Entry #{to_entry_id}"
            )]
        else:
            return [types.TextContent(
                type="text",
                text=f"✅ Created relationship: Entry #{from_entry_id} -{relationship_type}-> Entry #{to_entry_id}"
            )]

    elif name == "search_by_date_range":
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")
        is_personal = arguments.get("is_personal")
        entry_type = arguments.get("entry_type")
        tags = arguments.get("tags", [])
        project_number = arguments.get("project_number")

        if not start_date or not end_date:
            return [types.TextContent(type="text", text="❌ Both start_date and end_date are required (YYYY-MM-DD)")]

        def search_entries():
            with db.get_connection() as conn:
                sql = """
                    SELECT DISTINCT m.id, m.entry_type, m.content, m.timestamp, m.is_personal, m.project_number
                    FROM memory_journal m
                    WHERE m.deleted_at IS NULL
                    AND DATE(m.timestamp) >= DATE(?)
                    AND DATE(m.timestamp) <= DATE(?)
                """
                params = [start_date, end_date]

                if is_personal is not None:
                    sql += " AND m.is_personal = ?"
                    params.append(is_personal)

                if entry_type:
                    sql += " AND m.entry_type = ?"
                    params.append(entry_type)
                
                if project_number is not None:
                    sql += " AND m.project_number = ?"
                    params.append(project_number)

                if tags:
                    sql += """ AND m.id IN (
                        SELECT et.entry_id FROM entry_tags et
                        JOIN tags t ON et.tag_id = t.id
                        WHERE t.name IN ({})
                    )""".format(','.join(['?'] * len(tags)))
                    params.extend(tags)

                sql += " ORDER BY m.timestamp DESC"

                cursor = conn.execute(sql, params)
                return [dict(row) for row in cursor.fetchall()]

        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, search_entries)

        if not entries:
            return [types.TextContent(
                type="text",
                text=f"🔍 No entries found between {start_date} and {end_date}"
            )]

        result = f"📅 Found {len(entries)} entries between {start_date} and {end_date}:\n\n"
        for entry in entries:
            result += f"**Entry #{entry['id']}** ({entry['entry_type']}) - {entry['timestamp']}\n"
            preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
            result += f"{preview}\n\n"

        return [types.TextContent(type="text", text=result)]

    elif name == "get_statistics":
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")
        group_by = arguments.get("group_by", "week")
        project_breakdown = arguments.get("project_breakdown", False)

        def calculate_stats():
            with db.get_connection() as conn:
                stats = {}

                # Base WHERE clause
                where = "WHERE deleted_at IS NULL"
                params = []
                
                if start_date:
                    where += " AND DATE(timestamp) >= DATE(?)"
                    params.append(start_date)
                if end_date:
                    where += " AND DATE(timestamp) <= DATE(?)"
                    params.append(end_date)

                # Total entries
                cursor = conn.execute(f"SELECT COUNT(*) FROM memory_journal {where}", params)
                stats['total_entries'] = cursor.fetchone()[0]

                # Entries by type
                cursor = conn.execute(f"""
                    SELECT entry_type, COUNT(*) as count
                    FROM memory_journal {where}
                    GROUP BY entry_type
                    ORDER BY count DESC
                """, params)
                stats['by_type'] = {row[0]: row[1] for row in cursor.fetchall()}

                # Personal vs Project
                cursor = conn.execute(f"""
                    SELECT is_personal, COUNT(*) as count
                    FROM memory_journal {where}
                    GROUP BY is_personal
                """, params)
                personal_stats = {bool(row[0]): row[1] for row in cursor.fetchall()}
                stats['personal_entries'] = personal_stats.get(True, 0)
                stats['project_entries'] = personal_stats.get(False, 0)

                # Top tags
                cursor = conn.execute(f"""
                    SELECT t.name, COUNT(*) as count
                    FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    JOIN memory_journal m ON et.entry_id = m.id
                    {where}
                    GROUP BY t.name
                    ORDER BY count DESC
                    LIMIT 10
                """, params)
                stats['top_tags'] = {row[0]: row[1] for row in cursor.fetchall()}

                # Significant entries
                cursor = conn.execute(f"""
                    SELECT se.significance_type, COUNT(*) as count
                    FROM significant_entries se
                    JOIN memory_journal m ON se.entry_id = m.id
                    {where}
                    GROUP BY se.significance_type
                """, params)
                stats['significant_entries'] = {row[0]: row[1] for row in cursor.fetchall()}

                # Activity by period
                if group_by == "day":
                    date_format = "%Y-%m-%d"
                elif group_by == "month":
                    date_format = "%Y-%m"
                else:  # week
                    date_format = "%Y-W%W"

                cursor = conn.execute(f"""
                    SELECT strftime('{date_format}', timestamp) as period, COUNT(*) as count
                    FROM memory_journal {where}
                    GROUP BY period
                    ORDER BY period
                """, params)
                stats['activity_by_period'] = {row[0]: row[1] for row in cursor.fetchall()}

                # Phase 2 - Project Breakdown
                if project_breakdown:
                    cursor = conn.execute(f"""
                        SELECT project_number, COUNT(*) as count
                        FROM memory_journal
                        {where} AND project_number IS NOT NULL
                        GROUP BY project_number
                        ORDER BY count DESC
                    """, params)
                    stats['by_project'] = {f"Project #{row[0]}": row[1] for row in cursor.fetchall()}
                    
                    # Active days per project
                    cursor = conn.execute(f"""
                        SELECT project_number, COUNT(DISTINCT DATE(timestamp)) as active_days
                        FROM memory_journal
                        {where} AND project_number IS NOT NULL
                        GROUP BY project_number
                        ORDER BY active_days DESC
                    """, params)
                    stats['project_active_days'] = {f"Project #{row[0]}": row[1] for row in cursor.fetchall()}

                return stats

        loop = asyncio.get_event_loop()
        stats = await loop.run_in_executor(thread_pool, calculate_stats)

        # Format output
        output = "📊 **Journal Statistics**\n\n"
        output += f"**Total Entries:** {stats['total_entries']}\n"
        output += f"**Personal:** {stats['personal_entries']} | **Project:** {stats['project_entries']}\n\n"

        if stats['by_type']:
            output += "**Entries by Type:**\n"
            for entry_type, count in stats['by_type'].items():
                output += f"  • {entry_type}: {count}\n"
            output += "\n"

        if stats['top_tags']:
            output += "**Top Tags:**\n"
            for tag, count in list(stats['top_tags'].items())[:10]:
                output += f"  • {tag}: {count}\n"
            output += "\n"

        if stats['significant_entries']:
            output += "**Significant Entries:**\n"
            for sig_type, count in stats['significant_entries'].items():
                output += f"  • {sig_type}: {count}\n"
            output += "\n"

        if stats['activity_by_period']:
            output += f"**Activity by {group_by.capitalize()}:**\n"
            for period, count in list(stats['activity_by_period'].items())[-10:]:
                output += f"  • {period}: {count} entries\n"

        # Phase 2 - Project Breakdown
        if project_breakdown and 'by_project' in stats and stats['by_project']:
            output += "\n**📦 Project Breakdown (Phase 2):**\n"
            for project, count in stats['by_project'].items():
                active_days = stats['project_active_days'].get(project, 0)
                output += f"  • {project}: {count} entries ({active_days} active days)\n"
            output += "\n"

        return [types.TextContent(type="text", text=output)]

    elif name == "export_entries":
        format_type = arguments.get("format", "json")
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")
        tags = arguments.get("tags", [])
        entry_types = arguments.get("entry_types", [])

        def get_entries_for_export():
            with db.get_connection() as conn:
                sql = """
                    SELECT DISTINCT m.id, m.entry_type, m.content, m.timestamp, 
                           m.is_personal, m.project_context, m.related_patterns
                    FROM memory_journal m
                    WHERE m.deleted_at IS NULL
                """
                params = []

                if start_date:
                    sql += " AND DATE(m.timestamp) >= DATE(?)"
                    params.append(start_date)
                if end_date:
                    sql += " AND DATE(m.timestamp) <= DATE(?)"
                    params.append(end_date)

                if tags:
                    sql += """ AND m.id IN (
                        SELECT et.entry_id FROM entry_tags et
                        JOIN tags t ON et.tag_id = t.id
                        WHERE t.name IN ({})
                    )""".format(','.join(['?'] * len(tags)))
                    params.extend(tags)

                if entry_types:
                    sql += " AND m.entry_type IN ({})".format(','.join(['?'] * len(entry_types)))
                    params.extend(entry_types)

                sql += " ORDER BY m.timestamp"

                cursor = conn.execute(sql, params)
                entries = []
                
                for row in cursor.fetchall():
                    entry = dict(row)
                    entry_id = entry['id']
                    
                    # Get tags for this entry
                    tag_cursor = conn.execute("""
                        SELECT t.name FROM tags t
                        JOIN entry_tags et ON t.id = et.tag_id
                        WHERE et.entry_id = ?
                    """, (entry_id,))
                    entry['tags'] = [t[0] for t in tag_cursor.fetchall()]
                    
                    entries.append(entry)

                return entries

        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, get_entries_for_export)

        if not entries:
            return [types.TextContent(type="text", text="📦 No entries found matching the criteria")]

        if format_type == "markdown":
            output = f"# Journal Export\n\n"
            output += f"Exported {len(entries)} entries\n"
            if start_date or end_date:
                output += f"Date range: {start_date or 'beginning'} to {end_date or 'end'}\n"
            output += f"\n---\n\n"

            for entry in entries:
                output += f"## Entry #{entry['id']} - {entry['timestamp']}\n\n"
                output += f"**Type:** {entry['entry_type']}  \n"
                output += f"**Personal:** {bool(entry['is_personal'])}  \n"
                if entry['tags']:
                    output += f"**Tags:** {', '.join(entry['tags'])}  \n"
                output += f"\n{entry['content']}\n\n---\n\n"
        else:  # json
            output = json.dumps(entries, indent=2)

        # Format output preview
        truncated_suffix = '...\n[truncated]' if len(output) > 2000 else ''
        output_preview = output[:2000] + truncated_suffix
        
        return [types.TextContent(
            type="text",
            text=f"📦 **Export Complete**\n\n"
                 f"Format: {format_type.upper()}\n"
                 f"Entries: {len(entries)}\n\n"
                 f"```{format_type}\n{output_preview}\n```"
        )]

    elif name == "visualize_relationships":
        entry_id = arguments.get("entry_id")  # type: ignore
        tags = arguments.get("tags", [])
        depth = arguments.get("depth", 2)
        limit = arguments.get("limit", 20)

        def generate_graph():
            with db.get_connection() as conn:
                # Build the query to get entries and their relationships
                entries_query = """
                    SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                    FROM memory_journal mj
                    WHERE mj.deleted_at IS NULL
                """
                params: List[Any] = []

                if entry_id:
                    # Get the specified entry and all connected entries up to depth
                    entries_query = f"""
                        WITH RECURSIVE connected_entries(id, distance) AS (
                            SELECT id, 0 FROM memory_journal WHERE id = ? AND deleted_at IS NULL
                            UNION
                            SELECT DISTINCT 
                                CASE 
                                    WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                                    ELSE r.from_entry_id
                                END,
                                ce.distance + 1
                            FROM connected_entries ce
                            JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
                            WHERE ce.distance < ?
                        )
                        SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                        FROM memory_journal mj
                        JOIN connected_entries ce ON mj.id = ce.id
                        WHERE mj.deleted_at IS NULL
                        LIMIT ?
                    """
                    params = [entry_id, depth, limit]
                elif tags:
                    # Filter by tags
                    placeholders = ','.join(['?' for _ in tags])
                    entries_query += f"""
                        AND mj.id IN (
                            SELECT et.entry_id FROM entry_tags et
                            JOIN tags t ON et.tag_id = t.id
                            WHERE t.name IN ({placeholders})
                        )
                        LIMIT ?
                    """
                    params = tags + [limit]
                else:
                    # Get recent entries with relationships
                    entries_query += """
                        AND mj.id IN (
                            SELECT DISTINCT from_entry_id FROM relationships
                            UNION
                            SELECT DISTINCT to_entry_id FROM relationships
                        )
                        ORDER BY mj.timestamp DESC
                        LIMIT ?
                    """
                    params = [limit]

                cursor = conn.execute(entries_query, params)
                entries = {row[0]: dict(row) for row in cursor.fetchall()}

                if not entries:
                    return None, None

                # Get all relationships between these entries
                entry_ids = list(entries.keys())
                placeholders = ','.join(['?' for _ in entry_ids])
                relationships_query = f"""
                    SELECT from_entry_id, to_entry_id, relationship_type
                    FROM relationships
                    WHERE from_entry_id IN ({placeholders})
                      AND to_entry_id IN ({placeholders})
                """
                cursor = conn.execute(relationships_query, entry_ids + entry_ids)
                relationships = cursor.fetchall()

                return entries, relationships

        loop = asyncio.get_event_loop()
        entries, relationships = await loop.run_in_executor(thread_pool, generate_graph)

        if not entries:
            return [types.TextContent(
                type="text",
                text="❌ No entries found with relationships matching your criteria"
            )]

        # Generate Mermaid diagram
        mermaid = "```mermaid\ngraph TD\n"
        
        # Add nodes with truncated content
        for entry_id_key, entry in entries.items():
            content_preview = entry['content'][:40].replace('\n', ' ')
            if len(entry['content']) > 40:
                content_preview += '...'
            # Escape special characters for Mermaid
            content_preview = content_preview.replace('"', "'").replace('[', '(').replace(']', ')')
            
            entry_type_short = entry['entry_type'][:20]
            node_label = f"#{entry_id_key}: {content_preview}<br/>{entry_type_short}"
            mermaid += f"    E{entry_id_key}[\"{node_label}\"]\n"

        mermaid += "\n"

        # Add relationships
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

        # Add styling
        mermaid += "\n"
        for entry_id_key, entry in entries.items():
            if entry['is_personal']:
                mermaid += f"    style E{entry_id_key} fill:#E3F2FD\n"
            else:
                mermaid += f"    style E{entry_id_key} fill:#FFF3E0\n"

        mermaid += "```"

        summary = f"🔗 **Relationship Graph**\n\n"
        summary += f"**Entries:** {len(entries)}\n"
        summary += f"**Relationships:** {len(relationships) if relationships else 0}\n"
        if entry_id:
            summary += f"**Root Entry:** #{entry_id}\n"
            summary += f"**Depth:** {depth}\n"
        summary += f"\n{mermaid}\n\n"
        summary += "**Legend:**\n"
        summary += "- Blue nodes: Personal entries\n"
        summary += "- Orange nodes: Project entries\n"
        summary += "- `-->` references / evolves_from | `==>` implements | `-.->` clarifies | `<-->` response_to"

        return [types.TextContent(type="text", text=summary)]

    elif name == "get_cross_project_insights":
        # Phase 2 - Issue #16: Cross-project insights
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")
        min_entries = arguments.get("min_entries", 3)

        def analyze_projects():
            with db.get_connection() as conn:
                # Base WHERE clause
                where = "WHERE deleted_at IS NULL AND project_number IS NOT NULL"
                params = []
                
                if start_date:
                    where += " AND DATE(timestamp) >= DATE(?)"
                    params.append(start_date)
                if end_date:
                    where += " AND DATE(timestamp) <= DATE(?)"
                    params.append(end_date)

                # Get active projects (ranked by entry count)
                cursor = conn.execute(f"""
                    SELECT project_number, COUNT(*) as entry_count,
                           MIN(DATE(timestamp)) as first_entry,
                           MAX(DATE(timestamp)) as last_entry,
                           COUNT(DISTINCT DATE(timestamp)) as active_days
                    FROM memory_journal {where}
                    GROUP BY project_number
                    HAVING entry_count >= ?
                    ORDER BY entry_count DESC
                """, params + [min_entries])
                projects = [dict(row) for row in cursor.fetchall()]

                # Get most productive day per project
                productivity = {}
                for proj in projects:
                    project_num = proj['project_number']
                    cursor = conn.execute(f"""
                        SELECT strftime('%A', timestamp) as day_of_week, COUNT(*) as count
                        FROM memory_journal
                        WHERE project_number = ? AND deleted_at IS NULL
                        GROUP BY day_of_week
                        ORDER BY count DESC
                        LIMIT 1
                    """, (project_num,))
                    result = cursor.fetchone()
                    if result:
                        productivity[project_num] = {'day': result[0], 'count': result[1]}

                # Get top tags per project
                project_tags = {}
                for proj in projects:
                    project_num = proj['project_number']
                    cursor = conn.execute(f"""
                        SELECT t.name, COUNT(*) as count
                        FROM tags t
                        JOIN entry_tags et ON t.id = et.tag_id
                        JOIN memory_journal m ON et.entry_id = m.id
                        WHERE m.project_number = ? AND m.deleted_at IS NULL
                        GROUP BY t.name
                        ORDER BY count DESC
                        LIMIT 5
                    """, (project_num,))
                    project_tags[project_num] = [dict(row) for row in cursor.fetchall()]

                # Identify low-activity projects (last entry > 7 days ago)
                from datetime import datetime, timedelta
                cutoff_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                cursor = conn.execute(f"""
                    SELECT project_number, MAX(DATE(timestamp)) as last_entry_date
                    FROM memory_journal
                    WHERE deleted_at IS NULL AND project_number IS NOT NULL
                    GROUP BY project_number
                    HAVING last_entry_date < ?
                """, (cutoff_date,))
                inactive_projects = [dict(row) for row in cursor.fetchall()]

                return {
                    'projects': projects,
                    'productivity': productivity,
                    'project_tags': project_tags,
                    'inactive_projects': inactive_projects
                }

        loop = asyncio.get_event_loop()
        insights = await loop.run_in_executor(thread_pool, analyze_projects)

        # Format output
        output = "📊 **Cross-Project Insights (Phase 2)**\n\n"
        
        if not insights['projects']:
            output += f"No projects found with at least {min_entries} entries.\n"
            return [types.TextContent(type="text", text=output)]

        output += f"**Active Projects:** {len(insights['projects'])}\n"
        if start_date or end_date:
            output += f"**Period:** {start_date or 'start'} to {end_date or 'now'}\n"
        output += "\n"

        # Project ranking
        output += "**Projects by Activity:**\n"
        for i, proj in enumerate(insights['projects'][:10], 1):
            proj_num = proj['project_number']
            output += f"{i}. **Project #{proj_num}**\n"
            output += f"   - Entries: {proj['entry_count']}\n"
            output += f"   - Active Days: {proj['active_days']}\n"
            output += f"   - Period: {proj['first_entry']} to {proj['last_entry']}\n"
            
            # Productivity info
            if proj_num in insights['productivity']:
                prod = insights['productivity'][proj_num]
                output += f"   - Most Productive: {prod['day']} ({prod['count']} entries)\n"
            
            # Top tags
            if proj_num in insights['project_tags'] and insights['project_tags'][proj_num]:
                tags = [f"{t['name']} ({t['count']})" for t in insights['project_tags'][proj_num][:3]]
                output += f"   - Top Tags: {', '.join(tags)}\n"
            
            output += "\n"

        # Time distribution summary
        total_entries = sum(p['entry_count'] for p in insights['projects'])
        output += "**Time Distribution:**\n"
        for proj in insights['projects'][:5]:
            percentage = (proj['entry_count'] / total_entries) * 100
            output += f"  • Project #{proj['project_number']}: {percentage:.1f}%\n"
        output += "\n"

        # Suggested focus areas
        if insights['inactive_projects']:
            output += "**⚠️ Suggested Focus Areas (>7 days since last entry):**\n"
            for proj in insights['inactive_projects'][:5]:
                output += f"  • Project #{proj['project_number']} - Last entry: {proj['last_entry_date']}\n"

        return [types.TextContent(type="text", text=output)]

    else:
        raise ValueError(f"Unknown tool: {name}")


@server.list_prompts()
async def list_prompts() -> List[Prompt]:
    """List available prompts."""
    return [
        Prompt(
            name="get-context-bundle",
            description="Get current project context as JSON",
            arguments=[
                PromptArgument(
                    name="include_git",
                    description="Include Git repository information",
                    required=False
                )
            ]
        ),
        Prompt(
            name="get-recent-entries",
            description="Get the last X journal entries",
            arguments=[
                PromptArgument(
                    name="count",
                    description="Number of recent entries to retrieve (default: 5)",
                    required=False
                ),
                PromptArgument(
                    name="personal_only",
                    description="Only show personal entries (true/false)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="analyze-period",
            description="Analyze journal entries over a specific time period for insights, patterns, and achievements",
            arguments=[
                PromptArgument(
                    name="start_date",
                    description="Start date for analysis (YYYY-MM-DD)",
                    required=True
                ),
                PromptArgument(
                    name="end_date",
                    description="End date for analysis (YYYY-MM-DD)",
                    required=True
                ),
                PromptArgument(
                    name="focus_area",
                    description="Optional focus area (e.g., 'technical', 'personal', 'productivity')",
                    required=False
                )
            ]
        ),
        Prompt(
            name="prepare-standup",
            description="Prepare daily standup summary from recent technical journal entries",
            arguments=[
                PromptArgument(
                    name="days_back",
                    description="Number of days to look back (default: 1)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="prepare-retro",
            description="Prepare sprint retrospective with achievements, learnings, and areas for improvement",
            arguments=[
                PromptArgument(
                    name="sprint_start",
                    description="Sprint start date (YYYY-MM-DD)",
                    required=True
                ),
                PromptArgument(
                    name="sprint_end",
                    description="Sprint end date (YYYY-MM-DD)",
                    required=True
                )
            ]
        ),
        Prompt(
            name="find-related",
            description="Find entries related to a specific entry using semantic similarity and tags",
            arguments=[
                PromptArgument(
                    name="entry_id",
                    description="Entry ID to find related entries for",
                    required=True
                ),
                PromptArgument(
                    name="similarity_threshold",
                    description="Minimum similarity score (0.0-1.0, default: 0.3)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="weekly-digest",
            description="Generate a formatted summary of journal entries for a specific week",
            arguments=[
                PromptArgument(
                    name="week_offset",
                    description="Week offset (0 = current week, -1 = last week, etc.)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="goal-tracker",
            description="Track progress on goals and milestones from journal entries",
            arguments=[
                PromptArgument(
                    name="project_name",
                    description="Optional project name to filter by",
                    required=False
                ),
                PromptArgument(
                    name="goal_type",
                    description="Type of goal (milestone, technical_breakthrough, etc.)",
                    required=False
                )
            ]
        ),
        Prompt(
            name="project-status-summary",
            description="Generate comprehensive GitHub Project status report (Phase 2 & 3: org support)",
            arguments=[
                PromptArgument(
                    name="project_number",
                    description="GitHub Project number",
                    required=True
                ),
                PromptArgument(
                    name="time_period",
                    description="Time period (week, sprint, month, default: week)",
                    required=False
                ),
                PromptArgument(
                    name="include_items",
                    description="Include project item status (true/false, default: true)",
                    required=False
                ),
                PromptArgument(
                    name="owner",
                    description="Phase 3: Project owner (username or org name) - optional, auto-detected from context",
                    required=False
                ),
                PromptArgument(
                    name="owner_type",
                    description="Phase 3: Project owner type (user or org) - optional, auto-detected",
                    required=False
                )
            ]
        ),
        Prompt(
            name="project-milestone-tracker",
            description="Track GitHub Project milestones with velocity analysis (Phase 2 & 3: org support)",
            arguments=[
                PromptArgument(
                    name="project_number",
                    description="GitHub Project number",
                    required=True
                ),
                PromptArgument(
                    name="milestone_name",
                    description="Optional milestone name to filter by",
                    required=False
                ),
                PromptArgument(
                    name="owner",
                    description="Phase 3: Project owner (username or org name) - optional, auto-detected from context",
                    required=False
                ),
                PromptArgument(
                    name="owner_type",
                    description="Phase 3: Project owner type (user or org) - optional, auto-detected",
                    required=False
                )
            ]
        )
    ]


@server.get_prompt()
async def get_prompt(name: str, arguments: Dict[str, str] | None) -> types.GetPromptResult:  # type: ignore[misc]
    """Handle prompt requests."""
    
    # Ensure arguments is not None
    if arguments is None:
        arguments = {}

    if name == "get-context-bundle":
        include_git = arguments.get("include_git", "true").lower() == "true"

        if include_git:
            # Get full context with Git info
            context = await db.get_project_context()
        else:
            # Get basic context without Git operations
            from datetime import datetime as dt_now
            context = {
                'cwd': os.getcwd(),
                'timestamp': dt_now.now().isoformat(),
                'git_disabled': 'Git operations skipped by request'
            }

        context_json = json.dumps(context, indent=2)

        return types.GetPromptResult(
            description="Current project context bundle",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=f"Here is the current project context bundle:\n\n```json\n"
                             f"{context_json}\n```\n\nThis includes repository information, "
                             f"current working directory, and timestamp. You can use this context "
                             f"to understand the current project state when creating journal entries."
                    )
                )
            ]
        )

    elif name == "get-recent-entries":
        count = int(arguments.get("count", "5"))
        personal_only = arguments.get("personal_only", "false").lower() == "true"

        # Get recent entries using existing database functionality
        def get_entries_sync():
            with db.get_connection() as conn:
                sql = "SELECT id, entry_type, content, timestamp, is_personal, project_context FROM memory_journal"
                params = []

                if personal_only:
                    sql += " WHERE is_personal = ?"
                    params.append(True)

                sql += " ORDER BY timestamp DESC LIMIT ?"
                params.append(count)

                cursor = conn.execute(sql, params)
                entries = []
                for row in cursor.fetchall():
                    entry = {
                        'id': row[0],
                        'entry_type': row[1],
                        'content': row[2],
                        'timestamp': row[3],
                        'is_personal': bool(row[4]),
                        'project_context': json.loads(row[5]) if row[5] else None
                    }
                    entries.append(entry)
                return entries

        # Run in thread pool
        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, get_entries_sync)

        # Format entries for display
        entries_text = f"Here are the {len(entries)} most recent journal entries"
        if personal_only:
            entries_text += " (personal only)"
        entries_text += ":\n\n"

        for i, entry in enumerate(entries, 1):
            entries_text += f"**Entry #{entry['id']}** ({entry['entry_type']}) - {entry['timestamp']}\n"
            entries_text += f"Personal: {entry['is_personal']}\n"
            entries_text += f"Content: {entry['content'][:200]}"
            if len(entry['content']) > 200:
                entries_text += "..."
            entries_text += "\n"

            if entry['project_context']:
                ctx = entry['project_context']
                if 'repo_name' in ctx:
                    entries_text += f"Context: {ctx['repo_name']} ({ctx.get('branch', 'unknown branch')})\n"
            entries_text += "\n"

        return types.GetPromptResult(
            description=f"Last {count} journal entries",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=entries_text
                    )
                )
            ]
        )

    elif name == "analyze-period":
        start_date = arguments.get("start_date")
        end_date = arguments.get("end_date")
        focus_area = arguments.get("focus_area", "all")

        def get_period_data():
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
                    FROM memory_journal m
                    WHERE m.deleted_at IS NULL
                    AND DATE(m.timestamp) >= DATE(?)
                    AND DATE(m.timestamp) <= DATE(?)
                    ORDER BY m.timestamp
                """, (start_date, end_date))
                
                entries = [dict(row) for row in cursor.fetchall()]
                
                # Get tags for entries
                for entry in entries:
                    tag_cursor = conn.execute("""
                        SELECT t.name FROM tags t
                        JOIN entry_tags et ON t.id = et.tag_id
                        WHERE et.entry_id = ?
                    """, (entry['id'],))
                    entry['tags'] = [t[0] for t in tag_cursor.fetchall()]
                
                # Get significant entries
                cursor = conn.execute("""
                    SELECT se.entry_id, se.significance_type
                    FROM significant_entries se
                    JOIN memory_journal m ON se.entry_id = m.id
                    WHERE DATE(m.timestamp) >= DATE(?)
                    AND DATE(m.timestamp) <= DATE(?)
                    AND m.deleted_at IS NULL
                """, (start_date, end_date))
                
                significant = {row[0]: row[1] for row in cursor.fetchall()}
                
                return entries, significant

        loop = asyncio.get_event_loop()
        entries, significant = await loop.run_in_executor(thread_pool, get_period_data)

        # Analyze the data
        analysis = f"# 📊 Period Analysis: {start_date} to {end_date}\n\n"
        
        if not entries:
            analysis += "No entries found for this period.\n"
        else:
            # Summary stats
            personal_count = sum(1 for e in entries if e['is_personal'])
            project_count = len(entries) - personal_count
            
            analysis += f"## Summary\n"
            analysis += f"- **Total Entries**: {len(entries)}\n"
            analysis += f"- **Personal**: {personal_count} | **Project**: {project_count}\n"
            analysis += f"- **Significant Entries**: {len(significant)}\n\n"
            
            # Entry types breakdown
            type_counts = {}
            for e in entries:
                type_counts[e['entry_type']] = type_counts.get(e['entry_type'], 0) + 1
            
            analysis += f"## Activity Breakdown\n"
            for entry_type, count in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
                analysis += f"- {entry_type}: {count}\n"
            analysis += "\n"
            
            # Significant achievements
            if significant:
                analysis += f"## 🏆 Significant Achievements\n"
                for entry in entries:
                    if entry['id'] in significant:
                        analysis += f"- **Entry #{entry['id']}** ({significant[entry['id']]}): {entry['content'][:100]}...\n"
                analysis += "\n"
            
            # Top tags
            all_tags = {}
            for e in entries:
                for tag in e['tags']:
                    all_tags[tag] = all_tags.get(tag, 0) + 1
            
            if all_tags:
                analysis += f"## 🏷️ Top Tags\n"
                for tag, count in sorted(all_tags.items(), key=lambda x: x[1], reverse=True)[:10]:
                    analysis += f"- {tag}: {count}\n"
                analysis += "\n"
            
            # Key insights section
            analysis += f"## 💡 Ready for Analysis\n"
            analysis += f"The data above shows your activity from {start_date} to {end_date}. "
            analysis += f"Use this information to identify patterns, celebrate wins, and plan improvements.\n"

        return types.GetPromptResult(
            description=f"Period analysis from {start_date} to {end_date}",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=analysis)
                )
            ]
        )

    elif name == "prepare-standup":
        days_back = int(arguments.get("days_back", "1"))
        
        def get_standup_data():
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT m.id, m.entry_type, m.content, m.timestamp
                    FROM memory_journal m
                    WHERE m.deleted_at IS NULL
                    AND m.is_personal = 0
                    AND DATE(m.timestamp) >= DATE('now', '-' || ? || ' days')
                    ORDER BY m.timestamp DESC
                """, (days_back,))
                
                return [dict(row) for row in cursor.fetchall()]

        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, get_standup_data)

        standup = f"# 🎯 Daily Standup Summary\n\n"
        standup += f"*Last {days_back} day(s) of technical work*\n\n"
        
        if not entries:
            standup += "## ✅ What I Did\n"
            standup += "No technical entries logged in the specified period.\n\n"
        else:
            # Group by achievements, blockers, and plans
            achievements = []
            blockers = []
            others = []
            
            for entry in entries:
                content_lower = entry['content'].lower()
                if 'blocked' in content_lower or 'issue' in content_lower or 'problem' in content_lower:
                    blockers.append(entry)
                elif entry['entry_type'] in ['technical_achievement', 'milestone']:
                    achievements.append(entry)
                else:
                    others.append(entry)
            
            if achievements:
                standup += "## ✅ What I Did\n"
                for entry in achievements:
                    preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                    standup += f"- {preview}\n"
                standup += "\n"
            
            if blockers:
                standup += "## 🚧 Blockers/Issues\n"
                for entry in blockers:
                    preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                    standup += f"- {preview}\n"
                standup += "\n"
            
            if others:
                standup += "## 📝 Other Work\n"
                for entry in others[:5]:  # Limit to 5
                    preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
                    standup += f"- {preview}\n"
                standup += "\n"

        standup += "## 🎯 What's Next\n"
        standup += "*Add your plans for today here*\n"

        return types.GetPromptResult(
            description="Daily standup preparation",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=standup)
                )
            ]
        )

    elif name == "prepare-retro":
        sprint_start = arguments.get("sprint_start")
        sprint_end = arguments.get("sprint_end")

        def get_retro_data():
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
                    FROM memory_journal m
                    WHERE m.deleted_at IS NULL
                    AND DATE(m.timestamp) >= DATE(?)
                    AND DATE(m.timestamp) <= DATE(?)
                    ORDER BY m.timestamp
                """, (sprint_start, sprint_end))
                
                entries = [dict(row) for row in cursor.fetchall()]
                
                # Get significant entries
                cursor = conn.execute("""
                    SELECT se.entry_id, se.significance_type
                    FROM significant_entries se
                    JOIN memory_journal m ON se.entry_id = m.id
                    WHERE DATE(m.timestamp) >= DATE(?)
                    AND DATE(m.timestamp) <= DATE(?)
                    AND m.deleted_at IS NULL
                """, (sprint_start, sprint_end))
                
                significant = {row[0]: row[1] for row in cursor.fetchall()}
                
                return entries, significant

        loop = asyncio.get_event_loop()
        entries, significant = await loop.run_in_executor(thread_pool, get_retro_data)

        retro = f"# 🔄 Sprint Retrospective\n\n"
        retro += f"**Sprint Period**: {sprint_start} to {sprint_end}\n"
        retro += f"**Total Entries**: {len(entries)}\n\n"

        if not entries:
            retro += "No entries found for this sprint period.\n"
        else:
            # What went well
            went_well = [e for e in entries if e['entry_type'] in ['technical_achievement', 'milestone'] or e['id'] in significant]
            if went_well:
                retro += "## ✅ What Went Well\n"
                for entry in went_well:
                    sig_marker = f" ({significant.get(entry['id'], '')})" if entry['id'] in significant else ""
                    preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                    retro += f"- **Entry #{entry['id']}**{sig_marker}: {preview}\n"
                retro += "\n"
            
            # What could be improved (looking for entries with problem indicators)
            improvements = []
            for entry in entries:
                content_lower = entry['content'].lower()
                if any(word in content_lower for word in ['struggled', 'difficult', 'challenge', 'problem', 'issue', 'blocked']):
                    improvements.append(entry)
            
            if improvements:
                retro += "## 🔧 What Could Be Improved\n"
                for entry in improvements[:10]:  # Limit to 10
                    preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
                    retro += f"- **Entry #{entry['id']}**: {preview}\n"
                retro += "\n"
            
            # Action items section
            retro += "## 🎯 Action Items\n"
            retro += "*Based on the above, what specific actions should we take?*\n"
            retro += "- [ ] Action item 1\n"
            retro += "- [ ] Action item 2\n"

        return types.GetPromptResult(
            description=f"Sprint retrospective for {sprint_start} to {sprint_end}",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=retro)
                )
            ]
        )

    elif name == "find-related":
        entry_id_str = arguments.get("entry_id")
        similarity_threshold = float(arguments.get("similarity_threshold", "0.3"))

        if not entry_id_str:
            return types.GetPromptResult(
                description="Error",
                messages=[
                    PromptMessage(
                        role="user",
                        content=types.TextContent(type="text", text="❌ Entry ID is required")
                    )
                ]
            )

        try:
            entry_id = int(entry_id_str)
        except ValueError:
            return types.GetPromptResult(
                description="Error",
                messages=[
                    PromptMessage(
                        role="user",
                        content=types.TextContent(type="text", text="❌ Entry ID must be a number")
                    )
                ]
            )

        def get_entry_and_tags():
            with db.get_connection() as conn:
                # Get the entry
                cursor = conn.execute("""
                    SELECT id, content, entry_type
                    FROM memory_journal
                    WHERE id = ? AND deleted_at IS NULL
                """, (entry_id,))
                entry = cursor.fetchone()
                
                if not entry:
                    return None, []
                
                # Get entry tags
                cursor = conn.execute("""
                    SELECT t.name FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    WHERE et.entry_id = ?
                """, (entry_id,))
                tags = [row[0] for row in cursor.fetchall()]
                
                # Find entries with similar tags
                if tags:
                    placeholders = ','.join(['?'] * len(tags))
                    cursor = conn.execute(f"""
                        SELECT DISTINCT m.id, m.content, m.entry_type, COUNT(*) as tag_matches
                        FROM memory_journal m
                        JOIN entry_tags et ON m.id = et.entry_id
                        JOIN tags t ON et.tag_id = t.id
                        WHERE t.name IN ({placeholders})
                        AND m.id != ?
                        AND m.deleted_at IS NULL
                        GROUP BY m.id
                        ORDER BY tag_matches DESC
                        LIMIT 10
                    """, (*tags, entry_id))
                    tag_related = [dict(row) for row in cursor.fetchall()]
                else:
                    tag_related = []
                
                return dict(entry), tags, tag_related

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(thread_pool, get_entry_and_tags)
        
        if result[0] is None:
            return types.GetPromptResult(
                description="Error",
                messages=[
                    PromptMessage(
                        role="user",
                        content=types.TextContent(type="text", text=f"❌ Entry #{entry_id} not found")
                    )
                ]
            )

        entry, tags, tag_related = result

        output = f"# 🔗 Related Entries for Entry #{entry_id}\n\n"
        output += f"**Original Entry**: {entry['content'][:150]}...\n"
        output += f"**Type**: {entry['entry_type']}\n"
        if tags:
            output += f"**Tags**: {', '.join(tags)}\n"
        output += "\n---\n\n"

        # Try semantic search if available
        semantic_related = []
        if vector_search and vector_search.initialized:
            try:
                semantic_results = await vector_search.semantic_search(entry['content'], limit=10, similarity_threshold=similarity_threshold)
                if semantic_results:
                    def get_semantic_entries():
                        entry_ids = [r[0] for r in semantic_results if r[0] != entry_id]
                        if not entry_ids:
                            return []
                        with db.get_connection() as conn:
                            placeholders = ','.join(['?'] * len(entry_ids))
                            cursor = conn.execute(f"""
                                SELECT id, content, entry_type
                                FROM memory_journal
                                WHERE id IN ({placeholders})
                            """, entry_ids)
                            entries = {row[0]: dict(row) for row in cursor.fetchall()}
                        
                        return [(entries[r[0]], r[1]) for r in semantic_results if r[0] in entries]
                    
                    semantic_related = await loop.run_in_executor(thread_pool, get_semantic_entries)
            except Exception as e:
                print(f"Semantic search error: {e}")

        if semantic_related:
            output += "## 🧠 Semantically Similar Entries\n"
            for entry_data, score in semantic_related[:5]:
                preview = entry_data['content'][:150] + ('...' if len(entry_data['content']) > 150 else '')
                output += f"- **Entry #{entry_data['id']}** (similarity: {score:.2f}): {preview}\n"
            output += "\n"

        if tag_related:
            output += "## 🏷️ Entries with Shared Tags\n"
            for related in tag_related[:5]:
                preview = related['content'][:150] + ('...' if len(related['content']) > 150 else '')
                output += f"- **Entry #{related['id']}** ({related['tag_matches']} shared tags): {preview}\n"
            output += "\n"

        if not semantic_related and not tag_related:
            output += "No related entries found.\n"

        return types.GetPromptResult(
            description=f"Related entries for entry #{entry_id}",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=output)
                )
            ]
        )

    elif name == "weekly-digest":
        week_offset = int(arguments.get("week_offset", "0"))
        
        def get_week_entries():
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
                    FROM memory_journal m
                    WHERE m.deleted_at IS NULL
                    AND DATE(m.timestamp) >= DATE('now', 'weekday 0', '-7 days', ? || ' weeks')
                    AND DATE(m.timestamp) < DATE('now', 'weekday 0', ? || ' weeks')
                    ORDER BY m.timestamp
                """, (week_offset - 1, week_offset))
                
                return [dict(row) for row in cursor.fetchall()]

        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, get_week_entries)

        week_label = "This Week" if week_offset == 0 else f"{abs(week_offset)} Week(s) Ago"
        
        digest = f"# 📅 Weekly Digest: {week_label}\n\n"
        
        if not entries:
            digest += "No entries found for this week.\n"
        else:
            personal = [e for e in entries if e['is_personal']]
            project = [e for e in entries if not e['is_personal']]
            
            digest += f"**Summary**: {len(entries)} total entries ({len(project)} project, {len(personal)} personal)\n\n"
            
            # Group by day
            from datetime import datetime as dt
            by_day = {}
            for entry in entries:
                day = entry['timestamp'][:10]
                if day not in by_day:
                    by_day[day] = []
                by_day[day].append(entry)
            
            for day in sorted(by_day.keys()):
                day_entries = by_day[day]
                digest += f"## {day} ({len(day_entries)} entries)\n"
                for entry in day_entries:
                    icon = "🔒" if entry['is_personal'] else "💼"
                    preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
                    digest += f"- {icon} **Entry #{entry['id']}** ({entry['entry_type']}): {preview}\n"
                digest += "\n"

        return types.GetPromptResult(
            description=f"Weekly digest: {week_label}",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=digest)
                )
            ]
        )

    elif name == "goal-tracker":
        project_name = arguments.get("project_name")
        goal_type = arguments.get("goal_type")

        def get_goals():
            with db.get_connection() as conn:
                sql = """
                    SELECT m.id, m.entry_type, m.content, m.timestamp, m.project_context,
                           se.significance_type, se.significance_rating
                    FROM memory_journal m
                    LEFT JOIN significant_entries se ON m.id = se.entry_id
                    WHERE m.deleted_at IS NULL
                    AND (se.significance_type IS NOT NULL OR m.entry_type = 'milestone')
                """
                params = []
                
                if goal_type:
                    sql += " AND se.significance_type = ?"
                    params.append(goal_type)
                
                sql += " ORDER BY m.timestamp DESC"
                
                cursor = conn.execute(sql, params)
                goals = []
                
                for row in cursor.fetchall():
                    goal = dict(row)
                    # Filter by project name if specified
                    if project_name and goal['project_context']:
                        try:
                            ctx = json.loads(goal['project_context'])
                            if ctx.get('repo_name', '').lower() != project_name.lower():
                                continue
                        except:
                            pass
                    goals.append(goal)
                
                return goals

        loop = asyncio.get_event_loop()
        goals = await loop.run_in_executor(thread_pool, get_goals)

        tracker = f"# 🎯 Goal Tracker\n\n"
        
        if project_name:
            tracker += f"**Project**: {project_name}\n"
        if goal_type:
            tracker += f"**Goal Type**: {goal_type}\n"
        
        tracker += f"\n**Total Milestones/Goals**: {len(goals)}\n\n"
        
        if not goals:
            tracker += "No goals or milestones found matching the criteria.\n"
        else:
            # Group by month
            by_month = {}
            for goal in goals:
                month = goal['timestamp'][:7]  # YYYY-MM
                if month not in by_month:
                    by_month[month] = []
                by_month[month].append(goal)
            
            for month in sorted(by_month.keys(), reverse=True):
                month_goals = by_month[month]
                tracker += f"## {month} ({len(month_goals)} milestones)\n"
                for goal in month_goals:
                    sig_type = goal.get('significance_type', goal['entry_type'])
                    preview = goal['content'][:200] + ('...' if len(goal['content']) > 200 else '')
                    
                    # Get project name from context
                    project = ""
                    if goal['project_context']:
                        try:
                            ctx = json.loads(goal['project_context'])
                            if ctx.get('repo_name'):
                                project = f" [{ctx['repo_name']}]"
                        except:
                            pass
                    
                    tracker += f"- ✅ **Entry #{goal['id']}** ({sig_type}){project}: {preview}\n"
                tracker += "\n"

        return types.GetPromptResult(
            description="Goal and milestone tracker",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=tracker)
                )
            ]
        )

    elif name == "project-status-summary":
        # Phase 2 - Issue #16: Project Status Summary (Phase 3: org support)
        project_number = int(arguments.get("project_number", "0"))
        time_period = arguments.get("time_period", "week")
        include_items = arguments.get("include_items", "true").lower() == "true"
        owner_arg = arguments.get("owner")  # Phase 3
        owner_type_arg = arguments.get("owner_type")  # Phase 3

        if not project_number:
            return types.GetPromptResult(
                description="Project status summary error",
                messages=[PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text="❌ project_number is required")
                )]
            )

        # Calculate date range based on time period
        from datetime import datetime, timedelta
        end_date = datetime.now()
        if time_period == "month":
            start_date = end_date - timedelta(days=30)
        elif time_period == "sprint":
            start_date = end_date - timedelta(days=14)
        else:  # week
            start_date = end_date - timedelta(days=7)

        start_str = start_date.strftime('%Y-%m-%d')
        end_str = end_date.strftime('%Y-%m-%d')

        def get_project_data():
            with db.get_connection() as conn:
                # Get journal entries for this project
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp
                    FROM memory_journal
                    WHERE project_number = ? AND deleted_at IS NULL
                      AND DATE(timestamp) >= DATE(?) AND DATE(timestamp) <= DATE(?)
                    ORDER BY timestamp DESC
                """, (project_number, start_str, end_str))
                entries = [dict(row) for row in cursor.fetchall()]

                # Get project statistics
                cursor = conn.execute("""
                    SELECT COUNT(*) as total,
                           COUNT(DISTINCT DATE(timestamp)) as active_days,
                           MIN(timestamp) as first_entry,
                           MAX(timestamp) as last_entry
                    FROM memory_journal
                    WHERE project_number = ? AND deleted_at IS NULL
                """, (project_number,))
                stats = dict(cursor.fetchone())

                return entries, stats

        loop = asyncio.get_event_loop()
        entries, stats = await loop.run_in_executor(thread_pool, get_project_data)

        # Get project details and items from GitHub (Phase 3: use owner params if provided)
        project_context = await db.get_project_context()
        owner = owner_arg
        owner_type = owner_type_arg if owner_type_arg in ['user', 'org'] else 'user'
        
        # Auto-detect owner from context if not provided
        if not owner and 'repo_path' in project_context:
            owner = github_projects._extract_repo_owner_from_remote(project_context['repo_path'])
            if owner:
                owner_type = github_projects.detect_owner_type(owner)

        project_details = None
        project_items = []
        if owner and include_items:
            project_details = github_projects.get_project_details(owner, project_number, owner_type)
            project_items = github_projects.get_project_items_with_fields(owner, project_number, limit=50, owner_type=owner_type)

        # Format output
        summary = f"# 📊 Project #{project_number} Status Summary\n\n"
        summary += f"**Period:** {start_str} to {end_str} ({time_period})\n"
        summary += f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"

        # Project overview
        if project_details:
            summary += f"## Project Overview\n"
            summary += f"**Name:** {project_details.get('name', 'Unknown')}\n"
            if project_details.get('description'):
                summary += f"**Description:** {project_details['description']}\n"
            summary += f"**Status:** {project_details.get('state', 'unknown')}\n"
            summary += f"**URL:** {project_details.get('url', 'N/A')}\n\n"

        # Journal statistics
        summary += f"## Journal Activity\n"
        summary += f"**Total Entries:** {len(entries)}\n"
        summary += f"**Active Days:** {stats.get('active_days', 0)}\n"
        if stats.get('first_entry'):
            summary += f"**First Entry:** {stats['first_entry']}\n"
        if stats.get('last_entry'):
            summary += f"**Last Entry:** {stats['last_entry']}\n"
        summary += "\n"

        # Recent journal entries
        if entries:
            summary += f"## Recent Entries\n"
            for entry in entries[:10]:
                preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
                summary += f"- **#{entry['id']}** ({entry['entry_type']}) - {entry['timestamp'][:10]}\n"
                summary += f"  {preview}\n\n"

        # Project items status
        if include_items and project_items:
            summary += f"## Project Items ({len(project_items)} total)\n"
            
            # Group by status
            by_status = {}
            for item in project_items:
                status = item.get('status', 'unknown')
                if status not in by_status:
                    by_status[status] = []
                by_status[status].append(item)
            
            for status, items in by_status.items():
                summary += f"\n### {status.capitalize()} ({len(items)})\n"
                for item in items[:5]:
                    title = item.get('title', 'Untitled')
                    summary += f"- {title}\n"

        # Key insights
        summary += f"\n## Key Insights\n"
        if len(entries) > 0:
            avg_per_day = len(entries) / max(stats.get('active_days', 1), 1)
            summary += f"- Average entries per active day: {avg_per_day:.1f}\n"
        
        if include_items and project_items:
            completed = len(by_status.get('done', [])) + len(by_status.get('completed', []))
            total_items = len(project_items)
            if total_items > 0:
                completion_rate = (completed / total_items) * 100
                summary += f"- Project completion rate: {completion_rate:.1f}%\n"

        return types.GetPromptResult(
            description=f"Project #{project_number} status summary",
            messages=[PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=summary)
            )]
        )

    elif name == "project-milestone-tracker":
        # Phase 2 - Issue #16: Project Milestone Tracker (Phase 3: org support)
        project_number = int(arguments.get("project_number", "0"))
        milestone_name = arguments.get("milestone_name")
        owner_arg = arguments.get("owner")  # Phase 3
        owner_type_arg = arguments.get("owner_type")  # Phase 3

        if not project_number:
            return types.GetPromptResult(
                description="Milestone tracker error",
                messages=[PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text="❌ project_number is required")
                )]
            )

        def get_milestone_data():
            with db.get_connection() as conn:
                # Get all journal entries for this project
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp,
                           strftime('%Y-W%W', timestamp) as week
                    FROM memory_journal
                    WHERE project_number = ? AND deleted_at IS NULL
                    ORDER BY timestamp DESC
                """, (project_number,))
                entries = [dict(row) for row in cursor.fetchall()]

                # Calculate velocity (entries per week)
                cursor = conn.execute("""
                    SELECT strftime('%Y-W%W', timestamp) as week, COUNT(*) as count
                    FROM memory_journal
                    WHERE project_number = ? AND deleted_at IS NULL
                    GROUP BY week
                    ORDER BY week DESC
                    LIMIT 12
                """, (project_number,))
                velocity = [dict(row) for row in cursor.fetchall()]

                return entries, velocity

        loop = asyncio.get_event_loop()
        entries, velocity = await loop.run_in_executor(thread_pool, get_milestone_data)

        # Get GitHub milestones (Phase 3: use owner params if provided)
        project_context = await db.get_project_context()
        owner = owner_arg
        repo = None
        
        # Auto-detect owner from context if not provided
        if not owner and 'repo_path' in project_context:
            owner = github_projects._extract_repo_owner_from_remote(project_context['repo_path'])
        
        if 'repo_name' in project_context:
            repo = project_context['repo_name']

        milestones = []
        if owner and repo:
            milestones = github_projects.get_repo_milestones(owner, repo)
            if milestone_name:
                milestones = [m for m in milestones if milestone_name.lower() in m.get('title', '').lower()]

        # Format output
        tracker = f"# 🎯 Milestone Tracker - Project #{project_number}\n\n"
        
        if milestones:
            tracker += f"## GitHub Milestones\n"
            for milestone in milestones:
                tracker += f"\n### {milestone['title']}\n"
                if milestone.get('description'):
                    tracker += f"{milestone['description']}\n\n"
                tracker += f"**Status:** {milestone['state']}\n"
                tracker += f"**Progress:** {milestone['closed_issues']}/{milestone['open_issues'] + milestone['closed_issues']} issues closed\n"
                if milestone.get('due_on'):
                    tracker += f"**Due:** {milestone['due_on'][:10]}\n"
                tracker += f"**URL:** {milestone['url']}\n"
        else:
            tracker += f"No GitHub milestones found for this project.\n\n"

        # Journal entries summary
        tracker += f"\n## Journal Activity\n"
        tracker += f"**Total Entries:** {len(entries)}\n"
        if entries:
            tracker += f"**Date Range:** {entries[-1]['timestamp'][:10]} to {entries[0]['timestamp'][:10]}\n"
        tracker += "\n"

        # Velocity tracking
        if velocity:
            tracker += f"## Velocity (Last 12 Weeks)\n"
            total_weeks = len(velocity)
            total_entries = sum(v['count'] for v in velocity)
            avg_velocity = total_entries / total_weeks if total_weeks > 0 else 0
            tracker += f"**Average:** {avg_velocity:.1f} entries/week\n\n"
            
            tracker += "```\n"
            for v in velocity[:8]:
                bar = '█' * min(v['count'], 50)
                tracker += f"{v['week']}: {bar} ({v['count']})\n"
            tracker += "```\n\n"

        # Timeline suggestion
        tracker += f"## 📅 Suggested Timeline Visualization\n"
        tracker += f"Use the `memory://projects/{project_number}/timeline` resource to see a detailed activity timeline.\n"

        return types.GetPromptResult(
            description=f"Project #{project_number} milestone tracker",
            messages=[PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=tracker)
            )]
        )

    else:
        raise ValueError(f"Unknown prompt: {name}")


async def main():
    """Run the server."""
    # Initialize GitHub Projects integration with db connection (Phase 2)
    global github_projects
    github_projects = GitHubProjectsIntegration(db_connection=db)
    
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="memory-journal",
                server_version="1.2.1",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )

if __name__ == "__main__":
    asyncio.run(main())
