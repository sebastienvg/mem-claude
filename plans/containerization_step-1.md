# Claude-Mem Containerization - Step 1: DevContainer Setup

**Phase**: 1 of 6
**Complexity**: Low
**Dependencies**: None

---

## Context Files to Read

Before starting, read these files to understand the context:
1. `/Users/seb/AI/claude-mem/package.json` - Dependencies and build scripts
2. `/Users/seb/AI/claude-mem/CLAUDE.md` - Project architecture overview
3. `containerization_step-1.spec` - Specification for this step

---

## Task Description

Create a VS Code/Cursor DevContainer configuration that provides a consistent development environment with all required tooling: Bun, Node.js, uv, Python, and build tools.

---

## Implementation Steps

1. Create `.devcontainer/` directory in project root
2. Create `Dockerfile` with:
   - Base image: `mcr.microsoft.com/devcontainers/base:bookworm`
   - Install Bun (latest)
   - Install Node.js 18+
   - Install uv and Python 3.13
   - Install git, curl, jq
3. Create `devcontainer.json` with:
   - Build context pointing to Dockerfile
   - Volume mounts for `~/.claude-mem` data persistence
   - Port forwarding for 37777
   - VS Code extensions (ESLint, Prettier, etc.)
   - Post-create command to run `npm install`
4. Create `post-create.sh` script for additional setup
5. Test by opening project in VS Code with DevContainer extension

---

## Testing

```bash
# Open in VS Code with DevContainers extension
code /Users/seb/AI/claude-mem

# Use Command Palette: "Dev Containers: Rebuild and Reopen in Container"

# Inside container, verify:
bun --version          # Should show Bun version
node --version         # Should show Node 18+
uv --version           # Should show uv version
python --version       # Should show Python 3.13

# Build project
npm run build

# Start worker
npm run worker:start
```

---

## Success Criteria

- [ ] `.devcontainer/` directory exists with all 3 files
- [ ] Container builds without errors
- [ ] Bun, Node, uv, Python all available in container
- [ ] `npm run build` succeeds inside container
- [ ] Port 37777 accessible from host
- [ ] Data persists in `~/.claude-mem` volume across rebuilds

---

## When Complete

1. Commit with message: `feat(docker): add devcontainer for consistent dev environment`
2. Notify: "DevContainer ready. Developers can now open project in VS Code and get consistent tooling. Proceed to Step 2 for production Dockerfile."

---

## Next Step

After completion, proceed with `containerization_step-2.md`
