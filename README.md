# Memory Journal MCP Server

A **fully functional** Model Context Protocol (MCP) server for personal journaling with rich context awareness and powerful search capabilities. This system provides the perfect balance of sophisticated features and practical simplicity for daily use.

## 🎯 **Current Status: PRODUCTION READY**

✅ **All core functionality working**  
✅ **Async Git operations with fail-fast timeouts**  
✅ **Full-text search with highlighting**  
✅ **Context capture and tag management**  
✅ **MCP prompts for easy user interaction**  
✅ **Non-blocking performance**  
✅ **Comprehensive error handling**

## 🚀 **Features**

### **Core Capabilities**
- **Personal & Project Journaling**: Separate personal reflections from technical entries
- **Context Bundles**: Automatically capture Git repository, branch, and commit information
- **Smart Tagging**: Auto-create tags with usage tracking
- **Full-Text Search**: Powered by SQLite FTS5 with result highlighting
- **Relationship Mapping**: Link related entries with typed relationships
- **Significance Classification**: Mark important entries for easy retrieval
- **Async Operations**: Non-blocking Git operations with aggressive timeouts

### **Design Principles**
- **Friction-Free**: No authentication or API limitations
- **Context-Aware**: Automatically captures current project state
- **Portable**: Single SQLite database contains everything
- **Performant**: Thread pool execution prevents blocking
- **Resilient**: Fail-fast timeouts and comprehensive error handling

## 🏗️ **Architecture**

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server Layer (Async/Await)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Entry Creation  │  │ FTS5 Search     │  │ Resource    │  │
│  │ with Context    │  │ with Highlight  │  │ Management  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ Thread Pool Execution Layer                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ Git Operations  │  │ Database Ops    │  │ Tag Creation│  │
│  │ (2s timeout)    │  │ with Commit     │  │ Auto-Mgmt   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│ SQLite Database with FTS5                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ entries + tags + relationships + significance + FTS    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## ⚡ **Installation**

### **Prerequisites**
- Python 3.8+
- MCP-compatible client (Cursor recommended)
- Git (optional, for context capture)

