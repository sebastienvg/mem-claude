# Auto Memory Path Encoding

## Overview

Claude Code stores per-project auto memory at:
```
~/.claude/projects/<encoded-path>/memory/MEMORY.md
```

The `<encoded-path>` is derived from the **current working directory** (CWD) where Claude Code is launched, not the git root.

## Encoding Rules

### Rule 1: Forward slashes (`/`) are replaced with dashes (`-`)

```
/Users/seb/AI/mem-claude → -Users-seb-AI-mem-claude
```

### Rule 2: Leading slash becomes a leading dash

The leading `/` in absolute paths is converted to a leading `-`, consistent with Rule 1.

```
/Users/seb → -Users-seb (starts with dash)
```

### Rule 3: Dots (`.`) are replaced with dashes (`-`)

Hidden directories or dot-prefixed segments become dashes. This creates **double dashes** when a dot follows a slash (since both `/` and `.` each become `-`):

```
/Users/seb/.claude-mem-observer-sessions → -Users-seb--claude-mem-observer-sessions
                 ^                                    ^^
              /. → --                               /. → --
```

Similarly for `.worktrees/`:
```
/Users/seb/EVTHINGS-MVP/.worktrees/009-community-discovery
→ -Users-seb-EVTHINGS-MVP--worktrees-009-community-discovery
                          ^^
                       /. → --
```

### Rule 4: Existing dashes in names are preserved as-is

Dashes that are part of the original directory name remain unchanged:

```
mem-claude   → mem-claude   (dash preserved)
beads-backend → beads-backend (dash preserved)
```

This means the encoding is **lossy** — you cannot unambiguously decode an encoded path back to the original because `-` could represent `/`, `.`, or a literal `-`.

### Rule 5: Names are truncated at ~89 characters

Long encoded paths are truncated without a trailing marker:

```
-Users-seb-EVTHINGS-MVP--worktrees-002-audit-messages-stack-implementation-and-dependenci
                                                                                        ^
                                                           89 chars, truncated from "dependencies"
```

The longest observed directory name is 89 characters. This is likely a filesystem or application-imposed limit.

### Rule 6: CWD is used, not git root

The encoding uses the **CWD where `claude` is launched**, not the git repository root. This means:

- Git worktrees get separate auto memory directories
- Subdirectories within a repo get separate directories if Claude is launched from them

Evidence: The same git repo (`mem-claude`) has multiple encoded directories:

| CWD | Encoded Directory |
|-----|-------------------|
| `/Users/seb/AI/mem-claude` | `-Users-seb-AI-mem-claude` |
| `/Users/seb/AI/mem-claude/agentspaces/docker-sync` | `-Users-seb-AI-mem-claude-agentspaces-docker-sync` |
| `/Users/seb/AI/mem-claude/agentspaces/memory-research` | `-Users-seb-AI-mem-claude-agentspaces-memory-research` |
| `/Users/seb/AI/mem-claude/agentspaces/monitor` | `-Users-seb-AI-mem-claude-agentspaces-monitor` |

### Rule 7: `/private/tmp` paths are encoded the same way

Temporary directories follow the same rules:

```
/private/tmp/beads-chat-user-86508579e6ad6010 → -private-tmp-beads-chat-user-86508579e6ad6010
```

## Encoding Algorithm (Pseudocode)

```javascript
function encodeProjectPath(cwd) {
  let encoded = cwd
    .replace(/\//g, '-')   // Replace all forward slashes with dashes
    .replace(/\./g, '-');  // Replace all dots with dashes

  // Truncate to max ~89 characters
  if (encoded.length > 89) {
    encoded = encoded.substring(0, 89);
  }

  return encoded;
}
```

## Implications for claude-mem

### Path Prediction
Given a CWD, claude-mem can deterministically compute the auto memory path:
```
~/.claude/projects/{encode(cwd)}/memory/MEMORY.md
```

### Lossy Encoding
The encoding cannot be reversed unambiguously. To map encoded paths back to real paths, you'd need to maintain a lookup table or check which paths actually exist on disk.

### Worktree Isolation
Each git worktree (or agentspace subdirectory) gets its own memory directory. This is beneficial — each worktree can have context specific to its task.

### Truncation Risk
Very long paths (>89 chars when encoded) will be truncated, potentially creating collisions. For typical project paths this is not a concern, but deeply nested workspace paths (like MR-BEADS workspaces at ~80 chars) approach the limit.

## Directory Structure

Each project directory under `~/.claude/projects/` contains:
- Session JSONL files (UUID-named, e.g., `858fa797-5285-4f45-897c-76eb85a37ab9.jsonl`)
- `sessions-index.json` — index of past sessions
- `memory/` — auto memory directory (may or may not exist)
  - `MEMORY.md` — the auto memory file (created by Claude Code when content is written)

## Data Collected

Observed on 2026-02-04 from `~/.claude/projects/`:
- **44 total project directories** observed
- **9 with `memory/` subdirectories** (all empty — no `MEMORY.md` files yet)
- Paths from `/Users/seb/`, `/private/tmp/`
- Both regular directories and git worktrees represented
