# Agent Infrastructure

Scripts for managing the claude-mem agent fleet.

## Scripts

| Script | Purpose |
|--------|---------|
| `start-agent.sh` | Launch a new agent (clone repo, checkout branch, start Claude in tmux) |
| `dispatch.sh` | Send instructions to a running agent (busy detection, temp files for long messages) |
| `agent-status.sh` | Check if an agent is idle or busy |
| `pr-watcher.sh` | Poll for mergeable agent PRs and auto-merge them |
| `pr-watcher-service.sh` | Install/manage pr-watcher as a launchd service |

## pr-watcher Service

The pr-watcher auto-merges agent PRs that are mergeable and don't have a "do not merge" label. It recognizes branches from:
- Bead-based agents: `bd-*`
- Named agents: any branch prefix matching a directory in `agentspaces/`

### Install as launchd service (recommended)

```bash
./pr-watcher-service.sh install
```

This will:
- Create the log directory at `~/.claude-mem/logs/`
- Kill any existing tmux pr-watcher session
- Install and load the launchd plist
- Auto-start on boot, auto-restart on crash

### Manage the service

```bash
./pr-watcher-service.sh status    # Check if running
./pr-watcher-service.sh logs      # Tail recent output
./pr-watcher-service.sh restart   # Restart the service
./pr-watcher-service.sh uninstall # Stop and remove
```

### Logs

- stdout: `~/.claude-mem/logs/pr-watcher.log`
- stderr: `~/.claude-mem/logs/pr-watcher.err`

### Run in tmux (for debugging)

```bash
export BEADS_NO_DAEMON=1
./pr-watcher.sh --interval 120
```

Or with `--dry-run` to see what would be merged without merging:

```bash
./pr-watcher.sh --once --dry-run
```
