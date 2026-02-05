#!/usr/bin/env bash
# Reliable agent instruction dispatch via tmux
#
# Usage: ./dispatch.sh <agent-name> <instruction>
#        ./dispatch.sh <agent-name> --file <path>
#        ./dispatch.sh <agent-name> --wait <instruction>
#
# Options:
#   --wait     Wait up to 60s for agent to become idle before sending
#   --force    Send even if agent appears busy
#   --file     Read instruction from a file instead of argument
#
# Examples:
#   ./dispatch.sh max "Read TASK.md and execute it."
#   ./dispatch.sh bd-2ww-db --wait "Run bd ready and claim the top task."
#   ./dispatch.sh alice --file /path/to/instructions.txt

set -euo pipefail

# --- Parse args ---
AGENT="${1:?Usage: $0 <agent-name> <instruction>}"
shift

WAIT=false
FORCE=false
INSTRUCTION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wait)  WAIT=true; shift ;;
        --force) FORCE=true; shift ;;
        --file)  INSTRUCTION=$(cat "$2"); shift 2 ;;
        *)       INSTRUCTION="$1"; shift ;;
    esac
done

if [ -z "$INSTRUCTION" ]; then
    echo "ERROR: No instruction provided"
    exit 1
fi

SESSION="agent-${AGENT}"

# --- Check session exists ---
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "ERROR: tmux session '${SESSION}' does not exist"
    echo "  Running sessions:"
    tmux list-sessions 2>/dev/null | grep agent- | sed 's/^/    /' || echo "    (none)"
    exit 1
fi

# --- Check if agent is idle ---
# Claude Code layout: prompt line (❯) sits ABOVE the status bar + permission line.
# We scan the last ~6 lines for prompt indicators rather than just the last line.
is_idle() {
    local pane
    pane=$(tmux capture-pane -t "$SESSION" -p -S -6)
    # Look for Claude Code prompt (❯), shell prompt ($, %, ❯), or INSERT mode
    # Exclude lines that are clearly spinners/progress (Cogitating, Running, thinking)
    if echo "$pane" | grep -qE '(Cogitating|Running\.\.\.|Running…|thinking|✻\.\.\.)'; then
        return 1
    fi
    echo "$pane" | grep -qE '(^❯|^  ❯|[$%]\s*$|-- INSERT --)'
}

if [ "$WAIT" = true ]; then
    echo -n "Waiting for ${SESSION} to be idle..."
    for i in $(seq 1 60); do
        if is_idle; then
            echo " ready (${i}s)"
            break
        fi
        if [ "$i" -eq 60 ]; then
            echo " TIMEOUT after 60s"
            if [ "$FORCE" != true ]; then
                echo "  Use --force to send anyway"
                exit 1
            fi
            echo "  Sending anyway (--force)"
        fi
        sleep 1
        echo -n "."
    done
elif ! is_idle && [ "$FORCE" != true ]; then
    echo "WARNING: Agent appears busy"
    echo "  Recent output:"
    tmux capture-pane -t "$SESSION" -p -S -4 | sed 's/^/    /'
    echo "  Use --wait to wait for idle, or --force to send anyway"
    exit 1
fi

# --- Send instruction ---
# For long instructions (>200 chars), write to a temp file and have the agent read it.
# tmux send-keys can silently truncate long strings.
if [ ${#INSTRUCTION} -gt 200 ]; then
    TMPFILE=$(mktemp /tmp/dispatch-XXXXXX.txt)
    echo "$INSTRUCTION" > "$TMPFILE"
    # Tell the agent to read and execute the temp file contents
    tmux send-keys -t "$SESSION" "Read ${TMPFILE} and execute the instructions inside."
    sleep 0.3
    tmux send-keys -t "$SESSION" C-m
    echo "OK: Sent via temp file (${#INSTRUCTION} chars) → ${SESSION}"
    echo "  Temp file: ${TMPFILE}"
else
    # Send text, pause, then send Enter (C-m) separately
    tmux send-keys -t "$SESSION" "$INSTRUCTION"
    sleep 0.3
    tmux send-keys -t "$SESSION" C-m
    echo "OK: Sent to ${SESSION}"
fi

echo "  Instruction: ${INSTRUCTION:0:80}$([ ${#INSTRUCTION} -gt 80 ] && echo '...')"
