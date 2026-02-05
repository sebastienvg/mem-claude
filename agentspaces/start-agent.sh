#!/usr/bin/env bash
# Generic launcher for any agent in the mem-claude project
# Creates workspace, clones repo, checks out branch, and starts Claude in tmux
#
# Usage: ./start-agent.sh <agent-name> [--role <role>] [--task <task>] [--branch <branch>] [--ephemeral] [--bead <bead-id>] [--continue|-c]
# Example: ./start-agent.sh davinci --role "Senior Engineer" --branch "davinci/statusline" --task "Build statusline"
#          ./start-agent.sh review-bot --ephemeral --role "Code Reviewer"
#          ./start-agent.sh my-agent --bead bd-1cc --role "Shell Developer"  # produces agent name bd-1cc-shell

set -euo pipefail

PROJECT_ROOT="/Users/seb/AI/mem-claude"
AGENT_NAME="${1:?Usage: $0 <agent-name> [--role <role>] [--task <task>] [--branch <branch>] [--ephemeral] [--bead <bead-id>]}"
shift

# Parse optional flags
AGENT_ROLE="Development Agent"
AGENT_TASK=""
AGENT_LIFECYCLE="perm"
AGENT_BRANCH=""
BEAD_ID=""
CONTINUE_SESSION=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --role) AGENT_ROLE="$2"; shift 2 ;;
        --task) AGENT_TASK="$2"; shift 2 ;;
        --branch) AGENT_BRANCH="$2"; shift 2 ;;
        --ephemeral) AGENT_LIFECYCLE="ephemeral"; shift ;;
        --bead) BEAD_ID="$2"; shift 2 ;;
        --continue|-c) CONTINUE_SESSION=true; shift ;;
        *) break ;;
    esac
done

# --- Auto-derive agent name from bead + role ---
role_to_suffix() {
    local role
    role=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    case "$role" in
        *typescript*|*ts*) echo "ts" ;;
        *shell*) echo "shell" ;;
        *database*|*db*|*migration*) echo "db" ;;
        *qa*|*test*|*verif*) echo "qa" ;;
        *doc*) echo "docs" ;;
        *review*) echo "review" ;;
        *frontend*|*ui*|*fe*) echo "fe" ;;
        *plan*) echo "plan" ;;
        *) echo "dev" ;;
    esac
}

if [[ -n "${BEAD_ID}" ]]; then
    ROLE_SUFFIX=$(role_to_suffix "$AGENT_ROLE")
    AGENT_NAME="${BEAD_ID}-${ROLE_SUFFIX}"
    # Auto-set branch if not provided
    AGENT_BRANCH="${AGENT_BRANCH:-${AGENT_NAME}/${BEAD_ID}}"
    # Auto-set ephemeral
    AGENT_LIFECYCLE="ephemeral"
fi

if [ "$CONTINUE_SESSION" = true ] && [ "$AGENT_LIFECYCLE" = "ephemeral" ]; then
    echo "Error: --continue/-c only works for permanent agents (not ephemeral)"
    exit 1
fi

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

# --- Install pre-push hook (protect main + auto-rebase) ---
mkdir -p "${REPO_DIR}/.git/hooks"
cat > "${REPO_DIR}/.git/hooks/pre-push" << 'HOOKEOF'
#!/bin/bash
# Protect main/master from direct pushes
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    echo "[pre-push] ERROR: Direct push to $BRANCH is blocked. Use a PR."
    exit 1
fi

# Auto-rebase on origin/main before pushing
git fetch origin main --quiet 2>/dev/null
BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
if [ "$BEHIND" -gt 0 ]; then
    echo "[pre-push] Branch is $BEHIND commits behind main. Auto-rebasing..."
    if ! git rebase origin/main --quiet; then
        echo "[pre-push] Rebase failed — conflicts detected. Aborting push."
        git rebase --abort
        exit 1
    fi
    echo "[pre-push] Rebase successful."
fi
HOOKEOF
chmod +x "${REPO_DIR}/.git/hooks/pre-push"
echo "Installed pre-push hook (protects main + auto-rebase)"

