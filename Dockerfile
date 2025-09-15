# Memory Journal MCP Server for Smithery
# HTTP-enabled version for Smithery marketplace deployment
FROM python:3.11-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    git \
    ca-certificates \
    && apk upgrade

# Install Python dependencies
RUN pip install --no-cache-dir \
    mcp>=1.0.0 \
    numpy \
    aiohttp>=3.8.0 \
    aiohttp-cors>=0.7.0

# Copy source code and license
COPY src/ ./src/
COPY LICENSE ./LICENSE

# Create data directory for SQLite database with proper permissions
RUN mkdir -p /app/data && chmod 755 /app/data

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Set ownership and permissions
RUN chown -R appuser:appgroup /app
USER appuser

# Set environment variables
ENV PYTHONPATH=/app
ENV DB_PATH=/app/data/memory_journal.db
ENV PORT=8000

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Start the HTTP server
CMD ["python", "src/server_http.py"]