# Specification: Distribution & Registry

## Requirement

Automate Docker image publishing to GitHub Container Registry and provide user documentation.

## Current State

No Docker distribution exists. Users must clone repo and build locally.

## Target Implementation

### .github/workflows/docker-publish.yml

```yaml
name: Build and Publish Docker Image

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: 'Image tag'
        required: true
        default: 'dev'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=raw,value=latest,enable=${{ github.event_name == 'release' }}
            type=raw,value=${{ github.event.inputs.tag }},enable=${{ github.event_name == 'workflow_dispatch' }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Generate artifact attestation
        uses: actions/attest-build-provenance@v1
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.build-and-push.outputs.digest }}
          push-to-registry: true
```

### docs/public/docker.mdx

```mdx
---
title: Docker Installation
description: Run claude-mem using Docker
---

# Docker Installation

Run claude-mem in a container for easy deployment and isolation.

## Quick Start

```bash
# Pull the latest image
docker pull ghcr.io/thedotmack/claude-mem:latest

# Run with your API key
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  ghcr.io/thedotmack/claude-mem:latest
```

## Docker Compose (Recommended)

For the full stack including vector search:

```bash
# Clone the repository
git clone https://github.com/thedotmack/claude-mem.git
cd claude-mem

# Configure environment
cp .env.example .env
# Edit .env with your API key

# Start services
docker compose up -d
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key |
| `CLAUDE_MEM_GEMINI_API_KEY` | Yes* | Alternative: Gemini API key |
| `CLAUDE_MEM_OPENROUTER_API_KEY` | Yes* | Alternative: OpenRouter API key |
| `CLAUDE_MEM_WORKER_PORT` | No | HTTP port (default: 37777) |
| `CLAUDE_MEM_MODEL` | No | Model for compression |

*At least one AI provider key required for memory compression.

## Data Persistence

Mount `/data` to persist:
- SQLite database
- Vector embeddings
- Session logs
- Configuration

```bash
-v ~/.claude-mem:/data
```

## Health Check

```bash
curl http://localhost:37777/api/readiness
```

## Updating

```bash
docker pull ghcr.io/thedotmack/claude-mem:latest
docker compose up -d
```

## Troubleshooting

### Container won't start
Check logs: `docker logs claude-mem`

### Permission denied on /data
Ensure mount directory exists and is writable:
```bash
mkdir -p ~/.claude-mem
chmod 755 ~/.claude-mem
```

### Can't connect to worker
Verify port is exposed: `docker ps`
Check firewall allows 37777
```

### README Addition

```markdown
## Docker Quick Start

```bash
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  ghcr.io/thedotmack/claude-mem:latest
```

See [Docker documentation](https://docs.claude-mem.ai/docker) for full setup.
```

## Test Commands

```bash
# Verify workflow syntax
actionlint .github/workflows/docker-publish.yml

# Test build locally
docker buildx build --platform linux/amd64 -t test:local .

# Manual push (after login)
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
docker push ghcr.io/thedotmack/claude-mem:test
```

## Acceptance Criteria

1. Workflow triggers on release publish
2. Multi-arch builds complete (amd64 + arm64)
3. Image tagged with semver and `latest`
4. Image publicly pullable without authentication
5. Build attestation generated for supply chain security
6. Documentation includes all common scenarios
7. README has Docker quick start section
8. Test release successfully publishes to GHCR
