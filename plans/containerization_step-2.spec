# Specification: Worker Service Container

## Requirement

Create a production Docker image for the claude-mem worker service using multi-stage builds for minimal image size.

## Current State

No Dockerfile exists. Worker runs directly via:
```bash
bun run plugin/scripts/worker-service.cjs start
```

Service binds to `127.0.0.1:37777` by default, reads data from `~/.claude-mem/`.

## Target Implementation

### .dockerignore

```
node_modules/
.git/
.gitignore
tests/
docs/
private/
cursor-hooks/
*.md
!plugin/**
.devcontainer/
.github/
.vscode/
*.log
```

### Dockerfile

```dockerfile
# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source and build
COPY src/ src/
COPY scripts/ scripts/
COPY plugin/ plugin/

# Build the project
RUN bun run build

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM oven/bun:1-slim

LABEL org.opencontainers.image.source="https://github.com/thedotmack/claude-mem"
LABEL org.opencontainers.image.description="Claude-Mem: Persistent memory for Claude Code"

WORKDIR /app

# Copy only built artifacts
COPY --from=builder /app/plugin ./plugin
COPY --from=builder /app/package.json ./

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data

# Copy entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER appuser

# Environment defaults
ENV CLAUDE_MEM_DATA_DIR=/data \
    CLAUDE_MEM_WORKER_HOST=0.0.0.0 \
    CLAUDE_MEM_WORKER_PORT=37777

EXPOSE 37777

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:37777/api/readiness || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "plugin/scripts/worker-service.cjs", "start"]
```

### docker-entrypoint.sh

```bash
#!/bin/bash
set -e

# Initialize data directory structure
mkdir -p "$CLAUDE_MEM_DATA_DIR/logs"
mkdir -p "$CLAUDE_MEM_DATA_DIR/archives"
mkdir -p "$CLAUDE_MEM_DATA_DIR/vector-db"

# Validate required environment (warn, don't fail - allows read-only mode)
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_MEM_GEMINI_API_KEY" ] && [ -z "$CLAUDE_MEM_OPENROUTER_API_KEY" ]; then
    echo "WARNING: No AI provider API key set. Memory compression will be disabled."
fi

# Handle signals for graceful shutdown
trap 'kill -TERM $PID; wait $PID' SIGTERM SIGINT

echo "Starting claude-mem worker..."
echo "Data directory: $CLAUDE_MEM_DATA_DIR"
echo "Binding to: $CLAUDE_MEM_WORKER_HOST:$CLAUDE_MEM_WORKER_PORT"

# Execute the main command
exec "$@"
```

## Test Commands

```bash
# Build
docker build -t claude-mem:test .

# Check image size
docker images claude-mem:test --format "{{.Size}}"

# Run
docker run -d --name cm-test \
  -p 37777:37777 \
  -v /tmp/claude-mem-test:/data \
  -e ANTHROPIC_API_KEY=test \
  claude-mem:test

# Health check
curl -s http://localhost:37777/api/readiness | jq .

# Version check
curl -s http://localhost:37777/api/version | jq .

# Cleanup
docker stop cm-test && docker rm cm-test
```

## Acceptance Criteria

1. Multi-stage build produces image < 200MB
2. Non-root user (`appuser`) runs the service
3. Health check passes within 30 seconds of start
4. SIGTERM triggers graceful shutdown (logs "Shutting down...")
5. Data directory structure auto-created on first run
6. Environment variable overrides work correctly
7. Container logs show startup messages
