# Memory Journal MCP Server
# A containerized Model Context Protocol server for personal journaling
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for sentence-transformers and git
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install vector search dependencies with CPU-only PyTorch for smaller size
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu \
    sentence-transformers \
    faiss-cpu

# Copy source code
COPY src/ ./src/

# Create data directory for SQLite database with proper permissions
RUN mkdir -p /app/data && chmod 700 /app/data

# Create non-root user for security
RUN useradd -r -s /bin/false -m -d /app/user appuser && \
    chown -R appuser:appuser /app

# Set environment variables
ENV PYTHONPATH=/app
ENV DB_PATH=/app/data/memory_journal.db

# Expose the port (though MCP uses stdio, this is for potential future web interface)
EXPOSE 8000

# Switch to non-root user
USER appuser

# Health check to ensure the server can start
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import sys; sys.path.append('/app'); from src.server import *; print('Server healthy')" || exit 1

# Run the MCP server
CMD ["python", "src/server.py"]

# Labels for Docker Hub
LABEL maintainer="Memory Journal MCP"
LABEL description="A Model Context Protocol server for personal journaling with semantic search"
LABEL version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/your-username/memory-journal-mcp"
