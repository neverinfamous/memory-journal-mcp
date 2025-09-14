# Docker Deployment Setup Guide

## 🚀 Automated Docker Deployment

This repository is configured for **automatic Docker image deployment** to Docker Hub on every push to the `main` branch and on tagged releases.

## 📋 Required GitHub Secrets

Before the Docker deployment workflow can run, you need to add these secrets to your GitHub repository:

### 1. Navigate to Repository Settings
1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### 2. Add Required Secrets

#### `DOCKER_USERNAME`
- **Value**: `writenotenow` (your Docker Hub username)
- **Description**: Docker Hub username for authentication

#### `DOCKER_PASSWORD`
- **Value**: Your Docker Hub access token (NOT your password)
- **Description**: Docker Hub access token for secure authentication

### 3. Generate Docker Hub Access Token

1. Go to [Docker Hub](https://hub.docker.com)
2. Click your avatar → **Account Settings**
3. Go to **Security** → **Personal Access Tokens**
4. Click **Generate New Token**
5. Name: `GitHub-Actions-memory-journal-mcp`
6. Permissions: **Read, Write, Delete**
7. Copy the token and use it as `DOCKER_PASSWORD`

## 🏗️ What Gets Built

### Image Variants
- **`:lite`** - Lightweight version (116MB) without ML dependencies
- **`:latest`** - Full version (4.3GB) with semantic search capabilities

### Supported Platforms
- **Lite**: `linux/amd64`, `linux/arm64` (Apple Silicon support)
- **Full**: `linux/amd64` only (CUDA dependencies)

### Tags Generated
- `latest` and `latest-lite` (from main branch)
- `v1.0.0` and `v1.0.0-lite` (from git tags)
- `main` and `main-lite` (from main branch pushes)

## 🔄 Deployment Triggers

### Automatic Deployment
- ✅ **Push to main** → Builds and pushes `:latest` and `:latest-lite`
- ✅ **Create git tag** → Builds and pushes versioned tags (e.g., `:v1.0.0-lite`)
- ✅ **Pull requests** → Builds images for testing (doesn't push)

### Manual Deployment
```bash
# Create and push a release tag
git tag v1.0.1
git push origin v1.0.1
# This will trigger deployment of v1.0.1-lite and v1.0.1 images
```

## 🛡️ Security Features

### Vulnerability Scanning
- **Trivy scanner** runs on every deployment
- **Results uploaded** to GitHub Security tab
- **SARIF format** for integration with GitHub Advanced Security

### Image Optimization
- **Multi-stage builds** keep images lean
- **Layer caching** speeds up builds
- **GitHub Actions cache** reduces build times

## 📦 What's Excluded from Docker Images

The `.dockerignore` file filters out GitHub-specific files:

```
.github/                 # GitHub workflows and templates
CODE_OF_CONDUCT.md      # Community files
CONTRIBUTING.md         # Development docs
SECURITY.md             # Security policy
docker-compose.yml      # Development compose file
*.db                    # Database files
.git/                   # Git history
```

## 🎯 Docker Hub Integration

### Automatic Description Updates
- **README.md** automatically synced to Docker Hub
- **Updated on main branch** pushes
- **Keeps documentation** in sync between GitHub and Docker Hub

### Repository Settings
- **Repository**: `writenotenow/memory-journal-mcp`
- **Visibility**: Public
- **Description**: Auto-synced from README.md

## ⚡ Build Performance

### Optimizations
- **Parallel builds** for lite and full variants
- **GitHub Actions cache** for Docker layers
- **Multi-platform builds** using QEMU and Buildx
- **Conditional builds** (full image only on x86_64)

### Build Times (Estimated)
- **Lite image**: ~3-5 minutes
- **Full image**: ~15-20 minutes (ML dependencies)
- **Cached builds**: ~1-2 minutes

## 🧪 Testing

### Automated Tests
- **Import testing** verifies Python modules load correctly
- **Smoke tests** ensure server starts without errors
- **Multi-platform** testing for lite variant

### Manual Testing
```bash
# Test latest lite build
docker pull writenotenow/memory-journal-mcp:latest-lite
docker run --rm writenotenow/memory-journal-mcp:latest-lite python -c "print('✅ Works!')"

# Test full build
docker pull writenotenow/memory-journal-mcp:latest
docker run --rm writenotenow/memory-journal-mcp:latest python -c "print('✅ Full version works!')"
```

## 🚨 Troubleshooting

### Common Issues

1. **Build fails with authentication error**
   - Check `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets
   - Verify Docker Hub access token has correct permissions

2. **Multi-platform build fails**
   - ARM64 builds may timeout for full variant
   - Lite variant should build successfully on both platforms

3. **Vulnerability scan fails**
   - Check Trivy scanner results in Actions logs
   - Update base images if critical vulnerabilities found

### Monitoring
- **GitHub Actions** tab shows build status
- **Docker Hub** shows image sizes and pull stats
- **Security tab** shows vulnerability scan results

## 📈 Usage Analytics

After deployment, monitor:
- **Docker Hub pulls** - Download statistics
- **GitHub releases** - Version adoption
- **Security alerts** - Vulnerability notifications
- **Build success rate** - CI/CD health