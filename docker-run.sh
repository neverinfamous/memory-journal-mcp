#!/bin/bash
# Memory Journal MCP Server - Docker Runner
# This script makes it easy to run the containerized MCP server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
IMAGE_NAME="memory-journal-mcp"
CONTAINER_NAME="memory-journal-mcp"
DATA_DIR="./data"
LITE_MODE=false

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --lite)
            LITE_MODE=true
            IMAGE_NAME="memory-journal-mcp-lite"
            CONTAINER_NAME="memory-journal-mcp-lite"
            shift
            ;;
        --data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Memory Journal MCP Server - Docker Runner"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --lite              Use lite version (no semantic search)"
            echo "  --data-dir DIR      Specify data directory (default: ./data)"
            echo "  --help, -h          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                  Run full version with semantic search"
            echo "  $0 --lite           Run lite version (faster, no ML dependencies)"
            echo "  $0 --data-dir /my/data  Use custom data directory"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

print_status "Starting Memory Journal MCP Server..."

# Create data directory if it doesn't exist
if [ ! -d "$DATA_DIR" ]; then
    print_status "Creating data directory: $DATA_DIR"
    mkdir -p "$DATA_DIR"
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Build the appropriate image
if [ "$LITE_MODE" = true ]; then
    print_status "Building lite version (no semantic search)..."
    docker build -f Dockerfile.lite -t "$IMAGE_NAME" .
else
    print_status "Building full version (with semantic search)..."
    print_warning "This may take several minutes due to ML dependencies..."
    docker build -t "$IMAGE_NAME" .
fi

# Stop and remove existing container if it exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    print_status "Stopping and removing existing container..."
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" > /dev/null 2>&1 || true
fi

# Run the container
print_status "Starting container..."

# Mount git config if available
GIT_MOUNT=""
if [ -f "$HOME/.gitconfig" ]; then
    GIT_MOUNT="-v $HOME/.gitconfig:/root/.gitconfig:ro"
fi

# Mount SSH keys if available (for GitHub access)
SSH_MOUNT=""
if [ -d "$HOME/.ssh" ]; then
    SSH_MOUNT="-v $HOME/.ssh:/root/.ssh:ro"
fi

# Run the container with appropriate mounts
docker run -d \
    --name "$CONTAINER_NAME" \
    -v "$(pwd)/$DATA_DIR:/app/data" \
    $GIT_MOUNT \
    $SSH_MOUNT \
    -e DB_PATH=/app/data/memory_journal.db \
    -e PYTHONPATH=/app \
    --restart unless-stopped \
    "$IMAGE_NAME"

# Wait a moment for the container to start
sleep 2

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    print_success "Memory Journal MCP Server is running!"
    echo ""
    echo "Container: $CONTAINER_NAME"
    echo "Data directory: $DATA_DIR"
    if [ "$LITE_MODE" = true ]; then
        echo "Mode: Lite (no semantic search)"
    else
        echo "Mode: Full (with semantic search)"
    fi
    echo ""
    echo "To view logs: docker logs $CONTAINER_NAME"
    echo "To stop: docker stop $CONTAINER_NAME"
    echo "To restart: docker restart $CONTAINER_NAME"
    echo ""
    print_status "Configure your MCP client to connect to the running container."
else
    print_error "Failed to start container. Check logs with: docker logs $CONTAINER_NAME"
    exit 1
fi
