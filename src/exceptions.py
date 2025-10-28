"""
Memory Journal MCP Server - Custom Exceptions
Exception classes for error handling throughout the application.
"""


class MemoryJournalError(Exception):
    """Base exception for all Memory Journal errors."""
    pass


class ValidationError(MemoryJournalError):
    """Raised when input validation fails."""
    pass


class ContentTooLongError(ValidationError):
    """Raised when content exceeds maximum length."""
    def __init__(self, length: int, max_length: int):
        self.length = length
        self.max_length = max_length
        super().__init__(f"Content length {length} exceeds maximum of {max_length} characters")


class TagTooLongError(ValidationError):
    """Raised when a tag exceeds maximum length."""
    def __init__(self, tag: str, max_length: int):
        self.tag = tag
        self.max_length = max_length
        super().__init__(f"Tag '{tag}' exceeds maximum length of {max_length} characters")


class InvalidCharactersError(ValidationError):
    """Raised when input contains invalid characters."""
    def __init__(self, value: str, invalid_chars: str):
        self.value = value
        self.invalid_chars = invalid_chars
        super().__init__(f"Value contains invalid characters: {invalid_chars}")


class DatabaseError(MemoryJournalError):
    """Base exception for database-related errors."""
    pass


class DatabaseConnectionError(DatabaseError):
    """Raised when database connection fails."""
    pass


class DatabaseIntegrityError(DatabaseError):
    """Raised when database integrity check fails."""
    pass


class DatabaseMigrationError(DatabaseError):
    """Raised when database migration fails."""
    pass


class EntryNotFoundError(DatabaseError):
    """Raised when a requested entry is not found."""
    def __init__(self, entry_id: int):
        self.entry_id = entry_id
        super().__init__(f"Entry #{entry_id} not found")


class RelationshipExistsError(DatabaseError):
    """Raised when attempting to create a duplicate relationship."""
    def __init__(self, from_id: int, to_id: int, rel_type: str):
        self.from_id = from_id
        self.to_id = to_id
        self.rel_type = rel_type
        super().__init__(f"Relationship already exists: Entry #{from_id} -{rel_type}-> Entry #{to_id}")


class SelfReferenceError(DatabaseError):
    """Raised when attempting to create a self-referencing relationship."""
    def __init__(self, entry_id: int):
        self.entry_id = entry_id
        super().__init__(f"Cannot link entry #{entry_id} to itself")


class GitError(MemoryJournalError):
    """Base exception for Git-related errors."""
    pass


class GitTimeoutError(GitError):
    """Raised when Git operation times out."""
    def __init__(self, timeout: float):
        self.timeout = timeout
        super().__init__(f"Git operation timed out after {timeout}s")


class GitNotFoundError(GitError):
    """Raised when Git is not found in PATH."""
    pass


class GitHubError(MemoryJournalError):
    """Base exception for GitHub API errors."""
    pass


class GitHubAuthError(GitHubError):
    """Raised when GitHub authentication fails."""
    pass


class GitHubAPIError(GitHubError):
    """Raised when GitHub API request fails."""
    def __init__(self, status_code: int, message: str = ""):
        self.status_code = status_code
        self.message = message
        super().__init__(f"GitHub API error {status_code}: {message}")


class GitHubRateLimitError(GitHubError):
    """Raised when GitHub API rate limit is exceeded."""
    pass


class VectorSearchError(MemoryJournalError):
    """Base exception for vector search errors."""
    pass


class VectorSearchNotAvailableError(VectorSearchError):
    """Raised when vector search dependencies are not installed."""
    def __init__(self):
        super().__init__("Vector search not available. Install dependencies: pip install sentence-transformers faiss-cpu")


class VectorSearchNotInitializedError(VectorSearchError):
    """Raised when vector search is used before initialization."""
    def __init__(self):
        super().__init__("Vector search not initialized")


class EmbeddingGenerationError(VectorSearchError):
    """Raised when embedding generation fails."""
    pass


class MCPError(MemoryJournalError):
    """Base exception for MCP protocol errors."""
    pass


class InvalidToolArgumentError(MCPError):
    """Raised when tool receives invalid arguments."""
    def __init__(self, tool_name: str, argument: str, reason: str):
        self.tool_name = tool_name
        self.argument = argument
        self.reason = reason
        super().__init__(f"Invalid argument '{argument}' for tool '{tool_name}': {reason}")


class ToolExecutionError(MCPError):
    """Raised when tool execution fails."""
    def __init__(self, tool_name: str, reason: str):
        self.tool_name = tool_name
        self.reason = reason
        super().__init__(f"Tool '{tool_name}' execution failed: {reason}")


class ResourceNotFoundError(MCPError):
    """Raised when a requested resource is not found."""
    def __init__(self, resource_uri: str):
        self.resource_uri = resource_uri
        super().__init__(f"Resource not found: {resource_uri}")


class InvalidResourceURIError(MCPError):
    """Raised when a resource URI is invalid."""
    def __init__(self, resource_uri: str, reason: str):
        self.resource_uri = resource_uri
        self.reason = reason
        super().__init__(f"Invalid resource URI '{resource_uri}': {reason}")

