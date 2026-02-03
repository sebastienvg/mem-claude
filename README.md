# mem-claude (Containerized)

> **This is a containerized fork of [claude-mem](https://github.com/thedotmack/claude-mem) by [thedotmack](https://github.com/thedotmack).**
>
> All credit for the original claude-mem project goes to **Alex Newman ([@thedotmack](https://github.com/thedotmack))**.
>
> This repository adds Docker containerization for easy deployment. For the original project, full documentation, and support, please visit: **https://github.com/thedotmack/claude-mem**

---

## What is Claude-Mem?

Claude-Mem is a persistent memory compression system built for [Claude Code](https://claude.com/claude-code). It seamlessly preserves context across sessions by automatically capturing tool usage observations, generating semantic summaries, and making them available to future sessions.

**Key Features:**
- Persistent Memory - Context survives across sessions
- Progressive Disclosure - Layered memory retrieval
- Skill-Based Search - Query your project history
- Web Viewer UI - Real-time memory stream at http://localhost:37777
- Privacy Control - Use `<private>` tags to exclude sensitive content

For full documentation, see the **[original project](https://github.com/thedotmack/claude-mem)**.

---

## Docker Quick Start

### Single Container

```bash
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  registry.evthings.space/mem-claude/claude-mem:latest
```

### Docker Compose (Recommended)

For the full stack including Chroma vector search:

```bash
git clone https://github.com/sebastienvg/mem-claude.git
cd mem-claude

# Configure environment
cp .env.example .env
# Edit .env with your API key

# Start services
docker compose up -d
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key |
| `CLAUDE_MEM_GEMINI_API_KEY` | Yes* | Alternative: Gemini API key |
| `CLAUDE_MEM_OPENROUTER_API_KEY` | Yes* | Alternative: OpenRouter API key |
| `CLAUDE_MEM_WORKER_PORT` | No | HTTP port (default: 37777) |

*At least one AI provider key required for memory compression.

---

## Data Persistence

Mount `/data` to persist the SQLite database, vector embeddings, and configuration:

```bash
-v ~/.claude-mem:/data
```

---

## Health Check

```bash
curl http://localhost:37777/api/readiness
```

---

## Updating

```bash
docker pull registry.evthings.space/mem-claude/claude-mem:latest
docker compose up -d
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0).

**Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.**

See the [LICENSE](LICENSE) file for full details.

---

## Credits & Support

- **Original Project**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Author**: Alex Newman ([@thedotmack](https://github.com/thedotmack))
- **Documentation**: [docs.claude-mem.ai](https://docs.claude-mem.ai)
- **Issues**: [GitHub Issues](https://github.com/thedotmack/claude-mem/issues) (report to original project)
- **Discord**: [Join Discord](https://discord.com/invite/J4wttp9vDu)
- **X**: [@Claude_Memory](https://x.com/Claude_Memory)

---

**Containerization by [@sebastienvg](https://github.com/sebastienvg)** | **Original by [@thedotmack](https://github.com/thedotmack)**
