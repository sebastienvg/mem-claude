#!/bin/bash
set -e

# Initialize data directory structure
mkdir -p "$CLAUDE_MEM_DATA_DIR/logs"
mkdir -p "$CLAUDE_MEM_DATA_DIR/archives"
mkdir -p "$CLAUDE_MEM_DATA_DIR/vector-db"
mkdir -p "$CLAUDE_MEM_DATA_DIR/modes"

# Validate required environment (warn, don't fail - allows read-only mode)
# Ollama doesn't require an API key, so skip the warning if Ollama is selected
if [ "$CLAUDE_MEM_PROVIDER" != "ollama" ]; then
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_MEM_GEMINI_API_KEY" ] && [ -z "$CLAUDE_MEM_OPENROUTER_API_KEY" ]; then
        echo "WARNING: No AI provider API key set. Memory compression will be disabled."
    fi
fi

# Handle signals for graceful shutdown
trap 'echo "Shutting down..."; kill -TERM $PID 2>/dev/null; wait $PID 2>/dev/null' SIGTERM SIGINT

echo "Starting claude-mem worker..."
echo "Data directory: $CLAUDE_MEM_DATA_DIR"
echo "Binding to: $CLAUDE_MEM_WORKER_HOST:$CLAUDE_MEM_WORKER_PORT"

# Execute the main command
exec "$@"
