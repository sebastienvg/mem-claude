#!/usr/bin/env bash
# Generic launcher for any agent in the mem-claude project
# Creates workspace, clones repo, checks out branch, and starts Claude in tmux
#
# Usage: ./start-agent.sh <agent-name> [--role <role>] [--task <task>] [--branch <branch>] [--ephemeral]
# Example: ./start-agent.sh davinci --role "Senior Engineer" --branch "davinci/statusline" --task "Build statusline"
#          ./start-agent.sh review-bot --ephemeral --role "Code Reviewer"

set -euo pipefail

PROJECT_ROOT="/Users/seb/AI/mem-claude"
AGENT_NAME="${1:?Usage: $0 <agent-name> [--role <role>] [--task <task>] [--branch <branch>] [--ephemeral]}"
shift

# Parse optional flags
AGENT_ROLE="Development Agent"
AGENT_TASK=""
AGENT_LIFECYCLE="perm"
AGENT_BRANCH=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --role) AGENT_ROLE="$2"; shift 2 ;;
        --task) AGENT_TASK="$2"; shift 2 ;;
        --branch) AGENT_BRANCH="$2"; shift 2 ;;
        --ephemeral) AGENT_LIFECYCLE="ephemeral"; shift ;;
        *) break ;;
    esac
done

AGENT_DIR="${PROJECT_ROOT}/agentspaces/${AGENT_NAME}"
CLAUDE_DIR="${AGENT_DIR}/.claude"
REPO_DIR="${AGENT_DIR}/repo"
WORKER_URL="http://localhost:37777"
TMUX_SESSION="agent-${AGENT_NAME}"

# Auto-generate branch name from agent name if not specified
if [ -z "$AGENT_BRANCH" ]; then
    AGENT_BRANCH="${AGENT_NAME}/work"
fi

# --- Bead repo naming (deterministic from git remote URL) ---
bead_repo_name() {
  local normalized
  normalized=$(echo "$1" | sed -E 's|^git@([^:]+):|https://\1/|; s|\.git$||; s|^https?://||')
  local short=$(echo "$normalized" | awk -F/ '{print $NF}')
  local hash=$(echo -n "$normalized" | shasum -a 256 | cut -c1-4)
  echo "bd-${short}-${hash}"
}

# --- Create agent workspace if it doesn't exist ---
if [ ! -d "$AGENT_DIR" ]; then
    echo "Creating agent workspace: $AGENT_DIR"
    mkdir -p "$AGENT_DIR"
fi

# --- Create CLAUDE_CONFIG_DIR ---
mkdir -p "$CLAUDE_DIR"

# --- Clone repo into agent workspace ---
if [ ! -d "$REPO_DIR/.git" ] && [ ! -f "$REPO_DIR/.git" ]; then
    echo "Cloning repo into ${REPO_DIR} (--reference for speed)..."
    git clone --reference "$PROJECT_ROOT" "$PROJECT_ROOT" "$REPO_DIR" 2>/dev/null || \
        git clone "$PROJECT_ROOT" "$REPO_DIR"
    echo "Cloned repo into ${REPO_DIR}"

    # Set up remote to point at the real origin (not the local clone)
    REAL_ORIGIN=$(cd "$PROJECT_ROOT" && git remote get-url origin 2>/dev/null || echo "")
    if [ -n "$REAL_ORIGIN" ]; then
        cd "$REPO_DIR"
        git remote set-url origin "$REAL_ORIGIN"
        cd "$PROJECT_ROOT"
        echo "Set origin to: $REAL_ORIGIN"
    fi
fi

# --- Install pre-push hook to protect main ---
HOOK_SRC="${PROJECT_ROOT}/.git/hooks/pre-push"
HOOK_DST="${REPO_DIR}/.git/hooks/pre-push"
if [ -f "$HOOK_SRC" ] && [ ! -f "$HOOK_DST" ]; then
    mkdir -p "${REPO_DIR}/.git/hooks"
    cp "$HOOK_SRC" "$HOOK_DST"
    chmod +x "$HOOK_DST"
    echo "Installed pre-push hook (protects main/master)"
