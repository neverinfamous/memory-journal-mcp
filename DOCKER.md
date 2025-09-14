# 🐳 Docker Installation Guide

The Memory Journal MCP server is now available as a Docker container, providing the **easiest and most reliable** installation method.

## 🎯 **Why Docker?**

Docker **solves the dependency installation issues** we encountered and provides:

- ✅ **Zero Dependency Issues**: All ML libraries pre-installed and working
- ✅ **Consistent Environment**: Same behavior across all systems  
- ✅ **Easy Distribution**: Single command deployment
- ✅ **Data Ownership**: Your SQLite database stays on your local machine
- ✅ **No Hosting Costs**: Runs entirely locally
- ✅ **Solves Python Environment Conflicts**: Isolated container environment

## 📋 **Docker Versions Available**

### **Lite Version** (Recommended for most users)
- ✅ **Fast build**: ~2 minutes
- ✅ **Small size**: ~200MB  
- ✅ **All core features**: entries, search, context bundles, prompts
- ❌ **No semantic search**: FTS5 search only

```bash
docker build -f Dockerfile.lite -t memory-journal-mcp-lite .
```

### **Full Version** (With semantic search)
- ✅ **Complete feature set**: including vector similarity search
- ✅ **Automatic embeddings**: sentence-transformers + FAISS
- ❌ **Larger build time**: ~10-15 minutes
- ❌ **Larger size**: ~2GB (due to PyTorch dependencies)

```bash
docker build -t memory-journal-mcp .
```

## 🚀 **Quick Start**

### 1. Clone and Build
```bash
git clone <your-repo-url>
cd memory-journal-mcp

# Build lite version (recommended)
docker build -f Dockerfile.lite -t memory-journal-mcp-lite .
```

### 2. Configure Cursor MCP
Add to your `~/.cursor/mcp.json`:

**Windows:**
```json
{
  "mcpServers": {
    "memory-journal-docker": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "C:\\Users\\YourName\\Desktop\\memory-journal-mcp\\data:/app/data",
        "-v", "C:\\Users\\YourName\\.gitconfig:/root/.gitconfig:ro",
        "-e", "DB_PATH=/app/data/memory_journal.db",
        "memory-journal-mcp-lite",
        "python", "src/server.py"
      ]
    }
  }
}
```

**Linux/Mac:**
```json
{
  "mcpServers": {
    "memory-journal-docker": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "/absolute/path/to/memory-journal-mcp/data:/app/data",
        "-v", "/home/user/.gitconfig:/root/.gitconfig:ro",
        "-e", "DB_PATH=/app/data/memory_journal.db",
        "memory-journal-mcp-lite",
        "python", "src/server.py"
      ]
    }
  }
}
```

### 3. Restart Cursor
The server will show as connected with all tools and prompts available!

## 🔧 **Advanced Usage**

### Using Docker Compose
```bash
# Run with docker-compose
docker-compose up -d

# Or run basic version
docker-compose --profile basic up -d
```

### Manual Container Management
```bash
# Run container manually
docker run -d \
  --name memory-journal-mcp \
  -v ./data:/app/data \
  -v ~/.gitconfig:/root/.gitconfig:ro \
  -e DB_PATH=/app/data/memory_journal.db \
  --restart unless-stopped \
  memory-journal-mcp-lite

# View logs
docker logs memory-journal-mcp

# Stop container
docker stop memory-journal-mcp
```

### Building Full Version with Semantic Search
```bash
# Build full version (takes longer)
docker build -t memory-journal-mcp .

# Update MCP config to use full version
# Change "memory-journal-mcp-lite" to "memory-journal-mcp" in your mcp.json
```

## 📁 **Data Persistence**

Your journal data is stored in the `./data/` directory and mounted into the container:
- **SQLite Database**: `./data/memory_journal.db`
- **Vector Embeddings**: Stored in SQLite BLOB fields
- **Full Ownership**: All data stays on your machine

## 🐛 **Troubleshooting**

### Container Won't Start
```bash
# Check container logs
docker logs memory-journal-mcp

# Test container manually
docker run --rm memory-journal-mcp-lite python -c "print('Container working!')"
```

### Permission Issues (Linux/Mac)
```bash
# Fix data directory permissions
sudo chown -R $(id -u):$(id -g) ./data/
```

### Git Context Not Working
Ensure git config is mounted:
```bash
# Check if git config exists
ls -la ~/.gitconfig

# Verify mount in container
docker run --rm -v ~/.gitconfig:/root/.gitconfig:ro memory-journal-mcp-lite cat /root/.gitconfig
```

## 🎉 **Benefits Achieved**

✅ **Solved dependency issues**: No more Python environment conflicts  
✅ **Consistent deployment**: Works the same everywhere  
✅ **Easy distribution**: Users can run with a single Docker command  
✅ **Local data ownership**: No cloud dependencies  
✅ **Production ready**: Robust, containerized deployment  

The Docker approach transforms the Memory Journal MCP from a development tool into a **production-ready, distributable application**!
