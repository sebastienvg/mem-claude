#!/bin/bash
set -e

echo "=== Claude-Mem DevContainer Setup ==="

# Create data directory if mount doesn't exist
mkdir -p ~/.claude-mem

# Install npm dependencies
echo "Installing dependencies..."
npm install

# Verify installations
echo ""
echo "=== Environment Verification ==="
echo "Bun:    $(bun --version)"
echo "Node:   $(node --version)"
echo "npm:    $(npm --version)"
echo "uv:     $(uv --version)"
echo "Python: $(python --version 2>&1)"
echo ""
echo "=== Ready for development ==="
echo ""
echo "Quick start:"
echo "  npm run build          # Build the plugin"
echo "  npm run worker:start   # Start the worker service"
echo "  npm run test           # Run tests"