# --- Install post-commit staleness warning ---
cat > "${REPO_DIR}/.git/hooks/post-commit" << 'HOOKEOF'
#!/bin/bash
BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo 0)
if [ "$BEHIND" -gt 0 ]; then
    echo ""
    echo "⚠️  WARNING: Your branch is $BEHIND commits behind main."
    echo "   Run: git rebase origin/main"
    echo ""
fi
HOOKEOF
chmod +x "${REPO_DIR}/.git/hooks/post-commit"

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
if [ -d "${BEAD_REPO_DIR}/.beads" ]; then
    echo "OK (${BEAD_REPO_NAME} via BEADS_DIR)"
else
    echo "WARNING: Beads repo not found at ${BEAD_REPO_DIR}"
fi

# --- Register agent with worker service ---
SPAWNER="${AGENT_SPAWNER:-human}"
if [ "$HEALTH_OK" = true ]; then
    AGENT_ID="${AGENT_NAME}@$(hostname -s)"
    REG=$(curl -sf -X POST "${WORKER_URL}/api/agents/register" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"${AGENT_ID}\",\"department\":\"engineering\",\"spawned_by\":\"${SPAWNER}\",\"bead_id\":\"${BEAD_ID:-}\",\"role\":\"${AGENT_ROLE}\"}" 2>/dev/null || echo "")
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
**After reading TASK.md, DELETE it immediately:** \`rm ../TASK.md\`
This prevents stale instructions from interfering with future dispatches.
${AGENT_TASK:+
> ${AGENT_TASK}
}

## Development Protocol

**Spec first, tests first, code last.**

Before writing ANY implementation code, you MUST:

1. **Write SPEC.md** in your workspace root (\`<workspace>/SPEC.md\`):
   - What you're building (one paragraph)
   - Acceptance criteria (numbered list, measurable)
   - Edge cases and error handling
   - Files you expect to create or modify

2. **Write tests** that validate every acceptance criterion:
   - Tests go in the project's existing test directory/pattern
   - Tests MUST fail before implementation (red phase)
   - Run tests to confirm they fail: document the output

3. **Implement** until all tests pass (green phase)

4. **Verify** all acceptance criteria from SPEC.md are met

A task is NOT complete until:
- All spec criteria are fulfilled
- All tests pass
- SPEC.md exists in your workspace

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
   - If it fails, check \`.beads\` is symlinked to the shared bead repo.
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

CLAUDE_RESUME_FLAG=""
if [ "$CONTINUE_SESSION" = true ]; then
    # claude --resume picks up the most recent conversation automatically
    CLAUDE_RESUME_FLAG="--resume"
    echo "Resuming previous conversation for ${AGENT_NAME}"
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

# Background fetch to keep origin/main fresh
tmux send-keys -t "$TMUX_SESSION" \
    "(while true; do git fetch origin main --quiet 2>/dev/null; sleep 60; done) &" Enter
sleep 0.5

# Set CLAUDE_CONFIG_DIR in the tmux session and start Claude
# NOTE: cd to REPO_DIR so Claude works in the agent's own clone.
tmux send-keys -t "$TMUX_SESSION" \
    "export CLAUDE_CONFIG_DIR='${CLAUDE_DIR}' AGENT_LIFECYCLE='${AGENT_LIFECYCLE}' AGENT_SPAWNER='${AGENT_NAME}' BEADS_NO_DAEMON=1 BEADS_DIR='${BEAD_REPO_DIR}/.beads' BD_ACTOR='${AGENT_NAME}' && cd '${REPO_DIR}' && echo 'Starting ${AGENT_NAME} on branch ${AGENT_BRANCH}...' && claude --dangerously-skip-permissions ${CLAUDE_RESUME_FLAG}" Enter

echo ""
echo "Agent '${AGENT_NAME}' launched!"
echo "  Branch:  ${AGENT_BRANCH}"
echo "  Repo:    ${REPO_DIR}"
echo "  Attach:  tmux attach -t ${TMUX_SESSION}"
echo "  Monitor: tmux capture-pane -t ${TMUX_SESSION} -p -S -50"
