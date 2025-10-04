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
    from mcp.types import Resource, Tool, Prompt, PromptMessage
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
        print("Vector search capabilities available (will load on first use)", file=sys.stderr)
except Exception:
    print("Vector search dependencies not found. Install with: pip install sentence-transformers faiss-cpu", file=sys.stderr)
    print("Continuing without semantic search capabilities...", file=sys.stderr)

# Lazy imports for vector search (loaded on first use)
SentenceTransformer = None
faiss = None

# Thread pool for non-blocking database operations
thread_pool = ThreadPoolExecutor(max_workers=2)

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

        # Basic SQL injection prevention (though we use parameterized queries)
        dangerous_patterns = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'CREATE', 'ALTER', 'EXEC', 'UNION']
        content_upper = content.upper()
        for pattern in dangerous_patterns:
            if f' {pattern} ' in content_upper or content_upper.startswith(f'{pattern} '):
                # This is just a warning since legitimate content might contain these words
                print(f"WARNING: Content contains potentially sensitive SQL keyword: {pattern}", file=sys.stderr)

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
        self._initialization_attempted = False

        # Don't initialize immediately - do it lazily on first use for faster startup

    def _ensure_initialized(self):
        """Lazy initialization - only initialize on first use."""
        if self.initialized or self._initialization_attempted:
            return
        
        self._initialization_attempted = True
        
        if not VECTOR_SEARCH_AVAILABLE:
            return

        try:
            # Lazy import of heavy dependencies (only on first use)
            global SentenceTransformer, faiss
            if SentenceTransformer is None:
                print("Loading vector search dependencies (first use)...", file=sys.stderr)
                from sentence_transformers import SentenceTransformer as ST
                import faiss as faiss_module
                SentenceTransformer = ST
                faiss = faiss_module
                print("Vector search dependencies loaded", file=sys.stderr)

            # Use stderr for initialization messages to avoid MCP JSON parsing errors
            print(f"Initializing sentence transformer model: {self.model_name}", file=sys.stderr)
            self.model = SentenceTransformer(self.model_name)

            # Create FAISS index (384 dimensions for all-MiniLM-L6-v2)
            self.faiss_index = faiss.IndexFlatIP(384)  # Inner product for cosine similarity

            # Load existing embeddings from database
            self._load_existing_embeddings()

            self.initialized = True
            print(f"Vector search initialized with {self.faiss_index.ntotal} embeddings", file=sys.stderr)
        except Exception as e:
            print(f"Warning: Vector search initialization failed: {e}", file=sys.stderr)
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
                faiss.normalize_L2(vectors)

                # Add to FAISS index
                self.faiss_index.add(vectors)

                # Update entry ID mapping
                for i, entry_id in enumerate(entry_ids):
                    self.entry_id_map[i] = entry_id

    async def generate_embedding(self, text: str):
        """Generate embedding for text using sentence transformer."""
        self._ensure_initialized()
        
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
        self._ensure_initialized()
        
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
            self.faiss_index.add(embedding_norm.reshape(1, -1))

            # Update entry ID mapping
            new_index = self.faiss_index.ntotal - 1
            self.entry_id_map[new_index] = entry_id

            return True

        except Exception as e:
            print(f"Error adding embedding for entry {entry_id}: {e}")
            return False

    async def semantic_search(self, query: str, limit: int = 10, similarity_threshold: float = 0.3) -> List[Tuple[int, float]]:
        """Perform semantic search and return entry IDs with similarity scores."""
        self._ensure_initialized()
        
        if not self.initialized or self.faiss_index.ntotal == 0:
            return []

        try:
            # Generate query embedding
            query_embedding = await self.generate_embedding(query)

            # Normalize for cosine similarity
            query_norm = query_embedding.copy()
            faiss.normalize_L2(query_norm.reshape(1, -1))

            # Search FAISS index
            scores, indices = self.faiss_index.search(query_norm.reshape(1, -1), min(limit * 2, self.faiss_index.ntotal))

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


@server.list_resources()
async def list_resources() -> List[Resource]:
    """List available resources."""
    return [
        Resource(
            uri="memory://recent",
            name="Recent Journal Entries",
            description="Most recent journal entries",
            mimeType="application/json"
        ),
        Resource(
            uri="memory://significant",
            name="Significant Entries",
            description="Entries marked as significant",
            mimeType="application/json"
        ),
        Resource(
            uri="memory://graph/recent",
            name="Relationship Graph (Recent)",
            description="Mermaid graph visualization of recent entries with relationships",
            mimeType="text/plain"
        )
    ]


