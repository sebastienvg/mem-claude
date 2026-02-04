# Claude-Mem Containerization - Step 4: Docker Compose Orchestration

**Phase**: 4 of 6
**Complexity**: Low
**Dependencies**: Steps 2, 3

---

## Context Files to Read

Before starting, read these files to understand the context:
1. `/Users/seb/.claude/plans/containerization_step-2.spec` - Worker Dockerfile spec
2. `/Users/seb/.claude/plans/containerization_step-3.spec` - Chroma HTTP spec
3. `containerization_step-4.spec` - Specification for this step

---

## Task Description

Create Docker Compose configuration to orchestrate the worker service and Chroma together, with proper networking, health checks, and volume management.

---

## Implementation Steps

1. Create `docker-compose.yml` with:
   - `worker` service (builds from Dockerfile)
   - `chroma` service (official chromadb image)
   - Named volumes for data persistence
   - Health checks with dependencies
   - Environment variable configuration
2. Create `.env.example` documenting all variables
3. Create `docker-compose.override.yml.example` for dev overrides
4. Add npm scripts for Docker operations
5. Test full stack startup and shutdown
6. Document in README or separate doc

---

## Testing

```bash
# Copy example env
cp .env.example .env
# Edit .env with your API key

# Start full stack
docker compose up -d

# Check status
docker compose ps

# Check logs
docker compose logs -f worker

# Verify health
curl http://localhost:37777/api/readiness

# Test vector search (if Chroma connected)
curl http://localhost:37777/api/search/vector?q=test

# Shutdown
docker compose down

# Cleanup volumes (full reset)
docker compose down -v
```

---

## Success Criteria

- [ ] `docker compose up` starts both services
- [ ] Worker waits for Chroma to be healthy before starting
- [ ] Health checks pass for both services
- [ ] Data persists across restarts
- [ ] `docker compose down -v` cleanly removes everything
- [ ] `.env.example` documents all required variables
- [ ] Override file enables dev-friendly settings

---

## When Complete

1. Commit with message: `feat(docker): add docker-compose for full stack deployment`
2. Notify: "Docker Compose ready. Run `docker compose up` for full stack. Proceed to Step 5 for hook integration."

---

## Next Step

After completion, proceed with `containerization_step-5.md`
