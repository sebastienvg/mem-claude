#!/usr/bin/env bash
# PR watcher: polls for agent PRs, auto-merges reviewed ones, closes beads.
#
# Usage: ./pr-watcher.sh [--interval <seconds>] [--dry-run] [--once]
#
# Requires: gh (GitHub CLI), bd (beads CLI)
# Environment: BEADS_NO_DAEMON=1 BEADS_DIR=<path> must be set for bd commands.

set -euo pipefail

# --- Defaults ---
POLL_INTERVAL=120
DRY_RUN=false
ONCE=false
MAX_RETRIES=${PR_WATCHER_MAX_RETRIES:-3}
FAILED_PRS=""  # colon-separated "number:count" pairs

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --interval) POLL_INTERVAL="$2"; shift 2 ;;
        --dry-run)  DRY_RUN=true; shift ;;
        --once)     ONCE=true; shift ;;
        -h|--help)
            echo "Usage: $0 [--interval <seconds>] [--dry-run] [--once]"
            echo "  --interval N  Poll every N seconds (default 120)"
            echo "  --dry-run     Log what would happen without merging"
            echo "  --once        Run one pass and exit"
            exit 0
            ;;
        *) echo "Unknown flag: $1"; exit 1 ;;
    esac
done

# --- Beads setup ---
# Auto-detect BEADS_DIR if not set (same logic as start-agent.sh)
if [ -z "${BEADS_DIR:-}" ]; then
    PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    BEADS_BASE="${HOME}/.claude-mem/beads"
    if [ -d "$BEADS_BASE" ]; then
        # Find first bead repo
        for d in "$BEADS_BASE"/bd-*/.beads; do
            if [ -d "$d" ]; then
                BEADS_DIR="$d"
                break
            fi
        done
    fi
fi
export BEADS_NO_DAEMON="${BEADS_NO_DAEMON:-1}"
if [ -n "${BEADS_DIR:-}" ]; then
    export BEADS_DIR
fi

# --- Logging ---
log() {
    local level="$1"; shift
    printf "[%s] %-6s %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*"
}

# --- Verify GitHub CLI auth ---
if ! gh auth status >/dev/null 2>&1; then
    log ERROR "gh CLI not authenticated. Run 'gh auth login' first."
    exit 1
fi

# --- Retry tracking (bash 3.2 compatible) ---
get_fail_count() {
    local pr="$1"
    echo "$FAILED_PRS" | tr ',' '\n' | grep "^${pr}:" | cut -d: -f2 || echo 0
}

inc_fail_count() {
    local pr="$1"
    local current
    current=$(get_fail_count "$pr")
    local new=$((current + 1))
    # Remove old entry and add updated one
    FAILED_PRS=$(echo "$FAILED_PRS" | tr ',' '\n' | grep -v "^${pr}:" | tr '\n' ',')
    FAILED_PRS="${FAILED_PRS}${pr}:${new},"
}

clear_fail_count() {
    local pr="$1"
    FAILED_PRS=$(echo "$FAILED_PRS" | tr ',' '\n' | grep -v "^${pr}:" | tr '\n' ',')
}