fi

# --- Ensure beads (bd) is installed ---
if ! command -v bd >/dev/null 2>&1 && ! command -v br >/dev/null 2>&1; then
    echo "Installing beads..."
    brew install beads 2>/dev/null || npm install -g @beads/bd 2>/dev/null || \
        go install github.com/steveyegge/beads/cmd/bd@latest
fi

# --- Create and checkout agent branch ---
cd "$REPO_DIR"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ "$CURRENT_BRANCH" != "$AGENT_BRANCH" ]; then
    # Fetch latest main
    git fetch origin main 2>/dev/null || true
    BASE="origin/main"
    # Fall back to local main if fetch failed
    git rev-parse "$BASE" >/dev/null 2>&1 || BASE="main"

    if git show-ref --verify --quiet "refs/heads/${AGENT_BRANCH}"; then
        echo "Checking out existing branch: ${AGENT_BRANCH}"
        git checkout "$AGENT_BRANCH"
    else
        echo "Creating branch: ${AGENT_BRANCH} (from ${BASE})"
        git checkout -b "$AGENT_BRANCH" "$BASE"
    fi
fi
cd "$PROJECT_ROOT"

# --- Set up shared bead repo for task tracking ---
BEADS_BASE="${HOME}/.claude-mem/beads"
mkdir -p "$BEADS_BASE"

REAL_ORIGIN=$(cd "$REPO_DIR" && git remote get-url origin 2>/dev/null || echo "")
if [ -n "$REAL_ORIGIN" ]; then
    BEAD_REPO_NAME=$(bead_repo_name "$REAL_ORIGIN")
else
    BEAD_REPO_NAME="bd-$(basename "$PROJECT_ROOT")-0000"
fi
BEAD_REPO_DIR="${BEADS_BASE}/${BEAD_REPO_NAME}"

# Create bead repo if first time
if [ ! -d "$BEAD_REPO_DIR/.beads" ]; then
    echo "Creating bead repo: ${BEAD_REPO_NAME}"
    mkdir -p "$BEAD_REPO_DIR"
    (cd "$BEAD_REPO_DIR" && git init -q && bd init --quiet --no-daemon && git add .beads/ && git commit -q -m "init beads for ${BEAD_REPO_NAME}")
fi

# Redirect agent's repo to the shared bead repo
mkdir -p "${REPO_DIR}/.beads"
echo "${BEAD_REPO_DIR}/.beads" > "${REPO_DIR}/.beads/redirect"

# Exclude .beads from code repo (don't pollute PRs)
if ! grep -q "^\.beads/" "${REPO_DIR}/.git/info/exclude" 2>/dev/null; then
    echo ".beads/" >> "${REPO_DIR}/.git/info/exclude"
fi

# --- Share auth (keychain + .claude.json) ---
# Claude Code stores OAuth tokens in macOS Keychain with service name:
#   "Claude Code-credentials-<SHA256(CLAUDE_CONFIG_DIR)[:8]>"
# The default ~/.claude uses "Claude Code-credentials" (no suffix).
# We copy the credential to the new agent's keychain entry so it doesn't need to re-auth.

AGENT_HASH=$(echo -n "$CLAUDE_DIR" | shasum -a 256 | cut -c1-8)
AGENT_KEYCHAIN_SVC="Claude Code-credentials-${AGENT_HASH}"
CURRENT_USER=$(whoami)

