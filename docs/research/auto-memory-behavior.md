# Auto Memory MEMORY.md Behavior

## Overview

Claude Code has a built-in auto memory feature that creates a `MEMORY.md` file at:
```
~/.claude/projects/<encoded-path>/memory/MEMORY.md
```

This file is automatically loaded into the system prompt at session start and can be read/written by Claude using the standard `Read`, `Edit`, and `Write` tools.

## Current State (2026-02-04)

### Directory Status
- 9 out of 44 project directories have `memory/` subdirectories
- **No MEMORY.md files exist yet** — all memory directories are empty
- The `memory/` directory is created by Claude Code but `MEMORY.md` is only created when Claude actually writes to it

### Projects with `memory/` directories
```
~/.claude/projects/-Users-seb-AI-beadnode-seed/memory/           (empty)
~/.claude/projects/-Users-seb-AI-claude-mem/memory/              (empty)
~/.claude/projects/-Users-seb-AI-mem-claude/memory/              (empty)
~/.claude/projects/-Users-seb-AI-mem-claude-agentspaces-*/memory/ (all empty)
~/.claude/projects/-Users-seb-AI-ubuntu-macbook-2015/memory/     (empty)
```

## System Prompt Instructions

Claude Code injects the following auto memory instructions into every session's system prompt:

```
# auto memory

You have a persistent auto memory directory at
`~/.claude/projects/<encoded-path>/memory/`.
Its contents persist across conversations.

As you work, consult your memory files to build on previous experience.
When you encounter a mistake that seems like it could be common,
check your auto memory for relevant notes — and if nothing is written yet,
record what you learned.

Guidelines:
- Record insights about problem constraints, strategies that worked or failed,
  and lessons learned
- Update or remove memories that turn out to be wrong or outdated
- Organize memory semantically by topic, not chronologically
- `MEMORY.md` is always loaded into your system prompt — lines after 200
  will be truncated, so keep it concise and link to other files in your
  auto memory directory for details
- Use the Write and Edit tools to update your memory files
```

## Key Behavioral Properties

### 1. File is NOT auto-generated
Claude Code does **not** automatically write to MEMORY.md. It only:
- Creates the `memory/` directory
- Loads `MEMORY.md` content into the system prompt (if the file exists)
- Instructs Claude to use `Write` and `Edit` tools to maintain the file

The file is created and maintained **by Claude itself** during sessions, not by Claude Code's infrastructure.

### 2. Full file content is injected into system prompt
The system prompt includes the literal content:
```
## MEMORY.md

Your MEMORY.md is currently empty.
```
Or, if MEMORY.md has content, it would show the file contents directly. This means MEMORY.md content is part of every API call's system prompt.

### 3. Truncation at 200 lines
The system prompt explicitly states: "lines after 200 will be truncated." This imposes a hard limit on useful MEMORY.md content. Claude is instructed to keep it concise and link to other files in the `memory/` directory for details.

### 4. Claude uses standard file tools
MEMORY.md is read and written using the same `Read`, `Write`, and `Edit` tools used for any other file. There is no special API — Claude simply treats it as a regular markdown file.

### 5. Multiple files supported
The `memory/` directory can contain multiple files, not just MEMORY.md. Claude can create additional files and reference them from MEMORY.md. Only MEMORY.md itself is auto-loaded into the system prompt.

### 6. Claude writes atomically (full overwrites or edits)
Claude uses `Write` (full file replacement) or `Edit` (string replacement) to update MEMORY.md. There is no append-only mode. Claude decides what to write based on the system prompt guidelines.

## Implications for claude-mem Integration

### Can claude-mem safely write to MEMORY.md?

**Yes, with caveats.** Since Claude uses standard `Write` and `Edit` tools:

1. **Tagged sections would work**: claude-mem could write a `<claude-mem-briefing>` section into MEMORY.md. Claude would see this content in its system prompt and could work around it.

2. **Risk of overwrite**: Claude might overwrite the entire file using the `Write` tool, which would destroy claude-mem's tagged section. This is the primary risk.

3. **Edit tool is safer**: If Claude uses `Edit` (string replacement) to modify specific sections, claude-mem's tagged content would survive. But there's no guarantee Claude will use `Edit` over `Write`.

### Recommended Integration Strategy

**Option A: Write to a separate file** (safest)
- claude-mem writes to `memory/claude-mem-briefing.md` instead of `MEMORY.md`
- MEMORY.md references it: `See @claude-mem-briefing.md for session history`
- Downside: The separate file is NOT auto-loaded into the system prompt

**Option B: Prepend tagged section to MEMORY.md** (most effective)
- claude-mem prepends `<claude-mem-briefing>...</claude-mem-briefing>` to the top of MEMORY.md
- Content is auto-loaded into system prompt
- Risk: Claude may overwrite the file, losing the tagged section
- Mitigation: claude-mem can re-inject on every session start (via SessionStart hook)

**Option C: Use MEMORY.md exclusively** (replace Claude's auto memory)
- claude-mem takes over MEMORY.md entirely
- Claude's own memory notes are lost or redirected to CLAUDE.md
- Simplest but most disruptive

### Line Budget

With a 200-line truncation limit, claude-mem must be extremely concise:
- If claude-mem uses 50 lines, Claude has 150 lines for its own notes
- If claude-mem uses 100 lines, Claude only has 100 lines remaining
- The briefing should be as compact as possible (ideally <30 lines)

## Comparison: Auto Memory vs claude-mem

| Feature | Auto Memory (MEMORY.md) | claude-mem |
|---------|------------------------|------------|
| Storage | Local file (~/.claude/projects/) | SQLite + Chroma |
| Injection | System prompt (always loaded) | SessionStart hook |
| Content | Claude-written notes | AI-compressed observations |
| History | Current state only | Full timeline with search |
| Cross-session | Yes (persists in file) | Yes (persists in DB) |
| Line limit | 200 lines | Configurable |
| Searchable | No (just loaded text) | Yes (MCP search tools) |

## Settings

No Claude Code settings were found related to auto memory. The feature appears to be:
- Always enabled (no opt-out setting found)
- Not configurable (200-line limit, directory structure are hardcoded)
- Controlled entirely through the system prompt instructions

The `~/.claude/settings.json` file contains no memory-related keys.

## References

- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory) — covers CLAUDE.md but not MEMORY.md auto memory
- [Claude API Memory Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) — separate API-level memory tool, different from Claude Code's auto memory
- System prompt analysis from active Claude Code session (2026-02-04)
