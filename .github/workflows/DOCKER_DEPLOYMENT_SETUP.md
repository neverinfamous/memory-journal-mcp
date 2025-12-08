# Docker Deployment Setup Guide

*Last Updated: December 8, 2025 - Production/Stable v2.2.0*

## 🚀 Automated Docker Deployment

This repository is configured for **automatic Docker image deployment** to Docker Hub on every push to the `main` branch and on tagged releases.

## 📋 Current Status

### ✅ Production-Ready Deployment
- **Version**: v2.2.0 (Production/Stable)
- **Base Image**: `python:3.13-alpine` (Alpine Linux 3.22)
- **Docker Hub**: `writenotenow/memory-journal-mcp`
- **Image Size**: ~225MB (Alpine-based with full ML capabilities)
- **Platforms**: `linux/amd64`, `linux/arm64` (Apple Silicon support)

### 🔒 Security Posture
- **OpenSSL**: 3.5.4-r0 (latest)
- **curl**: 8.14.1-r2 (latest)
- **expat**: 2.7.3-r0 (latest)
- **pip**: ≥25.0
- **setuptools**: ≥78.1.1

## 📦 Required GitHub Secrets

Before the Docker deployment workflow can run, you need to add these secrets to your GitHub repository:

### 1. Navigate to Repository Settings
1. Go to your repository on GitHub: https://github.com/neverinfamous/memory-journal-mcp
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### 2. Required Secrets

#### `DOCKER_USERNAME`
- **Value**: `writenotenow` (Docker Hub username)
- **Description**: Docker Hub username for authentication
- **Status**: ✅ Configured

#### `DOCKER_PASSWORD`
- **Value**: Docker Hub access token (NOT your password)
- **Description**: Docker Hub access token for secure authentication
- **Status**: ✅ Configured

### 3. Generate Docker Hub Access Token (If Needed)

