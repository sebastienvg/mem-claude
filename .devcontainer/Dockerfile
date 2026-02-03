# Claude-Mem Development Container
# Provides consistent dev environment with Bun, Node.js, uv, and Python

FROM mcr.microsoft.com/devcontainers/base:bookworm

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Bun for vscode user
USER vscode
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/vscode/.bun/bin:${PATH}"

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/home/vscode/.local/bin:${PATH}"

# Install Python 3.13 via uv
RUN uv python install 3.13

# Switch back to root for any system-level operations
USER root

# Install additional tools
RUN apt-get update && apt-get install -y \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Set vscode as default user
USER vscode
