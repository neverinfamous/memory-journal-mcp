# 🐳 Docker Hub Publishing Instructions

## Quick Commands to Publish

Run these commands from the `memory-journal-mcp` directory:

### 1. Build Both Images
```bash
# Build lite version (fast, ~200MB)
docker build -f Dockerfile.lite -t writenotenow/memory-journal-mcp:lite .

# Build full version (with ML, ~2GB) 
docker build -f Dockerfile -t writenotenow/memory-journal-mcp:latest .
docker build -f Dockerfile -t writenotenow/memory-journal-mcp:full .
```

### 2. Push to Docker Hub
```bash
# Push lite version
docker push writenotenow/memory-journal-mcp:lite

# Push full versions
docker push writenotenow/memory-journal-mcp:latest
docker push writenotenow/memory-journal-mcp:full
```

### 3. Test the Published Images
```bash
# Test lite version
docker pull writenotenow/memory-journal-mcp:lite
docker run --rm -v ./data:/app/data writenotenow/memory-journal-mcp:lite python -c "print('✅ Lite version works!')"

# Test full version  
docker pull writenotenow/memory-journal-mcp:latest
docker run --rm -v ./data:/app/data writenotenow/memory-journal-mcp:latest python -c "print('✅ Full version works!')"
```

## After Publishing

Update the README.md with the new Docker Hub instructions:

```bash
# Quick start becomes:
docker pull writenotenow/memory-journal-mcp:lite
docker run -v ./data:/app/data writenotenow/memory-journal-mcp:lite
```

## Repository Info

- **Docker Hub**: https://hub.docker.com/r/writenotenow/memory-journal-mcp
- **Namespace**: writenotenow  
- **Repository**: memory-journal-mcp
- **Tags**: 
  - `lite` - Core features, no semantic search (~200MB)
  - `latest` / `full` - Complete with semantic search (~2GB)

## Expected Build Times

- **Lite version**: ~2-3 minutes
- **Full version**: ~10-15 minutes (downloads PyTorch, etc.)

Once published, users can skip the build step entirely! 🚀