# --- Extract bead ID from branch name ---
# Branch pattern: bd-XXX-role/whatever → bead ID is bd-XXX
extract_bead_id() {
    local branch="$1"
    if [[ "$branch" =~ ^(bd-[a-z0-9]+)- ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

# --- Check if bead has unresolved blockers ---
bead_is_blocked() {
    local bead_id="$1"
    if [ -z "${BEADS_DIR:-}" ]; then
        # No beads configured — can't check, assume not blocked
        return 1
    fi
    local output
    output=$(bd show "$bead_id" 2>/dev/null || echo "")
    if [ -z "$output" ]; then
        # Bead not found — not blocked
        return 1
    fi
    # Look for blockedBy / Dependencies with open items
    if echo "$output" | grep -qiE '(blockedBy|blocked by|dependencies).*bd-'; then
        return 0
    fi
    return 1
}

# --- Close a bead ---
close_bead() {
    local bead_id="$1"
    local pr_number="$2"
    if [ -z "${BEADS_DIR:-}" ]; then
        log WARN "BEADS_DIR not set — skipping bead close for $bead_id"
        return
    fi
    if $DRY_RUN; then
        log DRY "Would close bead $bead_id (PR #$pr_number)"
        return
    fi
    if bd close "$bead_id" --reason "Merged in PR #$pr_number" 2>/dev/null; then
        log BEAD "Closed $bead_id — merged in PR #$pr_number"
    else
        log WARN "Failed to close bead $bead_id (may already be closed)"
    fi
}

# --- Comment on linked issues ---
comment_on_issues() {
    local pr_number="$1"
    local pr_body="$2"
    # Extract "Closes #N" / "Fixes #N" references
    local issues
    issues=$(echo "$pr_body" | grep -oiE '(closes|fixes|resolves)\s+#[0-9]+' | grep -oE '#[0-9]+' | tr -d '#' || true)
    for issue in $issues; do
        if $DRY_RUN; then
            log DRY "Would comment on issue #$issue about PR #$pr_number"
        else
            local comment_err
            comment_err=$(gh issue comment "$issue" --body "Merged via PR #$pr_number (auto-merged by pr-watcher)" 2>&1) || \
                log WARN "Failed to comment on issue #$issue: $comment_err"
        fi
    done
}

# --- Process one poll cycle ---
poll() {
    local prs
    prs=$(gh pr list \
        --json number,title,headRefName,mergeable,labels,body \
        --state open \
        --limit 100 2>/dev/null) || {
        log ERROR "Failed to list PRs"
        return
    }

    local count
    count=$(echo "$prs" | jq 'length')
    if [ "$count" -eq 0 ]; then
        log POLL "No open PRs"
        return
    fi

    # Filter to agent PRs (bd-* branches) and process
    local merged=0
    for i in $(seq 0 $((count - 1))); do
        local number title branch mergeable labels body
        number=$(echo "$prs" | jq -r ".[$i].number")
        title=$(echo "$prs" | jq -r ".[$i].title")
        branch=$(echo "$prs" | jq -r ".[$i].headRefName")
        mergeable=$(echo "$prs" | jq -r ".[$i].mergeable")
        labels=$(echo "$prs" | jq -r ".[$i].labels[].name" 2>/dev/null || true)
        body=$(echo "$prs" | jq -r ".[$i].body // empty")

        # Skip non-agent PRs
        if [[ ! "$branch" =~ ^bd- ]]; then
            continue
        fi

        local bead_id
        bead_id=$(extract_bead_id "$branch")

        # Skip if "do not merge" label
        if echo "$labels" | grep -qi "do not merge"; then
            log HOLD "PR #$number ($bead_id) — \"do not merge\" label"
            continue
        fi

        # Skip if not mergeable
        if [ "$mergeable" != "MERGEABLE" ]; then
            log SKIP "PR #$number ($bead_id) — not mergeable ($mergeable)"
            continue
        fi

        # Check bead dependencies
        if [ -n "$bead_id" ] && bead_is_blocked "$bead_id"; then
            log SKIP "PR #$number ($bead_id) — blocked by dependencies"
            continue
        fi

        # Check retry limit
        local fails
        fails=$(get_fail_count "$number")
        if [ "$fails" -ge "$MAX_RETRIES" ]; then
            log SKIP "PR #$number ($bead_id) — skipped after $MAX_RETRIES failed merge attempts"
            continue
        fi

        # Merge
        if $DRY_RUN; then
            log DRY "Would merge PR #$number ($bead_id) — $title"
        else
            local merge_output
            merge_output=$(gh pr merge "$number" --merge --delete-branch 2>&1)
            if [ $? -eq 0 ]; then
                log MERGE "PR #$number ($bead_id) — $title"
                clear_fail_count "$number"
                # Close the bead
                if [ -n "$bead_id" ]; then
                    close_bead "$bead_id" "$number"
                fi
                # Comment on linked issues
                comment_on_issues "$number" "$body"
                merged=$((merged + 1))
                # Stagger merges
                sleep 5
            else
                log ERROR "Failed to merge PR #$number ($bead_id): $merge_output"
                inc_fail_count "$number"
            fi
        fi
    done

    if [ "$merged" -eq 0 ] && ! $DRY_RUN; then
        log POLL "No agent PRs ready to merge"
    fi
}

# --- Main loop ---
log INFO "PR watcher started (interval=${POLL_INTERVAL}s dry_run=${DRY_RUN} once=${ONCE})"

while true; do
    poll
    if $ONCE; then
        break
    fi
    sleep "$POLL_INTERVAL"
done
