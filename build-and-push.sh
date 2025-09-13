#!/bin/bash
# Build and push Memory Journal MCP Docker images

set -e

echo "🐳 Building Memory Journal MCP Docker images..."

# Build lite version
echo "Building lite version..."
docker build -f Dockerfile.lite -t writenotenow/memory-journal-mcp:lite .

# Build full version  
echo "Building full version..."
docker build -f Dockerfile -t writenotenow/memory-journal-mcp:latest .

# Tag latest as well
docker tag writenotenow/memory-journal-mcp:latest writenotenow/memory-journal-mcp:full

echo "✅ Images built successfully!"

echo "🚀 Pushing to Docker Hub..."

# Push lite version
echo "Pushing lite version..."
docker push writenotenow/memory-journal-mcp:lite

# Push full version
echo "Pushing full version..."
docker push writenotenow/memory-journal-mcp:latest
docker push writenotenow/memory-journal-mcp:full

echo "🎉 Successfully published to Docker Hub!"
echo ""
echo "Users can now run:"
echo "  docker pull writenotenow/memory-journal-mcp:lite"
echo "  docker pull writenotenow/memory-journal-mcp:latest"
echo ""