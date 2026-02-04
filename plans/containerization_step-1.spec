# Specification: DevContainer Setup

## Requirement

Create a DevContainer configuration that provides all build dependencies for claude-mem development, ensuring consistent environments across developer machines.

## Current State

No container configuration exists. Developers must manually install:
- Bun (>=1.0.0)
- Node.js (>=18.0.0)
- uv (Python package runner)
- Python 3.13

## Target Implementation

### .devcontainer/Dockerfile

```dockerfile
FROM mcr.microsoft.com/devcontainers/base:bookworm

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Install Python 3.13 via uv
RUN uv python install 3.13

# Install additional tools
RUN apt-get update && apt-get install -y \
    jq \
    && rm -rf /var/lib/apt/lists/*
```

### .devcontainer/devcontainer.json

```json
{
  "name": "claude-mem",
  "build": {
    "dockerfile": "Dockerfile",
    "context": ".."
  },
  "features": {
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "forwardPorts": [37777],
  "mounts": [
    "source=${localEnv:HOME}/.claude-mem,target=/root/.claude-mem,type=bind,consistency=cached"
  ],
  "postCreateCommand": "bash .devcontainer/post-create.sh",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "oven.bun-vscode"
      ],
      "settings": {
        "terminal.integrated.defaultProfile.linux": "bash"
      }
    }
  }
}
```

### .devcontainer/post-create.sh

```bash
#!/bin/bash
set -e

# Install npm dependencies
npm install

# Create data directory if it doesn't exist
mkdir -p ~/.claude-mem

# Verify installations
echo "=== Environment Verification ==="
echo "Bun: $(bun --version)"
echo "Node: $(node --version)"
echo "uv: $(uv --version)"
echo "Python: $(python --version)"
echo "=== Ready for development ==="
```

## Test Commands

```bash
# Build container (from VS Code or CLI)
devcontainer build --workspace-folder .

# Open in container
devcontainer open --workspace-folder .

# Verify inside container
bun --version && node --version && uv --version && python --version
npm run build
```

## Acceptance Criteria

1. Container builds in under 5 minutes
2. All four runtimes (Bun, Node, uv, Python) are available
3. `npm run build` completes successfully
4. Worker service starts and responds on port 37777
5. Mount point for `~/.claude-mem` works correctly
6. VS Code extensions install automatically
