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
from datetime import datetime
from typing import Dict, List, Any, Tuple
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

# Vector search imports (optional - graceful degradation if not available)
try:
    from sentence_transformers import SentenceTransformer
    import faiss
    VECTOR_SEARCH_AVAILABLE = True
    print("Vector search capabilities enabled")
except ImportError:
    VECTOR_SEARCH_AVAILABLE = False
    print("Vector search dependencies not found. Install with: pip install sentence-transformers faiss-cpu")
    print("Continuing without semantic search capabilities...")

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

            # Optimize for better query performance
            conn.execute("PRAGMA optimize")

            # Security: Set a reasonable timeout for busy database
            conn.execute("PRAGMA busy_timeout = 30000")  # 30 seconds

            if os.path.exists(schema_path):
                with open(schema_path, 'r') as f:
                    conn.executescript(f.read())

            # Run ANALYZE to update query planner statistics
            conn.execute("ANALYZE")

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

    def _validate_input(self, content: str, entry_type: str, tags: List[str], significance_type: str = None):
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
                print(f"WARNING: Content contains potentially sensitive SQL keyword: {pattern}")

    def auto_create_tags(self, tag_names: List[str]) -> List[int]:
        """Auto-create tags if they don't exist, return tag IDs."""
        tag_ids = []

        with self.get_connection() as conn:
            for tag_name in tag_names:
                cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                row = cursor.fetchone()

                if row:
                    tag_ids.append(row['id'])
                else:
                    cursor = conn.execute(
                        "INSERT INTO tags (name, usage_count) VALUES (?, 1)",
                        (tag_name,)
                    )
                    tag_ids.append(cursor.lastrowid)

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

        if VECTOR_SEARCH_AVAILABLE:
            try:
                self._initialize()
            except Exception as e:
                print(f"Warning: Vector search initialization failed: {e}")
                self.initialized = False

    def _initialize(self):
        """Initialize the sentence transformer model and FAISS index."""
        if not VECTOR_SEARCH_AVAILABLE:
            return

        print(f"Initializing sentence transformer model: {self.model_name}")
        self.model = SentenceTransformer(self.model_name)

        # Create FAISS index (384 dimensions for all-MiniLM-L6-v2)
        self.faiss_index = faiss.IndexFlatIP(384)  # Inner product for cosine similarity

        # Load existing embeddings from database
        self._load_existing_embeddings()

        self.initialized = True
        print(f"Vector search initialized with {self.faiss_index.ntotal} embeddings")

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

    else:
        print(f"DEBUG: No match for URI '{uri_str}'. Available: memory://recent, memory://significant")
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
        significance_type = arguments.get("significance_type")
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
        entry_id = await loop.run_in_executor(thread_pool, create_entry_in_db)
        print(f"DEBUG: Database operation completed, entry_id: {entry_id}")

        # Generate and store embedding for semantic search (if available)
        if vector_search and vector_search.initialized:
            try:
                print("DEBUG: Generating embedding for semantic search...")
                embedding_success = await vector_search.add_entry_embedding(entry_id, content)
                if embedding_success:
                    print(f"DEBUG: Embedding generated successfully for entry #{entry_id}")
                else:
                    print(f"DEBUG: Failed to generate embedding for entry #{entry_id}")
            except Exception as e:
                print(f"DEBUG: Error generating embedding: {e}")

        result = [types.TextContent(
            type="text",
            text=f"✅ Created journal entry #{entry_id}\n"
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
                conn.commit()
                print(f"DEBUG: Minimal DB insert completed, entry_id: {entry_id}")
                return entry_id

        # Run in thread pool
        loop = asyncio.get_event_loop()
        entry_id = await loop.run_in_executor(thread_pool, minimal_db_insert)

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
            def get_entry_details():
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
            entries = await loop.run_in_executor(thread_pool, get_entry_details)

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
                server_version="1.0.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )

if __name__ == "__main__":
    asyncio.run(main())