1. Go to [Docker Hub](https://hub.docker.com)
2. Click your avatar → **Account Settings**
3. Go to **Security** → **Personal Access Tokens**
4. Click **Generate New Token**
5. Name: `GitHub-Actions-memory-journal-mcp`
6. Permissions: **Read, Write, Delete**
7. Copy the token and use it as `DOCKER_PASSWORD`

## 🏗️ What Gets Built

### Image Configuration
- **Single Variant**: Alpine-based full-featured image (225MB)
- **ML Support**: Optional semantic search with graceful degradation
  - ARM64: ML dependencies fail to install, continues without semantic search ✅
  - AMD64: Full ML support with PyTorch, FAISS, sentence-transformers ✅
- **Base**: Python 3.13 on Alpine Linux 3.22

### Supported Platforms
- **linux/amd64** - x86_64 architecture (full features)
- **linux/arm64** - Apple Silicon / ARM64 (core features, optional ML)

### Tags Generated on Each Push
When you push to `main` branch, the workflow automatically creates:
- `latest` - Always points to most recent main branch build
- `v2.2.0` - Current version from pyproject.toml (automatically extracted)
- `sha-XXXXXXX` - Git commit SHA pinned tag (short format)

## 🔄 Deployment Triggers

### Automatic Deployment
- ✅ **Push to main** → Builds and pushes all tags
- ✅ **Create git tag** → Builds and pushes versioned tags (e.g., `v1.1.3`)
- ✅ **Pull requests** → Builds images for testing (doesn't push to Docker Hub)

### Manual Deployment
```bash
# Create and push a release tag
git tag v2.2.0
git push origin v2.2.0

# This will trigger deployment with tags:
# - v2.2.0
# - latest
# - sha-XXXXXXX
```

## 🛡️ Security Features

### Multi-Layer Security Scanning
1. **Docker Scout CLI** - Runs during build, blocks critical/high vulnerabilities
   - Scans single-platform (linux/amd64) image locally
   - 8-minute timeout for efficient CI/CD
   - Blocks deployment if critical/high CVEs detected
   - Allows low/medium severity (acceptable risk)

2. **Trivy Scanner** (Weekly scheduled scan)
   - Runs every Sunday at 2 AM UTC
   - Creates GitHub issues for vulnerabilities
   - Uploads SARIF results to Security tab
   - Exit code 1 on critical/high/medium issues

### Image Optimization
- **Multi-stage builds** keep images lean (225MB)
- **Layer caching** speeds up builds significantly
- **GitHub Actions cache** reduces build times by ~60%
- **Non-root user** (appuser:appgroup) for container security
- **WAL mode** for better concurrency and crash recovery

### Supply Chain Security
- **Attestations**: Enabled for all images
- **Provenance**: Full build provenance tracking
- **SBOM**: Software Bill of Materials generated
- **Signature**: Docker content trust compatible

## 📦 What's Excluded from Docker Images

The `.dockerignore` file filters out development files:

```
.github/                 # GitHub workflows and templates
.git/                    # Git history
__pycache__/            # Python cache
*.pyc                   # Compiled Python
*.pyo                   # Optimized Python
*.db                    # Database files
.venv/                  # Virtual environments
dist/                   # Build artifacts
*.egg-info/             # Package metadata
.pytest_cache/          # Test cache
htmlcov/                # Coverage reports
```

## 🎯 Docker Hub Integration

### Automatic Updates
- **Tags**: Automatically created and pushed
- **Attestations**: Supply chain metadata attached to all tags
- **SBOM**: Software Bill of Materials for each build
- **Multi-arch manifests**: Single tag works on AMD64 and ARM64

### Repository Information
- **Repository**: `writenotenow/memory-journal-mcp`
- **Visibility**: Public
- **URL**: https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **Pulls**: Tracked by Docker Hub analytics

## ⚡ Build Performance

### Optimizations Implemented
- **Parallel builds** for AMD64 and ARM64
- **GitHub Actions cache** for Docker layers
- **Multi-platform builds** using QEMU and Buildx
- **Graceful ML fallback** (continues without ML on ARM64)
- **Strategic layer ordering** (requirements → dependencies → code)

### Build Times (Actual)
- **AMD64 build**: ~3-4 minutes (with cache)
- **ARM64 build**: ~2-3 minutes (without ML dependencies)
- **Multi-platform total**: ~5-7 minutes
- **Security scanning**: ~30-60 seconds
- **First build (no cache)**: ~10-15 minutes

### Caching Strategy
- **Layer caching**: Maximizes Docker layer reuse
- **Package caching**: pip packages cached between builds
- **Base image caching**: Python Alpine image cached locally

## 🧪 Testing

### Automated CI/CD Tests

#### Test Matrix (Python 3.10, 3.11, 3.12)
- ✅ **Dependency installation** - All required packages
- ✅ **Linting** - flake8 code quality checks
- ✅ **Server import** - Python module loads correctly
- ✅ **Database schema** - SQLite schema validation

#### Docker Image Tests
- ✅ **Security scan** - Docker Scout CVE detection
- ✅ **Import test** - Server imports successfully in container
- ✅ **Multi-platform** - Both AMD64 and ARM64 verified
- ✅ **ML graceful degradation** - Continues without ML on ARM64

### Manual Testing

#### Quick Verification
```bash
# Test latest build
docker pull writenotenow/memory-journal-mcp:latest
docker run --rm writenotenow/memory-journal-mcp:latest python -c "import sys; sys.path.append('src'); import server; print('✅ Works!')"
```

#### Full Functional Test
```bash
# Create data directory
mkdir -p data

# Run server with volume mount
docker run --rm -i \
  -v ./data:/app/data \
  writenotenow/memory-journal-mcp:latest \
  python src/server.py
```

#### Test Specific Version
```bash
# Test by version tag
docker pull writenotenow/memory-journal-mcp:v2.2.0
docker run --rm writenotenow/memory-journal-mcp:v2.2.0 python -c "print('v2.2.0 works!')"

# Test by commit SHA
docker pull writenotenow/memory-journal-mcp:sha-XXXXXXX
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Build fails with authentication error
**Symptoms**: `Error saving credentials: error storing credentials`
**Solution**: 
- Verify `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets in GitHub
- Check Docker Hub access token hasn't expired
- Ensure token has Read, Write, Delete permissions

#### 2. ARM64 build warnings about ML dependencies
**Status**: ✅ Expected behavior, not an error
**Details**:
- PyTorch CPU builds not available for ARM64 Alpine
- Server continues without semantic search features
- Core functionality fully operational

#### 3. Security scan fails
**Symptoms**: Build blocked with "Critical or high severity vulnerabilities detected"
**Solution**:
1. Review Docker Scout output in Actions logs
2. Update base image in Dockerfile (`FROM python:3.13-alpine`)
3. Update pinned packages (openssl, curl, expat)
4. Commit and push changes to trigger new build

#### 4. Cache-related build failures
**Symptoms**: "Failed to save: Unable to reserve cache"
**Status**: ✅ Informational warning, not an error
**Details**: Another concurrent job may be writing to cache, image still builds successfully

### Monitoring

#### GitHub Actions
- **Build Status**: https://github.com/neverinfamous/memory-journal-mcp/actions
- **Workflow File**: `.github/workflows/docker-publish.yml`
- **Security Scans**: `.github/workflows/security-update.yml`

#### Docker Hub
- **Repository**: https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **Tags**: View all available tags
- **Image Layers**: Inspect layer sizes and contents
- **Security**: Docker Scout recommendations

#### GitHub Security Tab
- **SARIF Results**: Trivy scanner uploads
- **Dependabot Alerts**: Dependency vulnerabilities
- **Code Scanning**: Security analysis results

## 📈 Usage Analytics

### Metrics to Monitor

#### Docker Hub (Public)
- **Pull count** - Total downloads
- **Tag popularity** - Most-used versions
- **Geographic distribution** - User locations

#### GitHub (Private)
- **Build success rate** - CI/CD health
- **Build duration trends** - Performance monitoring
- **Security scan results** - Vulnerability tracking

## 🔄 Update Process

### Regular Updates (Recommended Monthly)

1. **Check for base image updates**
   ```bash
   docker pull python:3.13-alpine
   docker inspect python:3.13-alpine --format '{{.Created}}'
   ```

2. **Update pinned packages in Dockerfile**
   ```bash
   # Check latest Alpine package versions
   docker run --rm python:3.13-alpine sh -c "apk update && apk info openssl curl expat"
   ```

3. **Update Dockerfile with new versions**
   ```dockerfile
   RUN apk add --no-cache --upgrade openssl=<version> curl=<version> expat=<version>
   ```

4. **Commit and push to trigger rebuild**
   ```bash
   git add Dockerfile
   git commit -m "Update Docker base image with security fixes"
   git push origin main
   ```

5. **Monitor GitHub Actions** for successful build
   ```bash
   gh run list --limit 3
   gh run watch <run-id>
   ```

### Emergency Security Updates

If Docker Scout or Trivy detects critical vulnerabilities:

1. **Immediate action required** - Block deployments
2. **Review CVE details** in Actions logs or Security tab
3. **Update affected packages** in Dockerfile
4. **Test locally** before pushing
5. **Deploy fix immediately** to main branch

## 📚 Additional Resources

- **GitHub Wiki**: https://github.com/neverinfamous/memory-journal-mcp/wiki
- **PyPI Package**: https://pypi.org/project/memory-journal-mcp/
- **MCP Registry**: https://registry.modelcontextprotocol.io/
- **Docker Hub**: https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **GitHub Gists**: https://gist.github.com/neverinfamous/ffedec3bdb5da08376a381733b80c1a7

---

## 🏆 Current Build Status

✅ **Production/Stable** - All systems operational
- Latest version: v2.2.0
- Docker Scout: ✅ No critical/high vulnerabilities
- Multi-platform: ✅ AMD64 + ARM64 support
- Security packages: ✅ All at latest versions
- Image size: 225MB (optimized for deployment)
