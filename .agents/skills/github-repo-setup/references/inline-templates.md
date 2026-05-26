### Inline Templates

#### LICENSE

```
MIT License

Copyright (c) {{YEAR}} Adamic.tech

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### CHANGELOG.md

```markdown
# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).
```

#### UNRELEASED.md

```markdown
## [Unreleased]
```

#### .gitattributes

```gitattributes
# Normalize line endings to LF on all platforms
* text=auto eol=lf

# Windows-specific scripts that require CRLF
*.bat text eol=crlf
*.cmd text eol=crlf

# Docker
Dockerfile text eol=lf
.dockerignore text eol=lf

# Explicitly binary
*.db binary
*.wasm binary
*.png binary
*.jpg binary
*.ico binary
```

#### .gitignore

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
build/
out/

# Environment files
.env
.env.local
.env.*.local
.dev.vars

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*

# OS files
.DS_Store
Thumbs.db

# Editor directories and files
.gemini/
.vscode/*
!.vscode/settings.json
.idea/
*.swp
*.swo
*~

# Test coverage
coverage/
.nyc_output/
test-results.json

# Playwright
test-results/
playwright-report/

# TypeScript
*.tsbuildinfo

# Optional npm/eslint cache
.npm
.eslintcache
eslint-results.json

# Database files
data/
*.db
*.db-shm
*.db-wal
*.db-journal
*.sqlite
*.sqlite-shm
*.sqlite-wal

# Credentials
*.pem
*.key

# MCP Registry tokens
.mcpregistry_github_token
.mcpregistry_registry_token

# Alternative lock files
yarn.lock
pnpm-lock.yaml

# Temporary files
tmp/
temp/
*.tmp
```

#### package.json

```json
{
  "name": "{{REPO_NAME}}",
  "version": "0.1.0",
  "description": "{{DESCRIPTION}}",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "{{REPO_NAME}}": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "bench": "vitest bench --run",
    "clean": "rimraf dist"
  },
  "keywords": [],
  "author": "neverinfamous",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/neverinfamous/{{REPO_NAME}}.git"
  },
  "bugs": {
    "url": "https://github.com/neverinfamous/{{REPO_NAME}}/issues"
  },
  "homepage": "https://github.com/neverinfamous/{{REPO_NAME}}#readme",
  "engines": {
    "node": ">=24.0.0"
  },
  "dependencies": {},
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@playwright/test": "^1.58.2",
    "@types/node": "^25.4.0",
    "@vitest/coverage-v8": "^4.0.18",
    "eslint": "^10.0.2",
    "globals": "^17.4.0",
    "rimraf": "^6.1.3",
    "tsup": "^8.5.1",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.57.1",
    "vitest": "^4.0.17"
  }
}
```
