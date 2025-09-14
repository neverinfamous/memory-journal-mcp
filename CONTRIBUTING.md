# Contributing to Memory Journal MCP Server

Thank you for your interest in contributing to the Memory Journal MCP Server! This project is built by developers, for developers, and we welcome contributions that make the journaling experience better for everyone.

## 🚀 Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Create a feature branch** from `main`
4. **Make your changes** and test thoroughly
5. **Submit a pull request** with a clear description

## 🛠️ Development Setup

### Option 1: Docker Development (Recommended)
```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/memory-journal-mcp.git
cd memory-journal-mcp

# Build and test with Docker
docker build -f Dockerfile.alpine -t memory-journal-dev .
docker run --rm -v ./data:/app/data memory-journal-dev python src/server.py

# Test the MCP server
docker run --rm memory-journal-dev python -c "print('✅ MCP Server ready!')"
```

### Option 2: Local Development
```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/memory-journal-mcp.git
cd memory-journal-mcp

# Install dependencies
pip install -r requirements.txt

# Optional: Install semantic search dependencies
pip install sentence-transformers faiss-cpu

# Test the server
python src/server.py
```

## 📋 What We're Looking For

We especially welcome contributions in these areas:

### 🎯 High Priority
- **New entry types** that make sense for developer workflows
- **Better Git/GitHub integrations** (more context, better performance)
- **Performance improvements** (faster search, reduced memory usage)
- **Bug fixes** and stability improvements

### 🔍 Medium Priority  
- **Enhanced semantic search** features and models
- **Import/export utilities** for data portability
- **Additional relationship types** between entries
- **Documentation improvements** and examples

### 💡 Future Features
- **Graph visualization** of entry relationships
- **Weekly/monthly auto-summaries** 
- **Team collaboration** features
- **IDE integrations** beyond MCP

## 🧪 Testing Your Changes

### Manual Testing
```bash
# Test basic functionality
python -c "
import sys
sys.path.append('src')
from server import *
print('✅ Server imports successfully')
"

# Test with MCP client (Cursor)
# Add your local server to ~/.cursor/mcp.json:
{
  "mcpServers": {
    "memory-journal-dev": {
      "command": "python",
      "args": ["path/to/your/memory-journal-mcp/src/server.py"]
    }
  }
}
```

### Docker Testing
```bash
# Test alpine build
docker build -f Dockerfile.alpine -t test-alpine .
docker run --rm test-alpine python -c "print('Alpine build works!')"

# Test full build  
docker build -f Dockerfile -t test-full .
docker run --rm test-full python -c "print('Full build works!')"
```## 📝 Coding Standards

### Python Code Style
- **PEP 8 compliance** - Use `black` for formatting
- **Type hints** - Add type annotations for new functions
- **Docstrings** - Document public functions and classes
- **Async/await** - Use async patterns for I/O operations
- **Error handling** - Implement graceful fallbacks

### Database Changes
- **Schema migrations** - Update `src/schema.sql` for database changes
- **Backward compatibility** - Ensure existing data isn't broken
- **Performance** - Consider index implications for new queries
- **Testing** - Verify with both empty and populated databases

### Docker Considerations
- **Multi-stage builds** - Keep images lean
- **Security** - Run as non-root user, minimal privileges
- **Compatibility** - Test on both lite and full variants
- **Documentation** - Update Docker guides if needed

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment details** (OS, Python version, Docker version)
2. **Steps to reproduce** the issue
3. **Expected vs actual behavior**
4. **MCP client details** (Cursor version, configuration)
5. **Relevant logs** or error messages
6. **Database state** (if applicable)

Use our [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) for consistency.

## 💡 Feature Requests

For new features, please provide:

1. **Use case description** - What problem does this solve?
2. **Proposed solution** - How should it work?
3. **Developer workflow** - How does this fit into dev work?
4. **Alternatives considered** - What other approaches did you think about?
5. **Implementation notes** - Any technical considerations

Use our [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).

## 🔄 Pull Request Process

### Before Submitting
- [ ] **Fork** the repository and create a feature branch
- [ ] **Test** your changes thoroughly (manual + Docker)
- [ ] **Update documentation** if you changed APIs or behavior
- [ ] **Add examples** for new features
- [ ] **Check** that existing functionality still works

### PR Description Should Include
- **Summary** of changes made
- **Testing** performed (how did you verify it works?)
- **Breaking changes** (if any)
- **Related issues** (fixes #123)
- **Screenshots** (for UI changes)

### Review Process
1. **Automated checks** must pass
2. **Maintainer review** - we'll provide feedback
3. **Address feedback** - make requested changes
4. **Merge** - once approved, we'll merge your PR

## 🎯 Development Tips

### Working with MCP
- **Test in Cursor** - The primary MCP client environment
- **Check tool responses** - Ensure JSON responses are well-formed
- **Handle timeouts** - Git operations should fail fast
- **Async safety** - All blocking operations in thread pools

### Database Development
- **Use WAL mode** - Already configured for concurrency
- **FTS5 integration** - Full-text search is performance-critical
- **Proper transactions** - Always commit changes
- **Index optimization** - Consider query performance

### Docker Development
```bash
# Quick rebuild and test cycle
docker build -f Dockerfile.alpine -t dev-test . && \
docker run --rm -v ./data:/app/data dev-test python src/server.py
```

## 🤝 Community

- **Be respectful** - Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- **Ask questions** - Use GitHub Discussions for help
- **Share ideas** - Feature requests and feedback welcome
- **Help others** - Answer questions and review PRs

## 📞 Getting Help

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - Questions and community chat
- **Documentation** - Check README.md and Docker guides first

## 🏆 Recognition

Contributors are recognized in:
- **Release notes** - Major contributions highlighted
- **README** - Contributor acknowledgments
- **Git history** - Your commits are permanent record

Thank you for helping make Memory Journal MCP Server better for the developer community! 🚀