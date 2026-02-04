# Claude-Mem Containerization - Step 6: Distribution & Registry

**Phase**: 6 of 6
**Complexity**: Medium
**Dependencies**: Step 4

---

## Context Files to Read

Before starting, read these files to understand the context:
1. `/Users/seb/AI/claude-mem/.github/workflows/` - Existing CI/CD workflows
2. `/Users/seb/AI/claude-mem/package.json` - Version management
3. `/Users/seb/AI/claude-mem/docs/public/` - Documentation structure
4. `containerization_step-6.spec` - Specification for this step

---

## Task Description

Set up automated Docker image publishing to GitHub Container Registry (ghcr.io) and create user documentation for Docker-based installation.

---

## Implementation Steps

1. Create `.github/workflows/docker-publish.yml`:
   - Trigger on release publish
   - Build multi-arch images (amd64, arm64)
   - Push to ghcr.io/thedotmack/claude-mem
   - Tag with version and `latest`
2. Configure repository for GHCR:
   - Enable package publishing in repo settings
   - Set up GITHUB_TOKEN permissions
3. Create documentation:
   - `docs/public/docker.mdx` - Docker installation guide
   - Update `docs/public/getting-started.mdx` to mention Docker option
4. Test the workflow manually first
5. Create a test release to verify end-to-end

---

## Testing

```bash
# Test workflow locally with act (optional)
act -j build-and-push --secret GITHUB_TOKEN=$GITHUB_TOKEN

# Manual build and push (for testing)
docker buildx create --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/thedotmack/claude-mem:test \
  --push .

# Verify image is accessible
docker pull ghcr.io/thedotmack/claude-mem:test
docker run --rm ghcr.io/thedotmack/claude-mem:test --version
```

---

## Success Criteria

- [ ] GitHub Actions workflow created and valid
- [ ] Multi-arch builds (amd64 + arm64)
- [ ] Images tagged with version and `latest`
- [ ] Images publicly pullable from ghcr.io
- [ ] Documentation covers Docker installation
- [ ] README updated with Docker quick start
- [ ] Test release publishes successfully

---

## When Complete

1. Commit with message: `feat(ci): add Docker image publishing to GHCR`
2. Notify: "Containerization complete! Users can now `docker pull ghcr.io/thedotmack/claude-mem:latest` or use Docker Compose."

---

## Next Step

Containerization is complete. Consider:
- Monitoring image pulls and issues
- Adding Docker-specific troubleshooting docs
- Kubernetes/Helm charts (future enhancement)
