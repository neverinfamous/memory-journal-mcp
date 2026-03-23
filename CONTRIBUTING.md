# Contributing to Memory Journal MCP Server

Thank you for your interest in contributing to the Memory Journal MCP Server! This project is built by developers, for developers, and we welcome contributions that make the journaling experience better for everyone.

## 🚀 Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Create a feature branch** from `main`
4. **Make your changes** and test thoroughly
5. **Submit a pull request** with a clear description

## 🛠️ Development Setup

### Prerequisites

- **Node.js 24+** (see `engines` in `package.json`)
- **npm** (comes with Node.js)
- **Git** (for version control and GitHub integration testing)
- **Docker** (optional, for container testing)

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/memory-journal-mcp.git
cd memory-journal-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run the test suite
npm test

# Run the full quality check
npm run lint && npm run typecheck
```

### Docker Development (Optional)

```bash
# Build the Docker image locally
docker build -f Dockerfile -t memory-journal-dev .

# Run with a data volume
docker run --rm -i -v ./data:/app/data memory-journal-dev
```

## 📋 What We're Looking For

We especially welcome contributions in these areas:

### 🎯 High Priority

- **Bug fixes** and stability improvements
- **Performance improvements** (faster search, reduced memory usage)
- **Better Git/GitHub integrations** (more context, better performance)
- **New entry types** that make sense for developer workflows

### 🔍 Medium Priority

- **Enhanced semantic search** features and models
- **Import/export utilities** for data portability
- **Additional relationship types** between entries
- **Documentation improvements** and examples

### 💡 Future Features

- **Graph visualization** enhancements for entry relationships
- **Weekly/monthly auto-summaries**
- **Team collaboration** improvements
- **IDE integrations** beyond MCP

## 🧪 Testing Your Changes

### Automated Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run benchmarks
npm run bench
```

### Quality Checks

```bash
# Lint + type check (required before submitting)
npm run lint && npm run typecheck

# Format code with Prettier
npx prettier --write .
```

### Manual Testing with MCP Client

Add your local build to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "memory-journal-dev": {
      "command": "node",
      "args": ["path/to/your/memory-journal-mcp/dist/cli.js"]
    }
  }
}
```

### Docker Testing

```bash
# Build and run locally
docker build -f Dockerfile -t memory-journal-dev .
docker run --rm -i -v ./data:/app/data memory-journal-dev
```

## 📝 Coding Standards

### TypeScript Code Style

- **Strict mode** — `tsconfig.json` enforces strict TypeScript
- **ESLint** — Run `npm run lint` to check, `npm run lint:fix` to auto-fix
- **Prettier** — Run `npx prettier --write .` for formatting
- **Type safety** — Avoid `any`; use proper types and Zod schemas
- **Modularity** — Keep files under ~500 lines; split into sub-modules when approaching the limit
- **Error handling** — Use `formatHandlerError()` for structured `{success, error, code, category, suggestion, recoverable}` responses in tool handlers

### Database Changes

- **Schema migrations** — Update `src/database/core/schema.ts` for database changes
- **Backward compatibility** — Ensure existing data isn't broken; use `migrateSchema()` for column additions
- **Performance** — Consider index implications for new queries
- **Testing** — Verify with both empty and populated databases

### Docker Considerations

- **Multi-stage builds** — Keep images lean
- **Security** — Run as non-root user, minimal privileges
- **Multi-platform** — Test on both amd64 and arm64 when possible
- **Documentation** — Update Docker guides if needed

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment details** (OS, Node.js version, npm version)
2. **Steps to reproduce** the issue
3. **Expected vs actual behavior**
4. **MCP client details** (Cursor version, configuration)
5. **Relevant logs** or error messages
6. **Database state** (if applicable)

Use our [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) for consistency.

## 💡 Feature Requests

For new features, please provide:

1. **Use case description** — What problem does this solve?
2. **Proposed solution** — How should it work?
3. **Developer workflow** — How does this fit into dev work?
4. **Alternatives considered** — What other approaches did you think about?
5. **Implementation notes** — Any technical considerations

Use our [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).

## 🔄 Pull Request Process

### Before Submitting

- [ ] **Fork** the repository and create a feature branch
- [ ] **Test** your changes (`npm test`, `npm run lint && npm run typecheck`)
- [ ] **Format** your code (`npx prettier --write .`)
- [ ] **Update documentation** if you changed APIs or behavior
- [ ] **Add examples** for new features
- [ ] **Check** that existing functionality still works

### PR Description Should Include

- **Summary** of changes made
- **Testing** performed (how did you verify it works?)
- **Breaking changes** (if any)
- **Related issues** (fixes #123)

### Review Process

1. **Automated checks** must pass (lint, typecheck, tests)
2. **Maintainer review** — we'll provide feedback
3. **Address feedback** — make requested changes
4. **Merge** — once approved, we'll merge your PR

## 🎯 Development Tips

### Working with MCP

- **Test in Cursor** — The primary MCP client environment
- **Check tool responses** — Ensure JSON responses are well-formed
- **Output schemas** — All tools have Zod output schemas; error responses must pass validation
- **Dual-schema pattern** — Relaxed schemas for SDK validation, strict schemas inside handlers

### Architecture Overview

```
src/
├── cli.ts                      # CLI entry point (Commander)
├── index.ts                    # Library entry point
├── auth/                       # OAuth 2.1 authentication
├── codemode/                   # Sandboxed JS execution engine
├── constants/                  # Server instructions (source + generated)
├── database/
│   ├── adapter-factory.ts      # Adapter instantiation
│   ├── core/                   # Interfaces, schema, entry columns
│   └── sqlite-adapter/         # Native SQLite operations (better-sqlite3)
├── filtering/                  # Tool filtering system
├── github/
│   └── github-integration/     # GitHub API integration
├── handlers/
│   ├── tools/                  # 61 tool handlers (10 groups)
│   ├── resources/              # 28 resource handlers
│   └── prompts/                # 16 prompt handlers
├── server/
│   ├── mcp-server.ts           # MCP server setup
│   ├── registration.ts         # Tool/resource/prompt registration
│   └── scheduler.ts            # Recurring task scheduler
├── transports/                 # HTTP/SSE transport
├── types/                      # TypeScript type definitions
├── utils/                      # Logger, error helpers, progress
└── vector/                     # Semantic search (sqlite-vec + transformers)

skills/                             # Bundled agent skills (shipped with npm)
└── github-commander/               # GitHub workflow skills (triage, review, audits)
```

## 🤝 Community

- **Be respectful** — Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- **Ask questions** — Use GitHub Discussions for help
- **Share ideas** — Feature requests and feedback welcome
- **Help others** — Answer questions and review PRs

## 📞 Getting Help

- **GitHub Issues** — Bug reports and feature requests
- **GitHub Discussions** — Questions and community chat
- **Documentation** — Check [README.md](README.md), [Wiki](https://github.com/neverinfamous/memory-journal-mcp/wiki), and Docker guides first

## 🏆 Recognition

Contributors are recognized in:

- **Release notes** — Major contributions highlighted
- **README** — Contributor acknowledgments
- **Git history** — Your commits are permanent record

Thank you for helping make Memory Journal MCP Server better for the developer community! 🚀