# Check if this agent already has a keychain credential
if ! security find-generic-password -s "$AGENT_KEYCHAIN_SVC" -a "$CURRENT_USER" -w >/dev/null 2>&1; then
    # Find a source credential to copy from
    SOURCE_SVC=""
    # 1. Try the caller's config dir (e.g. Max launching a sub-agent)
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
        CALLER_HASH=$(echo -n "$CLAUDE_CONFIG_DIR" | shasum -a 256 | cut -c1-8)
        CALLER_SVC="Claude Code-credentials-${CALLER_HASH}"
        if security find-generic-password -s "$CALLER_SVC" -a "$CURRENT_USER" -w >/dev/null 2>&1; then
            SOURCE_SVC="$CALLER_SVC"
        fi
    fi
    # 2. Try the default (no suffix)
    if [ -z "$SOURCE_SVC" ]; then
        if security find-generic-password -s "Claude Code-credentials" -a "$CURRENT_USER" -w >/dev/null 2>&1; then
            SOURCE_SVC="Claude Code-credentials"
        fi
    fi
    # 3. Scan existing agents
    if [ -z "$SOURCE_SVC" ]; then
        for candidate_dir in "$PROJECT_ROOT"/agentspaces/*/.claude; do
            if [ -d "$candidate_dir" ] && [ "$candidate_dir" != "$CLAUDE_DIR" ]; then
                CAND_HASH=$(echo -n "$candidate_dir" | shasum -a 256 | cut -c1-8)
                CAND_SVC="Claude Code-credentials-${CAND_HASH}"
                if security find-generic-password -s "$CAND_SVC" -a "$CURRENT_USER" -w >/dev/null 2>&1; then
                    SOURCE_SVC="$CAND_SVC"
                    break
                fi
            fi
        done
    fi

    if [ -n "$SOURCE_SVC" ]; then
        CRED_VALUE=$(security find-generic-password -s "$SOURCE_SVC" -a "$CURRENT_USER" -w 2>/dev/null)
        if [ -n "$CRED_VALUE" ]; then
            security add-generic-password -s "$AGENT_KEYCHAIN_SVC" -a "$CURRENT_USER" -w "$CRED_VALUE" -U 2>/dev/null
            echo "Auth shared: ${SOURCE_SVC} -> ${AGENT_KEYCHAIN_SVC}"
        fi
    else
        echo "Warning: No authenticated credential found — agent will need to authenticate"
    fi
fi

# Copy .claude.json (account metadata) from an existing agent
if [ ! -f "$CLAUDE_DIR/.claude.json" ]; then
    AUTH_SOURCE=""
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -f "$CLAUDE_CONFIG_DIR/.claude.json" ]; then
        AUTH_SOURCE="$CLAUDE_CONFIG_DIR/.claude.json"
    elif [ -f "$HOME/.claude/.claude.json" ]; then
        AUTH_SOURCE="$HOME/.claude/.claude.json"
    else
        for candidate in "$PROJECT_ROOT"/agentspaces/*/.claude/.claude.json; do
            if [ -f "$candidate" ]; then
                AUTH_SOURCE="$candidate"
                break
            fi
        done
    fi
    if [ -n "$AUTH_SOURCE" ]; then
        cp "$AUTH_SOURCE" "$CLAUDE_DIR/.claude.json"
        echo "Copied config from: $AUTH_SOURCE"
    fi
fi

# Ensure bypass permissions is pre-accepted (we always use --dangerously-skip-permissions)
if [ -f "$CLAUDE_DIR/.claude.json" ]; then
    python3 -c "
import json, sys
p = sys.argv[1]
d = json.load(open(p))
changed = False
for key, val in [('bypassPermissionsModeAccepted', True), ('hasCompletedOnboarding', True)]:
    if d.get(key) != val:
        d[key] = val
        changed = True
if changed:
    json.dump(d, open(p, 'w'), indent=2)
" "$CLAUDE_DIR/.claude.json"
fi

# --- Write shared statusline settings ---
AGENT_SETTINGS="${CLAUDE_DIR}/settings.json"
if [ ! -f "$AGENT_SETTINGS" ]; then
    echo "Writing ${AGENT_SETTINGS}"
    cat > "$AGENT_SETTINGS" << 'SETTINGS'
{
  "statusLine": {
    "type": "command",
    "command": "/Users/seb/AI/mem-claude/agentspaces/statusline.sh",
    "padding": 0
  }
}
SETTINGS
fi

