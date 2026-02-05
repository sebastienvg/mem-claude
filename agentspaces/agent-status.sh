#!/usr/bin/env bash
# Check if an agent tmux session is idle or busy
# Usage: ./agent-status.sh <agent-name>
# Exit: 0 = idle, 1 = busy, 2 = session not found
# Output: "idle", "busy", or "not-found"

set -euo pipefail

AGENT="${1:?Usage: $0 <agent-name>}"
SESSION="agent-${AGENT}"

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "not-found"
    exit 2
fi

PANE=$(tmux capture-pane -t "$SESSION" -p -S -6)

# Busy patterns — agent is actively working
if echo "$PANE" | grep -qE '(Cogitat|Sautéed|Crunch|Bak|Scurr|Running\.\.\.|Running…|thinking|✻|⏵⏵.*bypass|· Scurrying|· Thinking|· Working|· Creating|· Effecting)'; then
    echo "busy"
    exit 1
fi

# Idle patterns — agent is waiting for input
# Claude Code prompt (❯), shell prompt ($, %), or separator line before prompt
if echo "$PANE" | grep -qE '(^❯|^  ❯|[$%]\s*$)'; then
    echo "idle"
    exit 0
fi

# Fallback: if no clear signal, assume busy (safer)
echo "busy"
exit 1
