# =============================================================================
# Claude-Mem Docker Image
# Multi-stage build for minimal production image
# =============================================================================

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./

# Install dependencies (including devDependencies for build)
RUN bun install

# Copy source files needed for build
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
LABEL org.opencontainers.image.licenses="AGPL-3.0"

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only built artifacts from builder
COPY --from=builder /app/plugin ./plugin
COPY --from=builder /app/package.json ./

# Install runtime dependencies for Chroma embeddings
# chromadb-default-embed provides the default embedding function
RUN bun add chromadb chromadb-default-embed --production

# Create data directory (bun user already exists in base image)
RUN mkdir -p /data \
    && chown -R bun:bun /app /data

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Switch to non-root user
USER bun

# Environment defaults
ENV CLAUDE_MEM_DATA_DIR=/data \
    CLAUDE_MEM_WORKER_HOST=0.0.0.0 \
    CLAUDE_MEM_WORKER_PORT=37777

EXPOSE 37777

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:37777/api/readiness || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "plugin/scripts/worker-service.cjs", "--daemon"]