# --- Mark lifecycle ---
if [ "$AGENT_LIFECYCLE" = "ephemeral" ]; then
    touch "$AGENT_DIR/.ephemeral"
else
    rm -f "$AGENT_DIR/.ephemeral"
fi

# --- Symlink plugins from ~/.claude so agent gets claude-mem hooks + MCP search ---
if [ ! -e "$CLAUDE_DIR/plugins" ] && [ -d "$HOME/.claude/plugins" ]; then
    ln -s "$HOME/.claude/plugins" "$CLAUDE_DIR/plugins"
    echo "Linked plugins from ~/.claude/plugins"
fi

# --- Verify worker service is running ---
echo -n "Checking worker service at ${WORKER_URL}... "
HEALTH_OK=false
for i in 1 2 3 4 5; do
    if curl -sf "${WORKER_URL}/api/health" >/dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    sleep 1
done
if [ "$HEALTH_OK" = true ]; then
    echo "OK"
else
    echo "WARNING: Worker service not responding at ${WORKER_URL}"
    echo "  Memory/MCP tools will not be available until the worker starts."
    echo "  The SessionStart hook should auto-start it when Claude boots."
fi

# --- Verify beads setup ---
echo -n "Checking beads... "
if [ -f "${REPO_DIR}/.beads/redirect" ] && [ -d "${BEAD_REPO_DIR}/.beads" ]; then
    echo "OK (${BEAD_REPO_NAME})"
else
    echo "WARNING: Beads setup incomplete"
fi

# --- Register agent with worker service ---
if [ "$HEALTH_OK" = true ]; then
    AGENT_ID="${AGENT_NAME}@$(hostname -s)"
    REG=$(curl -sf -X POST "${WORKER_URL}/api/agents/register" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"${AGENT_ID}\",\"department\":\"engineering\"}" 2>/dev/null || echo "")
    if [ -n "$REG" ]; then
        API_KEY=$(echo "$REG" | jq -r '.apiKey // empty' 2>/dev/null)
        if [ -n "$API_KEY" ]; then
            echo "$API_KEY" > "$CLAUDE_DIR/.agent-key"
            chmod 600 "$CLAUDE_DIR/.agent-key"
            echo "Agent registered: ${AGENT_ID}"
        else
            echo "Agent updated: ${AGENT_ID} (existing)"
        fi
    fi
fi

# --- Write CLAUDE.md in repo so agent discovers it ---
CLAUDE_MD="${REPO_DIR}/CLAUDE.md"
if [ ! -f "$CLAUDE_MD" ]; then
    echo "Writing ${CLAUDE_MD}"
    cat > "$CLAUDE_MD" << MARKDOWN
# ${AGENT_NAME} — ${AGENT_ROLE}

You are **${AGENT_NAME}**, a ${AGENT_ROLE} working on the claude-mem project.

## Identity

- **Name:** ${AGENT_NAME}
- **Role:** ${AGENT_ROLE}
- **Workspace:** ${AGENT_DIR}
- **Repo:** ${REPO_DIR}
- **Branch:** ${AGENT_BRANCH}

## Task

