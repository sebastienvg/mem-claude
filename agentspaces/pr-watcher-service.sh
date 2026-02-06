#!/usr/bin/env bash
# Manage the pr-watcher launchd service.
#
# Usage: ./pr-watcher-service.sh <install|uninstall|status|logs|restart>

set -euo pipefail

PLIST_NAME="com.claude-mem.pr-watcher"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/${PLIST_NAME}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.claude-mem/logs"

cmd="${1:-help}"

case "$cmd" in
    install)
        # Create log directory
        mkdir -p "$LOG_DIR"

        # Kill tmux pr-watcher session if running (clean transition)
        if tmux has-session -t pr-watcher 2>/dev/null; then
            echo "Killing existing tmux pr-watcher session..."
            tmux kill-session -t pr-watcher
        fi

        # Unload existing service if loaded
        launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

        # Copy plist
        cp "$PLIST_SRC" "$PLIST_DST"
        echo "Installed plist to $PLIST_DST"

        # Load service
        launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
        echo "Service loaded."

        # Verify
        sleep 2
        if launchctl print "gui/$(id -u)/${PLIST_NAME}" >/dev/null 2>&1; then
            echo "pr-watcher is running."
        else
            echo "WARNING: service may not have started. Check: $0 status"
        fi
        ;;

    uninstall)
        launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true
        rm -f "$PLIST_DST"
        echo "Service unloaded and plist removed."
        ;;

    status)
        if launchctl print "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null | grep -qE 'state = running'; then
            echo "pr-watcher: running"
            launchctl print "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null | grep -E '(state|pid|last exit)'
        else
            echo "pr-watcher: not running"
            launchctl print "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null | grep -E '(state|last exit)' || echo "(service not loaded)"
        fi
        ;;

    logs)
        echo "=== stdout ==="
        tail -30 "$LOG_DIR/pr-watcher.log" 2>/dev/null || echo "(no log file yet)"
        echo ""
        echo "=== stderr ==="
        tail -10 "$LOG_DIR/pr-watcher.err" 2>/dev/null || echo "(no error log yet)"
        ;;

    restart)
        launchctl kickstart -k "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || {
            echo "Service not loaded. Run: $0 install"
            exit 1
        }
        echo "pr-watcher restarted."
        ;;

    help|*)
        echo "Usage: $0 <install|uninstall|status|logs|restart>"
        echo ""
        echo "  install    Copy plist, create log dir, load service"
        echo "  uninstall  Unload service, remove plist"
        echo "  status     Show service status"
        echo "  logs       Tail recent log output"
        echo "  restart    Restart the service"
        ;;
esac