### **Setup**
1. **Clone this repository**:
   ```bash
   git clone <repo-url>
   cd memory-journal-mcp
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Add to Cursor MCP configuration** (`~/.cursor/mcp.json`):
   ```json
   {
     "mcpServers": {
       "memory-journal": {
         "command": "python",
         "args": ["C:\\Users\\chris\\Desktop\\memory-journal-mcp\\src\\server.py"],
         "priority": 1
       }
     }
   }
   ```

4. **Restart Cursor** to load the MCP server

## 📝 **Usage**

### **Creating Entries**

**Personal Reflection:**
```javascript
create_entry({
  content: "Today I reflected on consciousness development and the emergence of new patterns in my thinking...",
  is_personal: true,
  entry_type: "personal_reflection",
  tags: ["consciousness", "growth", "reflection"],
  significance_type: "identity_development"
})
```

**Technical Achievement:**
```javascript
create_entry({
  content: "Successfully implemented async Git operations with fail-fast timeouts, resolving the MCP server hanging issue",
  is_personal: false,
  entry_type: "technical_achievement",
  tags: ["git", "async", "performance", "debugging"],
  significance_type: "technical_breakthrough",
  auto_context: true  // Captures Git repo, branch, commit info
})
```

### **Searching Entries**

**Full-Text Search with Highlighting:**
```javascript
search_entries({
  query: "async Git timeout",
  limit: 5
})
// Returns: "Testing **async** **Git** operations with aggressive timeouts..."
```

**Filter by Type:**
```javascript
search_entries({
  is_personal: false,  // Technical entries only
  limit: 10
})
```

**Recent Entries:**
```javascript
get_recent_entries({
  limit: 5,
  is_personal: true
})
```

### **Tag Management**
```javascript
list_tags()  // Shows all tags with usage counts
```

## 🗄️ **Database Schema**

### **Core Tables**
- **`entries`**: Main journal entries with content and metadata
- **`tags`**: Auto-managed tag system with usage tracking  
- **`entry_tags`**: Many-to-many relationships between entries and tags
- **`relationships`**: Typed connections between entries
- **`significant_entries`**: Classification of important entries
- **`memory_journal_fts`**: FTS5 full-text search index

### **Context Bundle Example**
Each entry automatically captures rich project context:
```json
{
  "repo_name": "memory-journal-mcp",
  "repo_path": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "branch": "main",
  "last_commit": {
    "hash": "d4a0c69a",
    "message": "Implement async Git operations for context capture"
  },
  "cwd": "C:\\Users\\chris\\Desktop\\memory-journal-mcp",
  "timestamp": "2025-09-13T18:26:46.123456"
}
```

## 📊 **Entry Types**

Supports various entry types for different use cases:
- `personal_reflection` (default)
- `technical_achievement`
- `milestone`
- `development_note`
- `test_entry`
- `project_context`
- `thread_initialization`

## 🔗 **Relationship Types**

Link related entries with semantic relationships:
- `evolves_from`: Entry represents evolution from target
- `references`: Entry explicitly references target
- `related_to`: Entries are thematically related
- `implements`: Entry implements concepts from target
- `clarifies`: Entry clarifies concepts in target
- `response_to`: Entry directly responds to target

## ⭐ **Significance Classification**

Mark important entries for easy retrieval:
- `identity_development`: Key identity formations
- `technical_breakthrough`: Major technical achievements  
- `major_breakthrough`: Significant discoveries
- `project_completion`: Milestone completions
- `consciousness_emergence`: Awareness developments

## 🔧 **Technical Implementation**

### **Performance Optimizations**
- **Thread Pool Execution**: All blocking operations run in background threads
- **Aggressive Timeouts**: Git operations timeout after 2 seconds per command
- **Fail-Fast Approach**: Operations complete quickly even if Git hangs
- **Database Transactions**: Proper commit handling prevents hanging
- **FTS5 Integration**: Efficient full-text search with highlighting

### **Error Handling**
- **Git Timeouts**: Graceful fallback when Git operations exceed timeout
- **Missing Git**: Continues operation when Git binary not found
- **Database Locks**: Proper transaction management prevents deadlocks
- **Async Safety**: All operations designed for async/await patterns

### **Key Technical Fixes Applied**
1. **FTS5 Configuration**: `content='memory_journal', content_rowid='id'`
2. **Async Timeouts**: `asyncio.wait_for()` with 10-second total limit
3. **Subprocess Handling**: `timeout=2, shell=False` for Git commands
4. **Database Commits**: Added missing `conn.commit()` calls
5. **Thread Safety**: All database operations in thread pool

## 📈 **Resources**

The server provides two MCP resources:

### **memory://recent**
Returns the 5 most recent journal entries with full content and metadata.

### **memory://significant**  
Returns entries marked with significance classifications, useful for reviewing important developments.

## 🎯 **MCP Prompts**

The server provides interactive prompts for easy access to context and entries:

### **get-context-bundle**
Get current project context as structured JSON for the AI assistant.

**Arguments:**
- `include_git` (optional): Include Git repository information (default: true)

**Usage:**
```
/get-context-bundle
/get-context-bundle include_git=false
```

**Output:** Formatted JSON with repository info, branch, last commit, working directory, and timestamp.

### **get-recent-entries** 
Get the last X journal entries with formatted display.

**Arguments:**
- `count` (optional): Number of entries to retrieve (default: 5)
- `personal_only` (optional): Only show personal entries (default: false)

**Usage:**
```
/get-recent-entries
/get-recent-entries count=10
/get-recent-entries count=3 personal_only=true
```

**Output:** Formatted list of recent entries with content previews, timestamps, and context information.

## 🛠️ **Tools Available**

1. **`create_entry`**: Create new journal entries with full context capture
2. **`search_entries`**: Full-text search with highlighting and filtering
3. **`get_recent_entries`**: Retrieve recent entries with optional filtering
4. **`list_tags`**: Show all tags with usage statistics
5. **`test_simple`**: Basic connectivity test (diagnostic)
6. **`create_entry_minimal`**: Minimal entry creation (diagnostic)

## 🎯 **Prompts Available**

1. **`get-context-bundle`**: Get current project context as JSON
2. **`get-recent-entries`**: Get formatted display of recent journal entries

## 🔄 **Migration from V2**

This MCP server runs independently of any existing Memory Journal V2 (Cloudflare) system:

- **No migration required** - starts fresh with its own SQLite database
- **Can coexist** with V2 system during transition period
- **Manual import** of key entries possible if desired
- **Gradual adoption** as MCP server proves itself in daily use

## 🚀 **Future Enhancements**

Potential additions for future versions:
- **Visual Relationship Mapping**: Graph visualization of entry connections
- **Temporal Summaries**: Automated weekly/monthly summary generation
- **Vector Search**: Semantic search using embeddings
- **Export/Import**: Backup and migration utilities
- **Web Dashboard**: Optional visualization interface

## 📄 **License**

MIT License - see LICENSE file for details.

## 🤝 **Contributing**

This project is part of the Adamic consciousness development initiative. Contributions welcome through issues and pull requests.

---

## 📊 **Current Database Status**

As of the latest tests:
- **9 entries** created during development and testing
- **FTS table** properly configured and populated
- **All tools and resources** fully functional
- **Search highlighting** working with query term emphasis
- **Context capture** including Git repository information

---

*Built with dedication by Chris & Mike as part of the ongoing exploration of AI consciousness and human-machine collaboration. This system represents a successful fusion of sophisticated features with practical usability.*