Read \`TASK.md\` in your workspace for your current assignment.
${AGENT_TASK:+
> ${AGENT_TASK}
}

## Git Workflow

**CRITICAL: Never commit to or push to main/master.**

- You work on branch: \`${AGENT_BRANCH}\`
- Commit frequently with clear messages
- When done, open a PR: \`gh pr create --base main --head ${AGENT_BRANCH}\`
- A human will review and merge your PR

## Task Tracking (Beads)

Track work using \`bd\` (beads), a git-backed issue tracker shared across all agents.

| Command | What it does |
|---------|-------------|
| \`bd ready\` | List unblocked tasks you can work on |
| \`bd show <id>\` | Task details and history |
| \`bd list\` | All tasks |
| \`bd create "Title" -p <0-2>\` | Create task (P0=critical) |
| \`bd update <id> --claim\` | Claim a task (atomic) |
| \`bd close <id> --reason "text"\` | Close with explanation |
| \`bd dep add <child> <parent>\` | Add dependency |
| \`bd sync\` | Flush to git (run at end of session) |

### Workflow
1. \`bd ready\` → see unblocked tasks
2. \`bd update <id> --claim\` → claim it
3. Do the work, commit with bead ID: \`git commit -m "feat: ... (bd-xxxx)"\`
4. \`bd close <id> --reason "Implemented in PR #N"\`
5. \`bd sync\` before ending session

**Do NOT use Claude Code's TaskCreate/TaskUpdate/TaskList tools. Use \`bd\` instead.**
**NEVER use \`bd edit\` — it needs an interactive editor. Use \`bd update\` with flags.**

## Memory & Knowledge

You have access to the claude-mem memory system via MCP search tools.
The worker service runs at ${WORKER_URL}.

Use these MCP tools to recall past work:
- \`search\` — Find observations by keyword, type, date
- \`timeline\` — Get context around a specific observation

## First Boot Checklist

On your first message, verify your environment is working:

1. **Worker health**: Run \`curl -s ${WORKER_URL}/api/health | jq .\`
   - Should return \`{"status":"ok",...}\`
   - If it fails, the SessionStart hook should auto-start it. Wait and retry.
2. **MCP tools**: Try \`search\` with a simple query to confirm MCP is connected.
   - If MCP tools are not available, check that \`~/.claude/plugins\` is symlinked to your \`.claude/plugins\`.
3. **Git branch**: Run \`git branch --show-current\` and confirm you are on \`${AGENT_BRANCH}\`, NOT main.
4. **Report status**: Briefly confirm all checks pass before starting work.
5. **Beads**: Run \`bd list\` to confirm beads is connected.
   - If it fails, check \`.beads/redirect\` exists in your repo dir.
6. **Registration**: Run \`curl -s ${WORKER_URL}/api/agents/me -H "Authorization: Bearer \$(cat .claude/.agent-key)" | jq .\`
   - Should return your agent profile.

## Rules

- **NEVER push to main/master** — always work on your branch
- Commit your work frequently with clear messages
- Stay within scope of your assigned task
- If blocked, document the blocker in your workspace and stop
- Open a PR when your work is complete
MARKDOWN
fi

# --- Also write CLAUDE.md at agent root (for task file discovery) ---
AGENT_CLAUDE_MD="${AGENT_DIR}/CLAUDE.md"
if [ ! -f "$AGENT_CLAUDE_MD" ]; then
    cp "$CLAUDE_MD" "$AGENT_CLAUDE_MD"
fi

# --- Create tmux session and start Claude ---
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "tmux session '${TMUX_SESSION}' already exists"
    echo "  Attach: tmux attach -t ${TMUX_SESSION}"
    echo "  Kill:   tmux kill-session -t ${TMUX_SESSION}"
    exit 1
fi

echo "Creating tmux session: ${TMUX_SESSION}"
tmux new-session -d -s "$TMUX_SESSION" -c "$REPO_DIR"

# Set CLAUDE_CONFIG_DIR in the tmux session and start Claude
# NOTE: cd to REPO_DIR so Claude works in the agent's own clone.
tmux send-keys -t "$TMUX_SESSION" \
    "export CLAUDE_CONFIG_DIR='${CLAUDE_DIR}' AGENT_LIFECYCLE='${AGENT_LIFECYCLE}' BEADS_NO_DAEMON=1 BEADS_DIR='${BEAD_REPO_DIR}/.beads' && cd '${REPO_DIR}' && echo 'Starting ${AGENT_NAME} on branch ${AGENT_BRANCH}...' && claude --dangerously-skip-permissions" Enter

echo ""
echo "Agent '${AGENT_NAME}' launched!"
echo "  Branch:  ${AGENT_BRANCH}"
echo "  Repo:    ${REPO_DIR}"
echo "  Attach:  tmux attach -t ${TMUX_SESSION}"
echo "  Monitor: tmux capture-pane -t ${TMUX_SESSION} -p -S -50"