@server.read_resource()
async def read_resource(uri: str) -> str:
    """Read a specific resource."""
    # Debug logging
    print(f"DEBUG: Requested resource URI: '{uri}' (type: {type(uri)})")

    # Convert URI to string if it's not already (handles AnyUrl objects)
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
                    print(f"DEBUG: Found {len(entries)} recent entries")
                    return entries

            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_recent_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            print(f"DEBUG: Error reading recent entries: {e}")
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
                    print(f"DEBUG: Found {len(entries)} significant entries")
                    return entries

            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_significant_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            print(f"DEBUG: Error reading significant entries: {e}")
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
            print(f"DEBUG: Error generating relationship graph: {e}", file=sys.stderr)
            raise

    else:
        print(f"DEBUG: No match for URI '{uri_str}'. Available: memory://recent, memory://significant, memory://graph/recent")
        raise ValueError(f"Unknown resource: {uri_str}")


@server.list_tools()
async def list_tools() -> List[Tool]:
    """List available tools."""
    return [
        Tool(
            name="create_entry",
            description="Create a new journal entry with context and tags",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"},
                    "is_personal": {"type": "boolean", "default": True},
                    "entry_type": {"type": "string", "default": "personal_reflection"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "significance_type": {"type": "string"},
                    "auto_context": {"type": "boolean", "default": True}
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
                    "limit": {"type": "integer", "default": 10}
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
                    "content": {"type": "string", "description": "The journal entry content"}
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
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter by tags"}
                },
                "required": ["start_date", "end_date"]
            }
        ),
        Tool(
            name="get_statistics",
            description="Get journal statistics and analytics",
            inputSchema={
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, optional)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD, optional)"},
                    "group_by": {
                        "type": "string", 
                        "description": "Group statistics by period (day, week, month)",
                        "default": "week"
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
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle tool calls."""

    # Debug logging
    print(f"DEBUG: Tool call received: {name} with args: {list(arguments.keys())}")

    if name == "create_entry":
        print("DEBUG: Starting create_entry processing...")
        content = arguments["content"]
        is_personal = arguments.get("is_personal", True)
        entry_type = arguments.get("entry_type", "personal_reflection")
        tags = arguments.get("tags", [])
        significance_type: Optional[str] = arguments.get("significance_type")
        auto_context = arguments.get("auto_context", True)

        # Validate input for security
        try:
            db._validate_input(content, entry_type, tags, significance_type)
        except ValueError as e:
            return [types.TextContent(
                type="text",
                text=f"❌ Input validation failed: {str(e)}"
            )]

        print(f"DEBUG: Parsed arguments - content length: {len(content)}, tags: {len(tags)}")

        project_context = None
        if auto_context:
            print("DEBUG: Getting project context...")
            context = await db.get_project_context()
            project_context = json.dumps(context)
            print("DEBUG: Project context captured successfully")

        tag_ids = []
        if tags:
            print(f"DEBUG: Auto-creating {len(tags)} tags...")
            # Run tag creation in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            tag_ids = await loop.run_in_executor(thread_pool, db.auto_create_tags, tags)
            print(f"DEBUG: Tags created successfully: {tag_ids}")

        # Run database operations in thread pool to avoid blocking event loop
        def create_entry_in_db():
            print("DEBUG: Starting database operations...")
            with db.get_connection() as conn:
                print("DEBUG: Database connection established")
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, is_personal, project_context, related_patterns
                    ) VALUES (?, ?, ?, ?, ?)
                """, (entry_type, content, is_personal, project_context, ','.join(tags)))

                entry_id = cursor.lastrowid
                if entry_id is None:
                    raise RuntimeError("Failed to get entry ID after insert")
                print(f"DEBUG: Entry inserted with ID: {entry_id}")

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
                print("DEBUG: Database transaction committed successfully")
                return entry_id

        # Run in thread pool to avoid blocking
        print("DEBUG: Submitting database operation to thread pool...")
        loop = asyncio.get_event_loop()
        result_entry_id: int = await loop.run_in_executor(thread_pool, create_entry_in_db)
        print(f"DEBUG: Database operation completed, entry_id: {result_entry_id}")

        # Generate and store embedding for semantic search (if available)
        if vector_search and vector_search.initialized:
            try:
                print("DEBUG: Generating embedding for semantic search...")
                embedding_success = await vector_search.add_entry_embedding(result_entry_id, content)
                if embedding_success:
                    print(f"DEBUG: Embedding generated successfully for entry #{result_entry_id}")
                else:
                    print(f"DEBUG: Failed to generate embedding for entry #{result_entry_id}")
            except Exception as e:
                print(f"DEBUG: Error generating embedding: {e}")

        result = [types.TextContent(
            type="text",
            text=f"✅ Created journal entry #{result_entry_id}\n"
                 f"Type: {entry_type}\n"
                 f"Personal: {is_personal}\n"
                 f"Tags: {', '.join(tags) if tags else 'None'}"
        )]
        print("DEBUG: create_entry completed successfully, returning result")
        return result

    elif name == "search_entries":
        query = arguments.get("query")
        is_personal = arguments.get("is_personal")
        limit = arguments.get("limit", 10)

        if query:
            sql = """
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal,
                       snippet(memory_journal_fts, 0, '**', '**', '...', 20) AS snippet
                FROM memory_journal_fts
                JOIN memory_journal m ON memory_journal_fts.rowid = m.id
                WHERE memory_journal_fts MATCH ?
            """
            params = [query]
        else:
            sql = """
                SELECT id, entry_type, content, timestamp, is_personal,
                       substr(content, 1, 100) || '...' AS snippet
                FROM memory_journal
                WHERE 1=1
            """
            params = []

        if is_personal is not None:
            sql += " AND is_personal = ?"
            params.append(is_personal)

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
        print("DEBUG: Running simple test...")
        message = arguments.get("message", "Hello")
        print(f"DEBUG: Simple test completed with message: {message}")
        return [types.TextContent(
            type="text",
            text=f"✅ Simple test successful! Message: {message}"
        )]

    elif name == "create_entry_minimal":
        print("DEBUG: Starting minimal entry creation...")
        content = arguments["content"]

        # Just a simple database insert without any context or tag operations
        def minimal_db_insert():
            print("DEBUG: Minimal DB insert starting...")
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, is_personal
                    ) VALUES (?, ?, ?)
                """, ("test_entry", content, True))
                entry_id = cursor.lastrowid
                if entry_id is None:
                    raise RuntimeError("Failed to get entry ID after insert")
                conn.commit()
                print(f"DEBUG: Minimal DB insert completed, entry_id: {entry_id}")
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

        if not vector_search or not vector_search.initialized:
            return [types.TextContent(
                type="text",
                text="❌ Vector search not available. Install dependencies: pip install sentence-transformers faiss-cpu"
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
                # Get main entry
                cursor = conn.execute("""
                    SELECT id, entry_type, content, timestamp, is_personal, project_context, related_patterns
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

        if not start_date or not end_date:
            return [types.TextContent(type="text", text="❌ Both start_date and end_date are required (YYYY-MM-DD)")]

        def search_entries():
            with db.get_connection() as conn:
                sql = """
                    SELECT DISTINCT m.id, m.entry_type, m.content, m.timestamp, m.is_personal
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
                {
                    "name": "include_git",
                    "description": "Include Git repository information",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="get-recent-entries",
            description="Get the last X journal entries",
            arguments=[
                {
                    "name": "count",
                    "description": "Number of recent entries to retrieve (default: 5)",
                    "required": False
                },
                {
                    "name": "personal_only",
                    "description": "Only show personal entries (true/false)",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="analyze-period",
            description="Analyze journal entries over a specific time period for insights, patterns, and achievements",
            arguments=[
                {
                    "name": "start_date",
                    "description": "Start date for analysis (YYYY-MM-DD)",
                    "required": True
                },
                {
                    "name": "end_date",
                    "description": "End date for analysis (YYYY-MM-DD)",
                    "required": True
                },
                {
                    "name": "focus_area",
                    "description": "Optional focus area (e.g., 'technical', 'personal', 'productivity')",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="prepare-standup",
            description="Prepare daily standup summary from recent technical journal entries",
            arguments=[
                {
                    "name": "days_back",
                    "description": "Number of days to look back (default: 1)",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="prepare-retro",
            description="Prepare sprint retrospective with achievements, learnings, and areas for improvement",
            arguments=[
                {
                    "name": "sprint_start",
                    "description": "Sprint start date (YYYY-MM-DD)",
                    "required": True
                },
                {
                    "name": "sprint_end",
                    "description": "Sprint end date (YYYY-MM-DD)",
                    "required": True
                }
            ]
        ),
        Prompt(
            name="find-related",
            description="Find entries related to a specific entry using semantic similarity and tags",
            arguments=[
                {
                    "name": "entry_id",
                    "description": "Entry ID to find related entries for",
                    "required": True
                },
                {
                    "name": "similarity_threshold",
                    "description": "Minimum similarity score (0.0-1.0, default: 0.3)",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="weekly-digest",
            description="Generate a formatted summary of journal entries for a specific week",
            arguments=[
                {
                    "name": "week_offset",
                    "description": "Week offset (0 = current week, -1 = last week, etc.)",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="goal-tracker",
            description="Track progress on goals and milestones from journal entries",
            arguments=[
                {
                    "name": "project_name",
                    "description": "Optional project name to filter by",
                    "required": False
                },
                {
                    "name": "goal_type",
                    "description": "Type of goal (milestone, technical_breakthrough, etc.)",
                    "required": False
                }
            ]
        )
    ]


@server.get_prompt()
async def get_prompt(name: str, arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle prompt requests."""

    if name == "get-context-bundle":
        include_git = arguments.get("include_git", "true").lower() == "true"

        if include_git:
            # Get full context with Git info
            context = await db.get_project_context()
        else:
            # Get basic context without Git operations
            context = {
                'cwd': os.getcwd(),
                'timestamp': datetime.now().isoformat(),
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

    else:
        raise ValueError(f"Unknown prompt: {name}")


async def main():
    """Run the server."""
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="memory-journal",
                server_version="1.1.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )

if __name__ == "__main__":
    asyncio.run(main())
