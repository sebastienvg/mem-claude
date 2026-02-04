# Specification: Docker Compose Orchestration

## Requirement

Create Docker Compose configuration for single-command deployment of claude-mem with all dependencies (worker + Chroma).

## Current State

No orchestration exists. Services must be started manually.

## Target Implementation

### docker-compose.yml

```yaml
version: '3.8'

services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: claude-mem-worker
    ports:
      - "${CLAUDE_MEM_WORKER_PORT:-37777}:37777"
    volumes:
      - claude-mem-data:/data
    environment:
      - CLAUDE_MEM_DATA_DIR=/data
      - CLAUDE_MEM_WORKER_HOST=0.0.0.0
      - CLAUDE_MEM_WORKER_PORT=37777
      - CLAUDE_MEM_CHROMA_MODE=http
      - CLAUDE_MEM_CHROMA_URL=http://chroma:8000
      - CLAUDE_MEM_MODEL=${CLAUDE_MEM_MODEL:-claude-sonnet-4-5}
      - CLAUDE_MEM_PROVIDER=${CLAUDE_MEM_PROVIDER:-claude}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - CLAUDE_MEM_GEMINI_API_KEY=${CLAUDE_MEM_GEMINI_API_KEY:-}
      - CLAUDE_MEM_OPENROUTER_API_KEY=${CLAUDE_MEM_OPENROUTER_API_KEY:-}
    depends_on:
      chroma:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:37777/api/readiness"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  chroma:
    image: chromadb/chroma:latest
    container_name: claude-mem-chroma
    volumes:
      - chroma-data:/chroma/chroma
    environment:
      - ANONYMIZED_TELEMETRY=False
      - CHROMA_SERVER_AUTHN_PROVIDER=
      - CHROMA_SERVER_AUTHN_CREDENTIALS=
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
    restart: unless-stopped

volumes:
  claude-mem-data:
    name: claude-mem-data
  chroma-data:
    name: claude-mem-chroma-data

networks:
  default:
    name: claude-mem-network
```

### .env.example

```bash
# =============================================================================
# Claude-Mem Docker Configuration
# =============================================================================
# Copy this file to .env and fill in your values

# -----------------------------------------------------------------------------
# AI Provider Configuration (at least one required for memory compression)
# -----------------------------------------------------------------------------

# Anthropic Claude API (recommended)
ANTHROPIC_API_KEY=

# Alternative: Google Gemini
# CLAUDE_MEM_GEMINI_API_KEY=

# Alternative: OpenRouter
# CLAUDE_MEM_OPENROUTER_API_KEY=

# -----------------------------------------------------------------------------
# Model Configuration
# -----------------------------------------------------------------------------

# AI provider: claude | gemini | openrouter
CLAUDE_MEM_PROVIDER=claude

# Model to use for compression
CLAUDE_MEM_MODEL=claude-sonnet-4-5

# -----------------------------------------------------------------------------
# Service Configuration
# -----------------------------------------------------------------------------

# Worker HTTP port (exposed to host)
CLAUDE_MEM_WORKER_PORT=37777

# Log level: DEBUG | INFO | WARN | ERROR
CLAUDE_MEM_LOG_LEVEL=INFO
```

### docker-compose.override.yml.example

```yaml
# Development overrides - copy to docker-compose.override.yml
version: '3.8'

services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile
      # Rebuild on source changes
      args:
        - BUILDKIT_INLINE_CACHE=1
    volumes:
      # Mount source for hot reload (dev only)
      - ./src:/app/src:ro
      # Local data directory for debugging
      - ~/.claude-mem:/data
    environment:
      - CLAUDE_MEM_LOG_LEVEL=DEBUG

  chroma:
    ports:
      # Expose Chroma for direct debugging
      - "8000:8000"
```

### Package.json Scripts

```json
{
  "scripts": {
    "docker:build": "docker compose build",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f worker",
    "docker:reset": "docker compose down -v"
  }
}
```

## Test Commands

```bash
# Full stack test
cp .env.example .env
echo "ANTHROPIC_API_KEY=sk-ant-test" >> .env

docker compose up -d
sleep 15  # Wait for health checks

# Verify services
docker compose ps --format "table {{.Name}}\t{{.Status}}"

# Test endpoints
curl -s http://localhost:37777/api/readiness | jq .status
curl -s http://localhost:37777/api/version | jq .version

# Cleanup
docker compose down -v
```

## Acceptance Criteria

1. `docker compose up -d` starts both services
2. Worker depends_on Chroma with health check
3. Both services restart automatically on failure
4. Named volumes persist data
5. Environment variables configurable via `.env`
6. Network isolation (services communicate internally)
7. `docker compose down -v` removes all resources
8. npm scripts added for common operations
